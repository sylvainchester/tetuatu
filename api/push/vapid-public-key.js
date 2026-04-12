const { json, methodNotAllowed } = require('../../api-lib/common');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const publicKey = process.env.VAPID_PUBLIC_KEY || '';
  if (!publicKey) {
    return json(res, 500, { error: 'vapid_public_key_not_configured' });
  }
  return json(res, 200, { publicKey });
};
