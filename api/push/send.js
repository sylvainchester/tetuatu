const {
  json,
  parseBody,
  methodNotAllowed
} = require('../_lib/common');
const { sendPushToUsers } = require('../_lib/pushSender');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const sentSecret = (req.headers['x-push-secret'] || '').toString();
  const expectedSecret = process.env.PUSH_INTERNAL_SECRET || '';
  if (!expectedSecret || sentSecret !== expectedSecret) {
    return json(res, 401, { error: 'unauthorized' });
  }

  const body = parseBody(req);
  const title = typeof body.title === 'string' ? body.title : 'Notification';
  const message = typeof body.body === 'string' ? body.body : '';
  const data = typeof body.data === 'object' && body.data ? body.data : {};
  const userIds = Array.isArray(body.userIds) ? body.userIds.filter(Boolean) : [];

  try {
    const result = await sendPushToUsers({
      userIds,
      title,
      body: message,
      data
    });
    return json(res, 200, { success: true, ...result });
  } catch (err) {
    return json(res, 500, { error: err.message || 'push_send_failed' });
  }
};
