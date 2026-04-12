const { json, parseBody, getUserFromRequest, methodNotAllowed, supabaseAdmin } = require('../../api-lib/common');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const { user, error: authError } = await getUserFromRequest(req);
  if (!user) return json(res, 401, { error: authError || 'unauthorized' });

  const body = parseBody(req);
  const subscription = body.subscription;
  const endpoint = subscription?.endpoint;
  if (!endpoint) return json(res, 400, { error: 'missing_subscription_endpoint' });

  const payload = {
    user_id: user.id,
    endpoint,
    subscription
  };

  const { error } = await supabaseAdmin
    .from('web_push_subscriptions')
    .upsert(payload, { onConflict: 'endpoint' });

  if (error) return json(res, 500, { error: error.message || 'subscribe_failed' });
  return json(res, 200, { success: true });
};
