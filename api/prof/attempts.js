const {
  json,
  getUserFromRequest,
  methodNotAllowed,
  supabaseAdmin
} = require('../../api-lib/common');
const { applyCors, handlePreflight } = require('../../api-lib/cors');

function normalizeTitle(title) {
  return String(title || '').replace(/^(correction\s+)+/i, '').trim();
}

function buildExerciseKey(row) {
  const payload = row.payload || {};
  const source = String(payload.correction_source_id || '').trim();
  if (source) return `source:${source}`;
  const student = String(row.student_user_id || '');
  const test = String(row.test_id || '');
  if (test === 'test1') {
    return `t1:${student}:${payload.verb || ''}:${payload.tense || ''}:${payload.person || ''}`;
  }
  if (test === 'test9') {
    return `t9:${student}:${payload.preview || payload.title || ''}`;
  }
  if (test === 'test10') {
    return `t10:${student}:${payload.ref || payload.titre || ''}`;
  }
  if (test === 'test11') {
    return `t11:${student}:${payload.question || ''}`;
  }
  return `legacy:${student}:${test}:${normalizeTitle(row.title)}`;
}

function mergePayload(basePayload, candidatePayload) {
  const base = basePayload || {};
  const candidate = candidatePayload || {};
  return {
    ...base,
    ...candidate,
    answer: base.answer ?? candidate.answer,
    answers: base.answers ?? candidate.answers,
    text: base.text ?? candidate.text,
    correction_answer: candidate.correction_answer ?? base.correction_answer,
    correction_answers: candidate.correction_answers ?? base.correction_answers,
    correction_text: candidate.correction_text ?? base.correction_text,
    correction_checks: candidate.correction_checks ?? base.correction_checks
  };
}

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  applyCors(req, res);
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
    .select('id, student_user_id, student_email, test_id, title, summary, score, payload, created_at, updated_at, prof_read_at')
    .eq('teacher_email', adminEmail)
    .order('created_at', { ascending: false });
  if (error) return json(res, 500, { error: error.message || 'attempts_lookup_failed' });

  const rows = data || [];
  const referencedSourceIds = new Set(
    rows
      .map((row) => String((row.payload || {}).correction_source_id || '').trim())
      .filter(Boolean)
  );

  const dedupedByExercise = new Map();
  rows.forEach((row) => {
    const payload = row.payload || {};
    const sourceFromPayload = String(payload.correction_source_id || '').trim();
    let exerciseKey = '';
    if (sourceFromPayload) {
      exerciseKey = `source:${sourceFromPayload}`;
    } else if (referencedSourceIds.has(String(row.id))) {
      exerciseKey = `source:${row.id}`;
    } else {
      exerciseKey = buildExerciseKey(row);
    }
    const normalizedTitle = normalizeTitle(row.title);
    if (!dedupedByExercise.has(exerciseKey)) {
      dedupedByExercise.set(exerciseKey, {
        ...row,
        title: normalizedTitle,
        exercise_key: exerciseKey
      });
      return;
    }
    const previous = dedupedByExercise.get(exerciseKey);
    const previousDate = new Date(previous.created_at).getTime();
    const currentDate = new Date(row.created_at).getTime();
    const latest = currentDate >= previousDate ? row : previous;
    const oldest = currentDate >= previousDate ? previous : row;
    dedupedByExercise.set(exerciseKey, {
      ...latest,
      title: normalizeTitle(latest.title),
      payload: mergePayload(oldest.payload, latest.payload),
      exercise_key: exerciseKey
    });
  });
  const dedupedRows = Array.from(dedupedByExercise.values());

  const studentIds = [...new Set(dedupedRows.map((row) => row.student_user_id).filter(Boolean))];
  let usernameById = {};
  if (studentIds.length) {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, username')
      .in('id', studentIds);
    usernameById = Object.fromEntries((profiles || []).map((profile) => [profile.id, profile.username || '']));
  }

  const enriched = dedupedRows.map((row) => ({
    ...row,
    student_username: usernameById[row.student_user_id] || ''
  }));

  return json(res, 200, { data: enriched });
};
