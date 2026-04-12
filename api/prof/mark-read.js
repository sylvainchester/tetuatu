const {
  json,
  parseBody,
  getUserFromRequest,
  methodNotAllowed,
  supabaseAdmin
} = require('../../api-lib/common');
const { applyCors, handlePreflight } = require('../../api-lib/cors');

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
  if (!id) return json(res, 400, { error: 'missing_id' });

  const readAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('exercise_attempts')
    .update({ prof_read_at: readAt })
    .eq('id', id)
    .eq('teacher_email', adminEmail)
    .select('id, prof_read_at')
    .limit(1);
  if (error) return json(res, 500, { error: error.message || 'mark_read_failed' });
  const row = (data || [])[0];
  if (!row) return json(res, 404, { error: 'attempt_not_found' });
  return json(res, 200, { data: row });
};
