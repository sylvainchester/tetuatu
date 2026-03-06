const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

function readEnvFromFile(key) {
  const files = ['.env.local', '.env'];
  for (const file of files) {
    const fullPath = path.join(process.cwd(), file);
    if (!fs.existsSync(fullPath)) continue;
    const raw = fs.readFileSync(fullPath, 'utf8');
    const line = raw
      .split('\n')
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${key}=`));
    if (!line) continue;
    const value = line.slice(`${key}=`.length).trim().replace(/^"(.*)"$/, '$1');
    if (value) return value;
  }
  return '';
}

const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  readEnvFromFile('SUPABASE_URL') ||
  readEnvFromFile('EXPO_PUBLIC_SUPABASE_URL') ||
  '';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || readEnvFromFile('SUPABASE_SERVICE_ROLE_KEY') || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  // eslint-disable-next-line no-console
  console.warn('[api] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

function json(res, statusCode, payload) {
  res.status(statusCode).setHeader('Content-Type', 'application/json').send(JSON.stringify(payload));
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function getBearerToken(req) {
  const auth = req.headers?.authorization || req.headers?.Authorization;
  if (!auth || typeof auth !== 'string') return '';
  if (!auth.startsWith('Bearer ')) return '';
  return auth.slice('Bearer '.length).trim();
}

async function getUserFromRequest(req) {
  const token = getBearerToken(req);
  if (!token) return { user: null, error: 'missing_token' };
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return { user: null, error: 'invalid_token' };
  return { user: data.user, error: null };
}

function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed);
  return json(res, 405, { error: 'method_not_allowed' });
}

module.exports = {
  SUPABASE_URL,
  supabaseAdmin,
  json,
  parseBody,
  getUserFromRequest,
  methodNotAllowed
};
