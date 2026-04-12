const {
  json,
  getUserFromRequest,
  methodNotAllowed,
  supabaseAdmin
} = require('../../api-lib/common');
const { applyCors, handlePreflight } = require('../../api-lib/cors');

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const { user, error: authError } = await getUserFromRequest(req);
  if (!user) return json(res, 401, { error: authError || 'unauthorized' });
  if (!user.email) return json(res, 400, { error: 'missing_user_email' });

  const studentEmail = String(user.email || '').toLowerCase();
  const { data: whitelistRows, error: whitelistError } = await supabaseAdmin
    .from('access_whitelist')
    .select('role')
    .eq('email', studentEmail)
    .limit(1);
  if (whitelistError) return json(res, 500, { error: whitelistError.message || 'whitelist_lookup_failed' });
  const role = String((whitelistRows || [])[0]?.role || '');
  if (!['eleve', 'member', 'admin'].includes(role)) return json(res, 403, { error: 'not_allowed_role' });

  const testId = String(req.query?.test_id || '').trim();
  if (!testId) return json(res, 400, { error: 'missing_test_id' });

  const { data, error } = await supabaseAdmin
    .from('exercise_attempts')
    .select('id, test_id, title, summary, score, payload, created_at')
    .eq('student_user_id', user.id)
    .eq('test_id', testId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return json(res, 500, { error: error.message || 'attempts_lookup_failed' });

  return json(res, 200, { data: data || [] });
};
