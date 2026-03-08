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

  const adminEmail = String(user.email || '').toLowerCase();
  const { data: adminRows, error: adminError } = await supabaseAdmin
    .from('access_whitelist')
    .select('role')
    .eq('email', adminEmail)
    .eq('role', 'admin')
    .limit(1);
  if (adminError) return json(res, 500, { error: adminError.message || 'admin_lookup_failed' });
  if (!(adminRows || []).length) return json(res, 403, { error: 'not_admin' });

  const { data: rows, error: rowsError } = await supabaseAdmin
    .from('access_whitelist')
    .select('id, email, role, teacher_email, added_by, created_at, updated_at')
    .eq('teacher_email', adminEmail)
    .order('created_at', { ascending: false });
  if (rowsError) return json(res, 500, { error: rowsError.message || 'students_lookup_failed' });

  const candidates = rows || [];
  const byEmail = new Map();
  try {
    const { data: usersData, error: usersError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000
    });
    if (!usersError) {
      (usersData?.users || []).forEach((candidate) => {
        const email = String(candidate.email || '').toLowerCase();
        if (email) byEmail.set(email, candidate.id);
      });
    }
  } catch (_err) {
    // Ignore user lookup failures and fallback to unknown profile names.
  }

  const userIds = [...new Set(candidates.map((row) => byEmail.get(String(row.email || '').toLowerCase())).filter(Boolean))];
  let usernameById = {};
  if (userIds.length) {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, username')
      .in('id', userIds);
    usernameById = Object.fromEntries((profiles || []).map((profile) => [profile.id, String(profile.username || '').trim()]));
  }

  const data = candidates.map((row) => {
    const userId = byEmail.get(String(row.email || '').toLowerCase()) || null;
    const profileUsername = userId ? (usernameById[userId] || '') : '';
    return {
      ...row,
      profile_username: profileUsername || null
    };
  });

  return json(res, 200, { data });
};

