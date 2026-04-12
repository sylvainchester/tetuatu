const { json, parseBody, getUserFromRequest, methodNotAllowed, supabaseAdmin } = require('../../api-lib/common');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const { user, error: authError } = await getUserFromRequest(req);
  if (!user) return json(res, 401, { error: authError || 'unauthorized' });

  const body = parseBody(req);
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) return json(res, 400, { error: 'missing_token' });

  const { error } = await supabaseAdmin
    .from('user_push_tokens')
    .upsert({ user_id: user.id, token }, { onConflict: 'user_id' });

  if (error) return json(res, 500, { error: error.message || 'push_token_upsert_failed' });
  return json(res, 200, { success: true });
};
