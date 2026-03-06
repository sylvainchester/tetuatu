const {
  json,
  getUserFromRequest,
  methodNotAllowed,
  supabaseAdmin
} = require('../_lib/common');
const { applyCors, handlePreflight } = require('../_lib/cors');

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
    .eq('role', 'eleve')
    .limit(1);
  if (whitelistError) return json(res, 500, { error: whitelistError.message || 'whitelist_lookup_failed' });
  if (!(whitelistRows || []).length) return json(res, 403, { error: 'not_student' });

  const { data, error } = await supabaseAdmin
    .from('exercise_attempts')
    .select('id, test_id, title, summary, score, payload, created_at')
    .eq('student_user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return json(res, 500, { error: error.message || 'attempts_lookup_failed' });

  const incorrect = (data || []).filter((row) => {
    if (typeof row.score === 'number') return row.score < 1;
    const summary = String(row.summary || '').toLowerCase();
    return summary.includes('a corriger') || summary.includes('faute') || summary.includes('incorrect');
  });

  return json(res, 200, { data: incorrect });
};
