const {
  json,
  parseBody,
  getUserFromRequest,
  methodNotAllowed,
  supabaseAdmin
} = require('../_lib/common');
const { applyCors, handlePreflight } = require('../_lib/cors');
const { sendPushToUsers } = require('../_lib/pushSender');

function parseTimestamp(value) {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) ? ts : null;
}

function hasNewStudentSubmission(payload) {
  const submittedAt = parseTimestamp(payload?.correction_submitted_at);
  const reviewedAt = parseTimestamp(payload?.prof_reviewed_at);
  if (!submittedAt) return false;
  if (!reviewedAt) return true;
  return submittedAt > reviewedAt;
}

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const { user, error: authError } = await getUserFromRequest(req);
  if (!user) return json(res, 401, { error: authError || 'unauthorized' });
  if (!user.email) return json(res, 400, { error: 'missing_user_email' });

  const adminEmail = String(user.email || '').toLowerCase();
  const { data: adminRows, error: adminError } = await supabaseAdmin
    .from('access_whitelist')
    .select('role')
    .eq('email', adminEmail)
    .eq('role', 'admin')
    .limit(1);
  if (adminError) return json(res, 500, { error: adminError.message || 'admin_lookup_failed' });
  if (!(adminRows || []).length) return json(res, 403, { error: 'not_admin' });

  const body = parseBody(req);
  const id = String(body.id || '').trim();
  const decision = String(body.decision || '').trim().toLowerCase();
  const comment = String(body.comment || '').trim();
  if (!id) return json(res, 400, { error: 'missing_id' });
  if (!['correct', 'a_corriger'].includes(decision)) return json(res, 400, { error: 'invalid_decision' });

  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from('exercise_attempts')
    .select('payload, student_user_id, title, test_id')
    .eq('id', id)
    .eq('teacher_email', adminEmail)
    .limit(1);
  if (existingError) return json(res, 500, { error: existingError.message || 'attempt_lookup_failed' });
  const existing = (existingRows || [])[0];
  if (!existing) return json(res, 404, { error: 'attempt_not_found' });
  const existingPayload = existing.payload || {};
  if (existing.test_id === 'test11') {
    if (existingPayload.prof_decision === 'correct') {
      return json(res, 409, { error: 'review_locked_final' });
    }
    if (existingPayload.prof_decision === 'a_corriger' && !hasNewStudentSubmission(existingPayload)) {
      return json(res, 409, { error: 'awaiting_student_correction' });
    }
  }

  const payload = {
    ...existingPayload,
    prof_comment: comment,
    prof_decision: decision,
    prof_reviewed_at: new Date().toISOString()
  };

  const summary = decision === 'correct' ? 'Correct' : 'A corriger';
  const score = decision === 'correct' ? 1 : 0;

  const { data, error } = await supabaseAdmin
    .from('exercise_attempts')
    .update({
      payload,
      summary,
      score,
      prof_read_at: new Date().toISOString()
    })
    .eq('id', id)
    .eq('teacher_email', adminEmail)
    .select('id, payload, summary, score, prof_read_at')
    .limit(1);
  if (error) return json(res, 500, { error: error.message || 'review_update_failed' });

  try {
    if (existing.student_user_id) {
      await sendPushToUsers({
        userIds: [existing.student_user_id],
        title: decision === 'correct' ? 'Rédaction validée' : 'Rédaction à corriger',
        body:
          decision === 'correct'
            ? `Le professeur a validé: ${existing.title || 'rédaction'}`
            : `Le professeur demande une correction: ${existing.title || 'rédaction'}`,
        data: {
          type: 'prof_review',
          attemptId: id,
          testId: existing.test_id || null,
          decision
        }
      });
    }
  } catch (_err) {
    // Do not fail the review update if push fails.
  }

  return json(res, 200, { data: (data || [])[0] || null });
};
