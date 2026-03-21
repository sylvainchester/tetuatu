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
  const correctionSourceId = String(payload.correction_source_id || '').trim();
  if (!testId || !title) return json(res, 400, { error: 'missing_test_info' });

  const studentEmail = user.email.toLowerCase();

  const { data: whitelistRows, error: whitelistError } = await supabaseAdmin
    .from('access_whitelist')
    .select('*')
    .eq('email', studentEmail)
    .limit(1);
  if (whitelistError) {
    console.error('[submit] whitelist lookup failed', {
      message: whitelistError.message,
      details: whitelistError.details,
      hint: whitelistError.hint,
      code: whitelistError.code
    });
    return json(res, 500, {
      error: whitelistError.message || 'whitelist_lookup_failed',
      code: whitelistError.code || null
    });
  }
  const whitelist = (whitelistRows || [])[0];
  if (!whitelist) return json(res, 403, { error: 'not_whitelisted' });
  if (!['eleve', 'member', 'admin'].includes(String(whitelist.role || ''))) {
    return json(res, 403, { error: 'not_allowed_role' });
  }

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

  let studentUsername = '';
  try {
    const { data: profileRows, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .limit(1);
    if (!profileError) {
      studentUsername = String(profileRows?.[0]?.username || '').trim();
    }
  } catch (_err) {
    // Ignore profile lookup errors for notification display name.
  }

  const attemptPayload = {
    student_user_id: user.id,
    student_email: studentEmail,
    teacher_email: teacherEmail,
    test_id: testId,
    title,
    summary,
    score,
    payload,
    updated_at: new Date().toISOString(),
    prof_read_at: null
  };

  let attemptId = null;
  if (correctionSourceId) {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('exercise_attempts')
      .update(attemptPayload)
      .eq('id', correctionSourceId)
      .eq('student_user_id', user.id)
      .eq('test_id', testId)
      .select('id')
      .limit(1);
    if (updateError) {
      console.error('[submit] attempt update failed', {
        message: updateError.message,
        details: updateError.details,
        hint: updateError.hint,
        code: updateError.code,
        attemptPayload,
        correctionSourceId
      });
      return json(res, 500, {
        error: updateError.message || 'attempt_update_failed',
        code: updateError.code || null
      });
    }
    const row = (updated || [])[0];
    if (!row) return json(res, 404, { error: 'attempt_not_found_for_correction' });
    attemptId = row.id;
  } else {
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('exercise_attempts')
      .insert(attemptPayload)
      .select('id')
      .limit(1);
    if (insertError) {
      console.error('[submit] attempt insert failed', {
        message: insertError.message,
        details: insertError.details,
        hint: insertError.hint,
        code: insertError.code,
        attemptPayload
      });
      return json(res, 500, {
        error: insertError.message || 'attempt_insert_failed',
        code: insertError.code || null
      });
    }
    attemptId = inserted?.[0]?.id || null;
  }

  if (teacherUserId) {
    try {
      const studentLabel = studentUsername || 'Un eleve';
      await sendPushToUsers({
        userIds: [teacherUserId],
        title: 'Nouvel exercice eleve',
        body: `${studentLabel} a termine ${title}`,
        data: {
          type: 'exercise_attempt',
          attemptId,
          studentUserId: user.id,
          testId
        }
      });
    } catch (_err) {
      // Ignore push errors, attempt is already saved.
    }
  }

  return json(res, 200, { success: true, attemptId });
};
