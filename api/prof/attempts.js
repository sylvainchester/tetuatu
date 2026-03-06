const {
  json,
  getUserFromRequest,
  methodNotAllowed,
  supabaseAdmin
} = require('../_lib/common');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const { user, error: authError } = await getUserFromRequest(req);
  if (!user) return json(res, 401, { error: authError || 'unauthorized' });
  if (!user.email) return json(res, 400, { error: 'missing_user_email' });

  const adminEmail = user.email.toLowerCase();
  const { data: adminRows, error: adminError } = await supabaseAdmin
    .from('access_whitelist')
    .select('role')
    .eq('email', adminEmail)
    .eq('role', 'admin')
    .limit(1);
  if (adminError) return json(res, 500, { error: adminError.message || 'admin_lookup_failed' });
  if (!(adminRows || []).length) return json(res, 403, { error: 'not_admin' });

  const { data, error } = await supabaseAdmin
    .from('exercise_attempts')
    .select('id, student_email, test_id, title, summary, score, created_at')
    .eq('teacher_user_id', user.id)
    .order('created_at', { ascending: false });
  if (error) return json(res, 500, { error: error.message || 'attempts_lookup_failed' });

  return json(res, 200, { data: data || [] });
};
