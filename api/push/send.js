const webpush = require('web-push');
const {
  json,
  parseBody,
  methodNotAllowed,
  supabaseAdmin
} = require('../_lib/common');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function isValidExpoToken(token) {
  return typeof token === 'string' &&
    (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken['));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const sentSecret = (req.headers['x-push-secret'] || '').toString();
  const expectedSecret = process.env.PUSH_INTERNAL_SECRET || '';
  if (!expectedSecret || sentSecret !== expectedSecret) {
    return json(res, 401, { error: 'unauthorized' });
  }

  const vapidPublic = process.env.VAPID_PUBLIC_KEY || '';
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY || '';
  const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  if (vapidPublic && vapidPrivate) {
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
  }

  const body = parseBody(req);
  const title = typeof body.title === 'string' ? body.title : 'Notification';
  const message = typeof body.body === 'string' ? body.body : '';
  const data = typeof body.data === 'object' && body.data ? body.data : {};
  const userIds = Array.isArray(body.userIds) ? body.userIds.filter(Boolean) : [];

  let tokenQuery = supabaseAdmin.from('user_push_tokens').select('token');
  if (userIds.length) tokenQuery = tokenQuery.in('user_id', userIds);
  const { data: tokenRows, error: tokenError } = await tokenQuery;
  if (tokenError) return json(res, 500, { error: tokenError.message || 'token_lookup_failed' });

  const expoTokens = (tokenRows || []).map((row) => row.token).filter(isValidExpoToken);
  if (expoTokens.length) {
    const messages = expoTokens.map((token) => ({ to: token, title, body: message, data }));
    try {
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages)
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[push] expo send failed', err);
    }
  }

  let subQuery = supabaseAdmin.from('web_push_subscriptions').select('endpoint, subscription');
  if (userIds.length) subQuery = subQuery.in('user_id', userIds);
  const { data: subRows, error: subError } = await subQuery;
  if (subError) return json(res, 500, { error: subError.message || 'subscription_lookup_failed' });

  const payload = JSON.stringify({
    title,
    body: message,
    data
  });

  if (vapidPublic && vapidPrivate && (subRows || []).length) {
    for (const row of subRows) {
      try {
        await webpush.sendNotification(row.subscription, payload);
      } catch (err) {
        const status = err?.statusCode;
        if (status === 404 || status === 410) {
          await supabaseAdmin.from('web_push_subscriptions').delete().eq('endpoint', row.endpoint);
        }
      }
    }
  }

  return json(res, 200, {
    success: true,
    expoCount: expoTokens.length,
    webCount: (subRows || []).length
  });
};
