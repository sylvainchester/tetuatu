const {
  json,
  parseBody,
  getUserFromRequest,
  methodNotAllowed,
  supabaseAdmin
} = require('../_lib/common');
const { sendPushToUsers } = require('../_lib/pushSender');
const { applyCors, handlePreflight } = require('../_lib/cors');

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const { user, error: authError } = await getUserFromRequest(req);
  if (!user) return json(res, 401, { error: authError || 'unauthorized' });
  if (!user.email) return json(res, 400, { error: 'missing_user_email' });

  const body = parseBody(req);
  const testId = String(body.testId || '').trim();
  const title = String(body.title || '').trim();
  const summary = String(body.summary || '').trim();
  const score = typeof body.score === 'number' ? body.score : null;
  const payload = typeof body.payload === 'object' && body.payload ? body.payload : {};
  if (!testId || !title) return json(res, 400, { error: 'missing_test_info' });

  const studentEmail = user.email.toLowerCase();

  const { data: whitelistRows, error: whitelistError } = await supabaseAdmin
    .from('access_whitelist')
    .select('*')
    .eq('email', studentEmail)
    .eq('role', 'eleve')
    .limit(1);
  if (whitelistError) return json(res, 500, { error: whitelistError.message || 'whitelist_lookup_failed' });
  const whitelist = (whitelistRows || [])[0];
  if (!whitelist) return json(res, 403, { error: 'not_student_or_not_whitelisted' });

  let teacherUserId = whitelist.added_by || null;
  const teacherEmail = (whitelist.teacher_email || '').toLowerCase() || null;
  if (!teacherUserId && teacherEmail) {
    try {
      const { data: usersData, error: usersError } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000
      });
      if (!usersError) {
        const found = (usersData?.users || []).find(
          (candidate) => String(candidate.email || '').toLowerCase() === teacherEmail
        );
        if (found?.id) {
          teacherUserId = found.id;
        }
      }
    } catch (_err) {
      // Keep nullable teacher_user_id, teacher_email fallback remains available for dashboard.
    }
  }

  const attemptPayload = {
    student_user_id: user.id,
    student_email: studentEmail,
    teacher_user_id: teacherUserId,
    teacher_email: teacherEmail,
    test_id: testId,
    title,
    summary,
    score,
    payload
  };

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('exercise_attempts')
    .insert(attemptPayload)
    .select('id')
    .limit(1);
  if (insertError) return json(res, 500, { error: insertError.message || 'attempt_insert_failed' });

  if (teacherUserId) {
    try {
      await sendPushToUsers({
        userIds: [teacherUserId],
        title: 'Nouvel exercice eleve',
        body: `${studentEmail} a termine ${title}`,
        data: {
          type: 'exercise_attempt',
          attemptId: inserted?.[0]?.id || null,
          studentEmail,
          testId
        }
      });
    } catch (_err) {
      // Ignore push errors, attempt is already saved.
    }
  }

  return json(res, 200, { success: true, attemptId: inserted?.[0]?.id || null });
};
