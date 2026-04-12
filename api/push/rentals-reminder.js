const { json, methodNotAllowed, supabaseAdmin } = require('../_lib/common');
const { sendPushToUsers } = require('../_lib/pushSender');

const TIMEZONE = 'Europe/Lisbon';
const TARGET_ROLES = ['admin', 'manager', 'employee'];

function parseLisbonNow(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value || '';

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour'))
  };
}

function addDaysIso(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function pickReminderBody(arrivalsCount, hasCleaning) {
  if (arrivalsCount > 0 && hasCleaning) {
    return `Amanhã: ${arrivalsCount} chegada(s) e limpeza prevista.`;
  }
  if (arrivalsCount > 0) {
    return `Amanhã: ${arrivalsCount} chegada(s) prevista(s).`;
  }
  return 'Amanhã: limpeza prevista.';
}

function hasValidCallerSecret(req) {
  const querySecret = String(req.query?.secret || '');
  const expectedPushSecret = process.env.PUSH_INTERNAL_SECRET || '';
  const sentPushSecret = String(req.headers['x-push-secret'] || '');
  if (
    expectedPushSecret &&
    ((sentPushSecret && sentPushSecret === expectedPushSecret) || (querySecret && querySecret === expectedPushSecret))
  ) {
    return true;
  }

  const cronSecret = process.env.CRON_SECRET || '';
  const authHeader = String(req.headers.authorization || req.headers.Authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  if (cronSecret && token && token === cronSecret) {
    return true;
  }

  return false;
}

async function findRecipientUserIds() {
  const { data: whitelistRows, error: whitelistError } = await supabaseAdmin
    .from('access_whitelist')
    .select('email, role')
    .in('role', TARGET_ROLES);
  if (whitelistError) {
    throw new Error(whitelistError.message || 'whitelist_lookup_failed');
  }

  const allowedEmails = new Set(
    (whitelistRows || [])
      .map((row) => String(row.email || '').toLowerCase().trim())
      .filter(Boolean)
  );
  if (!allowedEmails.size) return [];

  const perPage = 1000;
  let page = 1;
  const allUsers = [];
  while (true) {
    const { data: usersData, error: usersError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (usersError) throw new Error(usersError.message || 'auth_users_lookup_failed');
    const users = usersData?.users || [];
    allUsers.push(...users);
    if (users.length < perPage) break;
    page += 1;
  }

  const userIds = allUsers
    .filter((user) => allowedEmails.has(String(user.email || '').toLowerCase().trim()))
    .map((user) => user.id)
    .filter(Boolean);

  return Array.from(new Set(userIds));
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST', 'HEAD'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'POST', 'HEAD']);
  if (!hasValidCallerSecret(req)) return json(res, 401, { error: 'unauthorized' });

  const nowLisbon = parseLisbonNow();
  const todayIso = `${nowLisbon.year}-${String(nowLisbon.month).padStart(2, '0')}-${String(nowLisbon.day).padStart(2, '0')}`;
  const tomorrowIso = addDaysIso(todayIso, 1);

  if (nowLisbon.hour !== 9) {
    return json(res, 200, {
      success: true,
      skipped: true,
      reason: 'outside_target_hour',
      timezone: TIMEZONE,
      currentHour: nowLisbon.hour,
      targetHour: 9,
      targetDate: tomorrowIso
    });
  }

  const [{ data: arrivals, error: arrivalsError }, { data: cleaningRows, error: cleaningError }] = await Promise.all([
    supabaseAdmin
      .from('bookings')
      .select('id')
      .eq('start_date', tomorrowIso),
    supabaseAdmin
      .from('day_blocks')
      .select('id')
      .eq('date', tomorrowIso)
      .eq('type', 'cleaning')
      .limit(1)
  ]);

  if (arrivalsError) return json(res, 500, { error: arrivalsError.message || 'bookings_lookup_failed' });
  if (cleaningError) return json(res, 500, { error: cleaningError.message || 'cleaning_lookup_failed' });

  const arrivalsCount = (arrivals || []).length;
  const hasCleaning = Boolean((cleaningRows || []).length);
  if (!arrivalsCount && !hasCleaning) {
    return json(res, 200, {
      success: true,
      skipped: true,
      reason: 'no_activity_tomorrow',
      targetDate: tomorrowIso
    });
  }

  let userIds = [];
  try {
    userIds = await findRecipientUserIds();
  } catch (err) {
    return json(res, 500, { error: err.message || 'recipient_lookup_failed' });
  }

  if (!userIds.length) {
    return json(res, 200, {
      success: true,
      skipped: true,
      reason: 'no_recipients',
      targetDate: tomorrowIso
    });
  }

  const pushResult = await sendPushToUsers({
    userIds,
    title: 'Lembrete CASA DA AUDIENCIA',
    body: pickReminderBody(arrivalsCount, hasCleaning),
    data: {
      type: 'rental_reminder',
      date: tomorrowIso,
      arrivalsCount,
      hasCleaning
    }
  });

  return json(res, 200, {
    success: true,
    sent: true,
    targetDate: tomorrowIso,
    timezone: TIMEZONE,
    arrivalsCount,
    hasCleaning,
    recipients: userIds.length,
    pushResult
  });
};
