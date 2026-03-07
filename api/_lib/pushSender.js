const webpush = require('web-push');
const { supabaseAdmin } = require('./common');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function isValidExpoToken(token) {
  return typeof token === 'string' &&
    (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken['));
}

function setupWebPush() {
  const vapidPublic = process.env.VAPID_PUBLIC_KEY || '';
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY || '';
  const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  if (!vapidPublic || !vapidPrivate) return false;
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
  return true;
}

async function sendPushToUsers({ userIds, title, body, data = {} }) {
  const ids = Array.isArray(userIds) ? userIds.filter(Boolean) : [];
  if (!ids.length) return { expoCount: 0, webCount: 0 };

  const { data: tokenRows, error: tokenError } = await supabaseAdmin
    .from('user_push_tokens')
    .select('token')
    .in('user_id', ids);
  if (tokenError) throw new Error(tokenError.message || 'token_lookup_failed');

  const expoTokens = (tokenRows || []).map((row) => row.token).filter(isValidExpoToken);
  if (expoTokens.length) {
    const messages = expoTokens.map((token) => ({ to: token, title, body, data }));
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

  const { data: subRows, error: subError } = await supabaseAdmin
    .from('web_push_subscriptions')
    .select('endpoint, subscription')
    .in('user_id', ids);
  if (subError) throw new Error(subError.message || 'subscription_lookup_failed');

  const webPushReady = setupWebPush();
  const payload = JSON.stringify({ title, body, data });
  let webDelivered = 0;
  let webFailed = 0;
  const webErrors = [];
  if (webPushReady && (subRows || []).length) {
    for (const row of subRows) {
      try {
        await webpush.sendNotification(row.subscription, payload);
        webDelivered += 1;
      } catch (err) {
        webFailed += 1;
        webErrors.push({
          statusCode: err?.statusCode || null,
          body: err?.body || err?.message || 'web_push_send_failed',
          endpoint: String(row.endpoint || '').slice(0, 120)
        });
        const status = err?.statusCode;
        if (status === 404 || status === 410) {
          await supabaseAdmin.from('web_push_subscriptions').delete().eq('endpoint', row.endpoint);
        }
      }
    }
  }

  return {
    expoCount: expoTokens.length,
    webCount: (subRows || []).length,
    webDelivered,
    webFailed,
    webErrors
  };
}

module.exports = {
  sendPushToUsers
};
