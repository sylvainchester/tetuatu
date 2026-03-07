import { createElement, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { fetchProfAttempt, listProfAttempts, markProfAttemptRead, submitProfReview } from '@/lib/exerciseApi';

type AttemptSummary = {
  id: string;
  student_user_id: string;
  student_username: string;
  exercise_key?: string;
  test_id: string;
  title: string;
  summary: string;
  score: number | null;
  payload: Record<string, any>;
  created_at: string;
  updated_at?: string | null;
  prof_read_at?: string | null;
};

type AttemptDetail = AttemptSummary & {
  payload: Record<string, any>;
};

type DropdownOption = {
  label: string;
  value: string;
};

function SimpleDropdown({
  label,
  options,
  value,
  onChange
}: {
  label: string;
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (Platform.OS === 'web') {
    return (
      <View style={styles.filterField}>
        <Text style={styles.filterLabel}>{label}</Text>
        {createElement(
          'select',
          {
            value,
            onChange: (event: any) => onChange(event.target.value),
            style: {
              width: '100%',
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: '#334155',
              borderRadius: '10px',
              backgroundColor: '#0f172a',
              color: '#f8fafc',
              padding: '9px 11px',
              fontSize: '13px',
              appearance: 'none'
            }
          },
          options.map((option) => createElement('option', { key: `${label}-${option.value}`, value: option.value }, option.label))
        )}
      </View>
    );
  }

  const selectedLabel = options.find((item) => item.value === value)?.label || 'Selectionner';
  const openPicker = () => {
    Alert.alert(
      label,
      'Choisir une option',
      options.map((option) => ({ text: option.label, onPress: () => onChange(option.value) }))
    );
  };
  return (
    <View style={styles.filterField}>
      <Text style={styles.filterLabel}>{label}</Text>
      <Pressable style={styles.mobileFilterButton} onPress={openPicker}>
        <Text style={styles.mobileFilterText}>{selectedLabel}</Text>
      </Pressable>
    </View>
  );
}

function prettyDate(value: string) {
  return value.slice(0, 19).replace('T', ' ');
}

function humanizeKey(key: string) {
  const map: Record<string, string> = {
    minimumWords: 'Minimum mots',
    exactCount: 'Phrases exactes',
    mistakes: 'Fautes',
    testId: 'Test',
    title: 'Exercice',
    categorie: 'Categorie',
    niveau: 'Niveau',
    langue: 'Langue',
    words: 'Nombre de mots',
    score: 'Score'
  };
  return map[key] || key;
}

function toGenericRows(payload: Record<string, any>) {
  return Object.entries(payload || {})
    .filter(([key]) => !['answers', 'expected', 'checks', 'text'].includes(key))
    .map(([key, value]) => {
      if (Array.isArray(value)) return { label: humanizeKey(key), value: value.join(', ') };
      if (typeof value === 'object' && value) return { label: humanizeKey(key), value: JSON.stringify(value) };
      return { label: humanizeKey(key), value: String(value ?? '-') };
    });
}

function isAttemptCorrect(attempt: AttemptSummary | AttemptDetail) {
  if (typeof attempt.score === 'number') return attempt.score >= 1;
  const summary = String(attempt.summary || '').toLowerCase();
  if (!summary) return false;
  if (summary.includes('a corriger') || summary.includes('faute') || summary.includes('incorrect')) return false;
  return summary.includes('correct');
}

function hasCorrectionPayload(payload: Record<string, any>) {
  return Boolean(
    payload?.correction_source_id ||
      payload?.correction_answer ||
      payload?.correction_text ||
      (Array.isArray(payload?.correction_answers) && payload.correction_answers.length)
  );
}

function attemptStatus(attempt: AttemptSummary | AttemptDetail) {
  const ok = isAttemptCorrect(attempt);
  const corrected = hasCorrectionPayload((attempt as AttemptDetail).payload || {});
  if (ok && corrected) return 'corrected' as const;
  if (ok) return 'correct_first_try' as const;
  return 'to_fix' as const;
}

function initialResponseForAttempt(attempt: AttemptDetail) {
  const payload = attempt.payload || {};
  if (attempt.test_id === 'test1') return String(payload.answer || '(vide)');
  if (attempt.test_id === 'test9') return Array.isArray(payload.answers) ? payload.answers.join(' | ') : '(vide)';
  if (attempt.test_id === 'test10') {
    if (!Array.isArray(payload.answers)) return '(vide)';
    return payload.answers.map((item: any, index: number) => `P${index + 1}: ${item?.typed || '(vide)'}`).join(' | ');
  }
  if (attempt.test_id === 'test11') return String(payload.text || '(vide)');
  return '(vide)';
}

function latestCorrectionForAttempt(attempt: AttemptDetail) {
  const payload = attempt.payload || {};
  if (attempt.test_id === 'test1') return String(payload.correction_answer || '(aucune)');
  if (attempt.test_id === 'test9') return Array.isArray(payload.correction_answers) ? payload.correction_answers.join(' | ') : '(aucune)';
  if (attempt.test_id === 'test10') return String(payload.correction_answer || '(aucune)');
  if (attempt.test_id === 'test11') return String(payload.correction_text || '(aucune)');
  return '(aucune)';
}

function expectedAnswerForAttempt(attempt: AttemptDetail) {
  const payload = attempt.payload || {};
  if (attempt.test_id === 'test1') return String(payload.expected || '(non disponible)');
  if (attempt.test_id === 'test9') {
    return Array.isArray(payload.expected) ? payload.expected.map((value: string, index: number) => `[${index + 1}] ${value}`).join(' | ') : '(non disponible)';
  }
  if (attempt.test_id === 'test10') {
    if (payload.correction_expected) return String(payload.correction_expected);
    if (Array.isArray(payload.answers)) {
      return payload.answers.map((item: any, index: number) => `P${index + 1}: ${item?.expected || '-'}`).join(' | ');
    }
    return '(non disponible)';
  }
  if (attempt.test_id === 'test11') {
    return `Minimum ${payload.minimumWords || 0} mots`;
  }
  return '(non disponible)';
}

function parseTimestamp(value: any) {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) ? ts : null;
}

function canReviewRedaction(attempt: AttemptDetail | null) {
  if (!attempt || attempt.test_id !== 'test11') return true;
  const payload = attempt.payload || {};
  if (payload.prof_decision === 'correct') return false;
  if (payload.prof_decision !== 'a_corriger') return true;
  const reviewedAt = parseTimestamp(payload.prof_reviewed_at);
  const submittedAt = parseTimestamp(payload.correction_submitted_at);
  if (!submittedAt) return false;
  if (!reviewedAt) return true;
  return submittedAt > reviewedAt;
}

function redactionReviewLockReason(attempt: AttemptDetail | null) {
  if (!attempt || attempt.test_id !== 'test11') return '';
  const payload = attempt.payload || {};
  if (payload.prof_decision === 'correct') {
    return 'Validation finale deja faite.';
  }
  if (payload.prof_decision === 'a_corriger' && !canReviewRedaction(attempt)) {
    return 'En attente d une nouvelle version eleve.';
  }
  return '';
}

export default function ProfDashboardScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [selected, setSelected] = useState<AttemptDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [studentFilter, setStudentFilter] = useState('all');
  const [testFilter, setTestFilter] = useState('all');
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewInfo, setReviewInfo] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      try {
        const payload = await listProfAttempts();
        setAttempts(payload.data || []);
      } catch (err: any) {
        setError(err.message || 'Erreur chargement dashboard.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function openAttempt(id: string) {
    setDetailLoading(true);
    setError('');
    try {
      const payload = await fetchProfAttempt(id);
      setSelected(payload.data || null);
      setReviewComment(String(payload.data?.payload?.prof_comment || ''));
      setReviewInfo('');
      const mark = await markProfAttemptRead(id);
      const readAt = mark?.data?.prof_read_at || new Date().toISOString();
      setAttempts((prev) => prev.map((item) => (item.id === id ? { ...item, prof_read_at: readAt } : item)));
    } catch (err: any) {
      setError(err.message || 'Erreur chargement detail.');
    } finally {
      setDetailLoading(false);
    }
  }

  async function submitReview(decision: 'correct' | 'a_corriger') {
    if (!selected) return;
    if (selected.test_id === 'test11' && !canReviewRedaction(selected)) {
      setReviewInfo(redactionReviewLockReason(selected) || 'En attente de correction eleve.');
      return;
    }
    const currentId = selected.id;
    setReviewSaving(true);
    setReviewInfo('');
    try {
      const payload = await submitProfReview({
        id: currentId,
        decision,
        comment: reviewComment
      });
      const data = payload?.data;
      if (data) {
        setSelected((prev) => (prev ? { ...prev, ...data, payload: data.payload || prev.payload } : prev));
        setAttempts((prev) =>
          prev.map((item) =>
            item.id === currentId
              ? {
                  ...item,
                  summary: data.summary || item.summary,
                  score: data.score ?? item.score,
                  payload: data.payload || item.payload,
                  prof_read_at: data.prof_read_at || item.prof_read_at
                }
              : item
          )
        );
      }
      setReviewInfo(decision === 'correct' ? 'Evaluation enregistree: Correct.' : 'Evaluation enregistree: A corriger.');
      setSelected(null);
    } catch (err: any) {
      setReviewInfo(err.message || 'Erreur enregistrement evaluation.');
    } finally {
      setReviewSaving(false);
    }
  }

  const studentOptions = useMemo(() => {
    const values = Array.from(new Set(attempts.map((item) => (item.student_username || '').trim()).filter(Boolean)));
    return [{ label: 'Tous les eleves', value: 'all' }, ...values.map((value) => ({ label: value, value }))];
  }, [attempts]);

  const testOptions = useMemo(() => {
    const map: Record<string, string> = {
      test1: 'Conjugaison',
      test9: 'Orthographe',
      test10: 'Dictee',
      test11: 'Redaction'
    };
    const values = Array.from(new Set(attempts.map((item) => item.test_id).filter(Boolean)));
    return [{ label: 'Tous les exercices', value: 'all' }, ...values.map((value) => ({ label: map[value] || value, value }))];
  }, [attempts]);

  const filteredAttempts = useMemo(() => {
    return attempts.filter((attempt) => {
      const studentValue = (attempt.student_username || '').trim();
      if (studentFilter !== 'all' && studentValue !== studentFilter) return false;
      if (testFilter !== 'all' && attempt.test_id !== testFilter) return false;
      return true;
    });
  }, [attempts, studentFilter, testFilter]);
  const redactionCanReview = canReviewRedaction(selected);
  const redactionLockReason = redactionReviewLockReason(selected);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.background} />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Retour</Text>
          </Pressable>
          <Text style={styles.title}>Suivi des exercices</Text>
          <Text style={styles.subtitle}>Exercices eleves, du plus recent au plus ancien.</Text>
        </View>

        {loading ? (
          <View style={styles.block}>
            <Text style={styles.muted}>Chargement...</Text>
          </View>
        ) : null}
        {error ? (
          <View style={styles.block}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}

        {!loading ? (
          <View style={styles.block}>
            <View style={styles.filtersRow}>
              <SimpleDropdown label="Eleve" options={studentOptions} value={studentFilter} onChange={setStudentFilter} />
              <SimpleDropdown label="Exercice" options={testOptions} value={testFilter} onChange={setTestFilter} />
            </View>
            <Text style={styles.sectionTitle}>Exercices recus</Text>
            {!filteredAttempts.length ? <Text style={styles.muted}>Aucun exercice pour ce filtre.</Text> : null}
            {filteredAttempts.map((attempt) => {
              const baseline = attempt.updated_at || attempt.created_at;
              const hasOpened =
                !!attempt.prof_read_at &&
                !!baseline &&
                new Date(attempt.prof_read_at).getTime() >= new Date(baseline).getTime();
              const studentLabel = attempt.student_username || 'Profil inconnu';
              const status = attemptStatus(attempt);
              const statusLabel =
                status === 'correct_first_try' ? 'CORRECT' : status === 'corrected' ? 'CORRIGÉ' : 'A CORRIGER';
              return (
                <Pressable
                  key={attempt.id}
                  style={[
                    styles.row,
                    status === 'correct_first_try'
                      ? styles.rowCorrect
                      : status === 'corrected'
                        ? styles.rowCorrected
                        : styles.rowIncorrect,
                    hasOpened ? styles.rowRead : styles.rowUnread
                  ]}
                  onPress={() => openAttempt(attempt.id)}
                >
                  <View style={styles.rowHead}>
                    <Text style={[styles.rowTitle, !hasOpened && styles.rowTitleUnread]}>
                      {studentLabel} • {attempt.title}
                    </Text>
                    <View style={styles.badgesRow}>
                      <View
                        style={[
                          styles.statusBadge,
                          status === 'correct_first_try'
                            ? styles.statusCorrect
                            : status === 'corrected'
                              ? styles.statusCorrected
                              : styles.statusIncorrect
                        ]}
                      >
                        <Text style={styles.statusBadgeText}>{statusLabel}</Text>
                      </View>
                      <View style={[styles.statusBadge, hasOpened ? styles.statusRead : styles.statusUnread]}>
                        <Text style={styles.statusBadgeText}>{hasOpened ? 'LU' : 'NOUVEAU'}</Text>
                      </View>
                    </View>
                  </View>
                  <Text style={styles.rowMeta}>{prettyDate(attempt.created_at)}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {detailLoading ? (
          <View style={styles.block}>
            <Text style={styles.muted}>Chargement detail...</Text>
          </View>
        ) : null}

        <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.sectionTitle}>
                  {selected?.test_id === 'test11' ? 'Detail redaction' : 'Detail resultat'}
                </Text>
                <Pressable onPress={() => setSelected(null)} style={styles.closeButton}>
                  <Text style={styles.closeButtonText}>Fermer</Text>
                </Pressable>
              </View>
              {selected ? (
                <ScrollView style={styles.modalBody}>
                  {selected.test_id === 'test11' ? (
                    <View style={styles.detailGroup}>
                      <Text style={styles.detailLine}>
                        Eleve: {(attempts.find((item) => item.id === selected.id)?.student_username || '') || 'Profil inconnu'}
                      </Text>
                      <Text style={styles.detailLine}>Date: {prettyDate(selected.created_at)}</Text>
                      <Text style={styles.detailLine}>Sujet: {String(selected.payload?.question || '-')}</Text>

                      <Text style={styles.detailGroupTitle}>Texte élève initial</Text>
                      <TextInput
                        value={String(selected.payload?.text || '')}
                        editable={false}
                        multiline
                        style={[styles.reviewInput, styles.readOnlyInput]}
                        placeholder="(vide)"
                        placeholderTextColor="#64748b"
                      />

                      <Text style={styles.detailGroupTitle}>Commentaire du prof</Text>
                      <TextInput
                        value={reviewComment}
                        onChangeText={setReviewComment}
                        multiline
                        editable={redactionCanReview && !reviewSaving}
                        style={[styles.reviewInput, (!redactionCanReview || reviewSaving) && styles.readOnlyInput]}
                        placeholder="Commentaire..."
                        placeholderTextColor="#64748b"
                      />

                      <Text style={styles.detailGroupTitle}>Nouvelle réponse de l&apos;élève</Text>
                      <TextInput
                        value={String(selected.payload?.correction_text || '')}
                        editable={false}
                        multiline
                        style={[styles.reviewInput, styles.readOnlyInput]}
                        placeholder="(aucune nouvelle réponse)"
                        placeholderTextColor="#64748b"
                      />

                      {redactionCanReview ? (
                        <View style={styles.reviewButtonsRow}>
                          <Pressable
                            style={[
                              styles.reviewDecisionButton,
                              styles.reviewDecisionCorrect,
                              reviewSaving && styles.buttonDisabled
                            ]}
                            disabled={reviewSaving}
                            onPress={() => submitReview('correct')}
                          >
                            <Text style={styles.reviewDecisionText}>Correct</Text>
                          </Pressable>
                          <Pressable
                            style={[
                              styles.reviewDecisionButton,
                              styles.reviewDecisionFix,
                              reviewSaving && styles.buttonDisabled
                            ]}
                            disabled={reviewSaving}
                            onPress={() => submitReview('a_corriger')}
                          >
                            <Text style={styles.reviewDecisionText}>A corriger</Text>
                          </Pressable>
                        </View>
                      ) : null}
                      {redactionLockReason ? <Text style={styles.muted}>{redactionLockReason}</Text> : null}
                      {reviewInfo ? <Text style={styles.muted}>{reviewInfo}</Text> : null}
                    </View>
                  ) : (
                    <>
                      <Text style={styles.detailLine}>
                        Eleve: {(attempts.find((item) => item.id === selected.id)?.student_username || '') || 'Profil inconnu'}
                      </Text>
                      <Text style={styles.detailLine}>Exercice: {selected.title}</Text>
                      <Text style={styles.detailLine}>Test: {selected.test_id}</Text>
                      <Text style={styles.detailLine}>Date: {prettyDate(selected.created_at)}</Text>
                      <Text style={styles.detailLine}>Score: {selected.score ?? '-'}</Text>
                      <Text style={styles.detailLine}>Reponse initiale: {initialResponseForAttempt(selected)}</Text>
                      <Text style={styles.detailLine}>Derniere correction: {latestCorrectionForAttempt(selected)}</Text>
                      <Text style={styles.detailLine}>Reponse attendue: {expectedAnswerForAttempt(selected)}</Text>

                      {selected.test_id === 'test10' && Array.isArray(selected.payload?.answers) ? (
                        <View style={styles.detailGroup}>
                          <Text style={styles.detailGroupTitle}>Phrases corrigees</Text>
                          {selected.payload.answers.map((item: any, index: number) => (
                            <View key={`ans-${index}`} style={styles.answerCard}>
                              <Text style={styles.answerTitle}>Phrase {index + 1}</Text>
                              <Text style={styles.answerLine}>Saisi: {item.typed || '(vide)'}</Text>
                              <Text style={styles.answerLine}>Attendu: {item.expected || '-'}</Text>
                              <Text style={styles.answerLine}>
                                Statut: {item.exact ? 'Correct' : `A corriger (${item.mistakes || 0} faute(s))`}
                              </Text>
                            </View>
                          ))}
                        </View>
                      ) : null}

                      {selected.test_id === 'test9' ? (
                        <View style={styles.detailGroup}>
                          <Text style={styles.detailGroupTitle}>Reponses</Text>
                          {Array.isArray(selected.payload?.expected) &&
                          Array.isArray(selected.payload?.answers) &&
                          Array.isArray(selected.payload?.checks)
                            ? selected.payload.expected.map((expected: string, index: number) => (
                                <View key={`t9-${index}`} style={styles.answerCard}>
                                  <Text style={styles.answerTitle}>Trou {index + 1}</Text>
                                  <Text style={styles.answerLine}>Saisi: {selected.payload.answers[index] || '(vide)'}</Text>
                                  <Text style={styles.answerLine}>Attendu: {expected}</Text>
                                  <Text style={styles.answerLine}>
                                    Statut: {selected.payload.checks[index] ? 'Correct' : 'A corriger'}
                                  </Text>
                                </View>
                              ))
                            : null}
                        </View>
                      ) : null}

                      <View style={styles.detailGroup}>
                        <Text style={styles.detailGroupTitle}>Infos</Text>
                        {toGenericRows(selected.payload || {}).map((row) => (
                          <View key={row.label} style={styles.infoRow}>
                            <Text style={styles.infoLabel}>{row.label}</Text>
                            <Text style={styles.infoValue}>{row.value || '-'}</Text>
                          </View>
                        ))}
                        {typeof selected.payload?.text === 'string' && selected.payload.text.trim() ? (
                          <View style={styles.answerCard}>
                            <Text style={styles.answerTitle}>Texte eleve</Text>
                            <Text style={styles.answerLine}>{selected.payload.text}</Text>
                          </View>
                        ) : null}
                      </View>
                    </>
                  )}
                </ScrollView>
              ) : null}
            </View>
          </View>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0f1a' },
  background: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0b0f1a' },
  container: { padding: 20, paddingBottom: 40, gap: 12 },
  header: { marginBottom: 8 },
  back: { color: '#e2e8f0', marginBottom: 8 },
  title: { fontSize: 26, color: '#f8fafc', fontFamily: 'serif' },
  subtitle: { marginTop: 6, color: '#94a3b8' },
  block: {
    backgroundColor: '#111827',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    gap: 8
  },
  sectionTitle: { color: '#f8fafc', fontWeight: '700', fontSize: 16 },
  filtersRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap'
  },
  filterField: {
    minWidth: 220,
    flexGrow: 1,
    gap: 4
  },
  filterLabel: {
    color: '#94a3b8',
    fontSize: 12
  },
  mobileFilterButton: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    backgroundColor: '#0f172a',
    paddingHorizontal: 11,
    paddingVertical: 9
  },
  mobileFilterText: {
    color: '#f8fafc'
  },
  row: {
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    paddingTop: 8,
    paddingHorizontal: 8,
    paddingBottom: 10,
    borderRadius: 12
  },
  rowUnread: {
    backgroundColor: '#132338'
  },
  rowRead: {
    opacity: 0.78
  },
  rowCorrect: {
    backgroundColor: '#052e16',
    borderColor: '#166534'
  },
  rowCorrected: {
    backgroundColor: '#5b3a0a',
    borderColor: '#c2410c'
  },
  rowIncorrect: {
    backgroundColor: '#3b0a0a',
    borderColor: '#7f1d1d'
  },
  rowHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10
  },
  badgesRow: {
    flexDirection: 'row',
    gap: 6
  },
  rowTitle: { color: '#f8fafc', fontWeight: '600' },
  rowTitleUnread: { fontWeight: '800' },
  rowMeta: { color: '#94a3b8', fontSize: 12 },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  statusUnread: {
    backgroundColor: '#22c55e'
  },
  statusRead: {
    backgroundColor: '#334155'
  },
  statusCorrect: {
    backgroundColor: '#22c55e'
  },
  statusCorrected: {
    backgroundColor: '#fb923c'
  },
  statusIncorrect: {
    backgroundColor: '#ef4444'
  },
  statusBadgeText: {
    color: '#020617',
    fontWeight: '800',
    fontSize: 11
  },
  detailLine: { color: '#e2e8f0' },
  detailGroup: { marginTop: 10, gap: 8 },
  detailGroupTitle: { color: '#cbd5e1', fontWeight: '700', fontSize: 14 },
  answerCard: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    backgroundColor: '#0f172a',
    padding: 10,
    gap: 4
  },
  answerTitle: { color: '#f8fafc', fontWeight: '700' },
  answerLine: { color: '#e2e8f0', fontSize: 13 },
  infoRow: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 10,
    backgroundColor: '#0b1220',
    padding: 8,
    gap: 3
  },
  infoLabel: { color: '#94a3b8', fontSize: 12, textTransform: 'uppercase' },
  infoValue: { color: '#e2e8f0' },
  reviewInput: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    paddingHorizontal: 10,
    paddingVertical: 10,
    minHeight: 100,
    textAlignVertical: 'top',
    fontSize: 18,
    lineHeight: 24
  },
  readOnlyInput: {
    opacity: 0.75
  },
  reviewButtonsRow: {
    flexDirection: 'row',
    gap: 10
  },
  reviewDecisionButton: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 10,
    paddingVertical: 10
  },
  reviewDecisionCorrect: {
    backgroundColor: '#22c55e'
  },
  reviewDecisionFix: {
    backgroundColor: '#ef4444'
  },
  reviewDecisionText: {
    color: '#020617',
    fontWeight: '800'
  },
  muted: { color: '#94a3b8' },
  error: { color: '#fca5a5' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
    justifyContent: 'center',
    padding: 20
  },
  modalCard: {
    maxHeight: '85%',
    backgroundColor: '#111827',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 14
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  modalBody: {
    maxHeight: 520
  },
  closeButton: {
    backgroundColor: '#1f2937',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#334155'
  },
  closeButtonText: {
    color: '#e2e8f0',
    fontWeight: '700'
  }
});
