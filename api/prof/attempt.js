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

  const id = String(req.query?.id || '').trim();
  if (!id) return json(res, 400, { error: 'missing_id' });

  const { data: adminRows, error: adminError } = await supabaseAdmin
    .from('access_whitelist')
    .select('role')
    .eq('email', (user.email || '').toLowerCase())
    .eq('role', 'admin')
    .limit(1);
  if (adminError) return json(res, 500, { error: adminError.message || 'admin_lookup_failed' });
  if (!(adminRows || []).length) return json(res, 403, { error: 'not_admin' });
  const adminEmail = String(user.email || '').toLowerCase();

  const { data, error } = await supabaseAdmin
    .from('exercise_attempts')
    .select('*')
    .eq('id', id)
    .eq('teacher_email', adminEmail)
    .limit(1);
  if (error) return json(res, 500, { error: error.message || 'attempt_lookup_failed' });
  const row = (data || [])[0] || null;
  if (!row) return json(res, 404, { error: 'attempt_not_found' });
  return json(res, 200, { data: row });
};
