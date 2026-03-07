import { createElement, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import VirtualKeyboardInput from '@/components/VirtualKeyboardInput';
import { listStudentCorrections, submitExerciseAttempt } from '@/lib/exerciseApi';

type CorrectionAttempt = {
  id: string;
  test_id: string;
  title: string;
  summary: string;
  score: number | null;
  payload: Record<string, any>;
  created_at: string;
};

type DropdownOption = {
  label: string;
  value: string;
};

function SimpleDropdown({
  label,
  options,
  value,
  onChange,
  disabled
}: {
  label: string;
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  if (Platform.OS === 'web') {
    return (
      <View style={styles.group}>
        <Text style={styles.label}>{label}</Text>
        {createElement(
          'select',
          {
            value,
            disabled: !!disabled,
            onChange: (event: any) => onChange(event.target.value),
            style: {
              width: '100%',
              borderWidth: '1px',
              borderStyle: 'solid',
              borderColor: '#334155',
              borderRadius: '12px',
              backgroundColor: '#0f172a',
              color: '#f8fafc',
              padding: '10px 12px',
              fontSize: '14px',
              appearance: 'none'
            }
          },
          options.map((option) =>
            createElement('option', { key: `${label}-${option.value}`, value: option.value }, option.label)
          )
        )}
      </View>
    );
  }

  const selectedLabel = options.find((item) => item.value === value)?.label || 'Selectionner';
  const openPicker = () => {
    if (disabled || !options.length) return;
    Alert.alert(
      label,
      'Choisir une option',
      options.map((option) => ({ text: option.label, onPress: () => onChange(option.value) }))
    );
  };

  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.input}>
        <Text style={styles.prompt}>{selectedLabel}</Text>
      </View>
      <Pressable style={[styles.button, disabled && styles.buttonDisabled]} onPress={openPicker} disabled={disabled}>
        <Text style={styles.buttonText}>Choisir</Text>
      </Pressable>
    </View>
  );
}

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function prettyDate(value: string) {
  return value.slice(0, 19).replace('T', ' ');
}

function firstIncorrectDictationPhrase(payload: Record<string, any>) {
  const answers = Array.isArray(payload?.answers) ? payload.answers : [];
  return answers.find((item: any) => !item?.exact) || null;
}

function buildCorrectionTitle(title: string) {
  const base = String(title || '').replace(/^(correction\s+)+/i, '').trim();
  return `Correction ${base || 'Exercice'}`.trim();
}

export default function StudentCorrectionsScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [items, setItems] = useState<CorrectionAttempt[]>([]);
  const [selected, setSelected] = useState<CorrectionAttempt | null>(null);
  const [answer, setAnswer] = useState('');
  const [answerList, setAnswerList] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [pageInfo, setPageInfo] = useState('');
  const [submittedOnce, setSubmittedOnce] = useState(false);
  const [lastIsCorrect, setLastIsCorrect] = useState<boolean | null>(null);
  const correctionMinimumWords = Number(selected?.payload?.minimumWords || 0);
  const correctionWords = selected?.test_id === 'test11' ? wordCount(answer) : 0;
  const canSubmitCorrection = selected?.test_id === 'test11' ? correctionWords >= correctionMinimumWords : true;

  async function reload() {
    setLoading(true);
    setError('');
    try {
      const payload = await listStudentCorrections();
      setItems(payload.data || []);
    } catch (err: any) {
      setError(err.message || 'Erreur chargement corrections.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  const expectedForSelected = useMemo(() => {
    if (!selected) return '';
    if (selected.test_id === 'test1') return String(selected.payload?.expected || '');
    if (selected.test_id === 'test10') return String(firstIncorrectDictationPhrase(selected.payload)?.expected || '');
    return '';
  }, [selected]);

  function openItem(item: CorrectionAttempt) {
    setSelected(item);
    const prefill =
      item.test_id === 'test11'
        ? String(item.payload?.correction_text || item.payload?.text || '')
        : '';
    setAnswer(prefill);
    const expected = Array.isArray(item.payload?.expected) ? item.payload.expected : [];
    setAnswerList(expected.map(() => ''));
    setFeedback('');
    setPageInfo('');
    setSubmittedOnce(false);
    setLastIsCorrect(null);
  }

  async function submitCorrection() {
    if (!selected) return;
    setSubmitting(true);
    setFeedback('');
    setPageInfo('');
    setSubmittedOnce(false);
    setLastIsCorrect(null);
    try {
      if (selected.test_id === 'test1' || selected.test_id === 'test10') {
        const expected = expectedForSelected;
        const ok = normalize(answer) === normalize(expected);
        await submitExerciseAttempt({
          testId: selected.test_id,
          title: buildCorrectionTitle(selected.title),
          summary: ok ? 'Correct' : 'A corriger',
          score: ok ? 1 : 0,
          payload: {
            ...selected.payload,
            correction_source_id: selected.id,
            correction_answer: answer,
            correction_expected: expected
          }
        });
        await reload();
        setSubmittedOnce(true);
        setLastIsCorrect(ok);
        setFeedback(ok ? 'Bonne reponse: correction validee.' : 'Mauvaise reponse: exercice toujours a corriger.');
        setPageInfo(ok ? 'Correction validee.' : 'Correction enregistree. Reprends-la depuis la liste.');
      } else if (selected.test_id === 'test9') {
        const expected = Array.isArray(selected.payload?.expected) ? selected.payload.expected : [];
        const checks = expected.map((item: string, index: number) => normalize(item) === normalize(answerList[index] || ''));
        const ok = checks.every(Boolean);
        const score = checks.length ? checks.filter(Boolean).length / checks.length : 0;
        await submitExerciseAttempt({
          testId: selected.test_id,
          title: buildCorrectionTitle(selected.title),
          summary: ok ? 'Correct' : 'A corriger',
          score,
          payload: {
            ...selected.payload,
            correction_source_id: selected.id,
            correction_answers: answerList,
            correction_checks: checks
          }
        });
        await reload();
        setSubmittedOnce(true);
        setLastIsCorrect(ok);
        setFeedback(ok ? 'Bonne reponse: correction validee.' : 'Mauvaise reponse: exercice toujours a corriger.');
        setPageInfo(ok ? 'Correction validee.' : 'Correction enregistree. Reprends-la depuis la liste.');
      } else if (selected.test_id === 'test11') {
        const minimum = Number(selected.payload?.minimumWords || 0);
        const words = wordCount(answer);
        const ok = words >= minimum;
        await submitExerciseAttempt({
          testId: selected.test_id,
          title: buildCorrectionTitle(selected.title),
          summary: ok ? 'Correct' : 'A corriger',
          score: minimum > 0 ? Math.min(1, words / minimum) : 0,
          payload: {
            ...selected.payload,
            correction_source_id: selected.id,
            correction_text: answer,
            correction_words: words,
            correction_submitted_at: new Date().toISOString()
          }
        });
        setSubmittedOnce(true);
        setLastIsCorrect(ok);
        setFeedback(ok ? 'Bonne reponse: correction validee.' : 'Mauvaise reponse: exercice toujours a corriger.');
        await reload();
        setPageInfo(ok ? 'Correction validee.' : `Correction enregistree. Minimum ${minimum} mots requis.`);
      }
    } catch (err: any) {
      setFeedback(err.message || 'Erreur envoi correction.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.background} />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Retour</Text>
          </Pressable>
          <Text style={styles.title}>Corrections</Text>
          <Text style={styles.subtitle}>Exercices avec erreurs a reprendre.</Text>
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
        {pageInfo ? (
          <View style={styles.block}>
            <Text style={styles.muted}>{pageInfo}</Text>
          </View>
        ) : null}

        {!loading ? (
          <View style={styles.block}>
            {!items.length ? <Text style={styles.muted}>Aucune correction en attente.</Text> : null}
            {items.map((item) => (
              <Pressable key={item.id} style={styles.row} onPress={() => openItem(item)}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                <Text style={styles.rowMeta}>{prettyDate(item.created_at)} • {item.summary || 'A corriger'}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Reprise de correction</Text>
              <Pressable onPress={() => setSelected(null)}>
                <Text style={styles.back}>Fermer</Text>
              </Pressable>
            </View>
            {selected ? (
              <ScrollView>
                {selected.test_id === 'test1' ? (
                  <View style={styles.group}>
                    <Text style={styles.label}>Conjugue cette forme:</Text>
                    <Text style={styles.prompt}>
                      {selected.payload?.verb || ''} • {selected.payload?.tense || ''} • {selected.payload?.person || ''}
                    </Text>
                  </View>
                ) : null}

                {selected.test_id === 'test9' ? (
                  <View style={styles.group}>
                    <Text style={styles.label}>Complete les trous:</Text>
                    <Text style={styles.prompt}>{selected.payload?.preview || ''}</Text>
                  </View>
                ) : null}

                {selected.test_id === 'test10' ? (
                  <View style={styles.group}>
                    <Text style={styles.label}>Retape la phrase correctement:</Text>
                    <Text style={styles.prompt}>{firstIncorrectDictationPhrase(selected.payload)?.expected || ''}</Text>
                  </View>
                ) : null}

                {selected.test_id === 'test11' ? (
                  <View style={styles.group}>
                    <Text style={styles.label}>Refais la redaction:</Text>
                    <Text style={styles.prompt}>{selected.payload?.question || ''}</Text>
                    <Text style={styles.muted}>Minimum: {selected.payload?.minimumWords || 0} mots</Text>

                    <Text style={styles.label}>Texte initial</Text>
                    <TextInput
                      value={String(selected.payload?.text || '')}
                      editable={false}
                      multiline
                      style={[styles.input, styles.textArea, styles.readOnlyInput]}
                      placeholder="(vide)"
                      placeholderTextColor="#64748b"
                      autoCorrect={false}
                      spellCheck={false}
                      autoComplete="off"
                    />

                    <Text style={styles.label}>Commentaire du prof</Text>
                    <TextInput
                      value={String(selected.payload?.prof_comment || '')}
                      editable={false}
                      multiline
                      style={[styles.input, styles.readOnlyInput]}
                      placeholder="Aucun commentaire"
                      placeholderTextColor="#64748b"
                      autoCorrect={false}
                      spellCheck={false}
                      autoComplete="off"
                    />

                    <Text style={styles.label}>Nouvelle version</Text>
                  </View>
                ) : null}

                {selected.test_id === 'test9' ? (
                  <View style={styles.group}>
                    {(Array.isArray(selected.payload?.expected) ? selected.payload.expected : []).map((_value: string, index: number) => {
                      const options = String(selected.payload?.category || '')
                        .split('/')
                        .map((item: string) => item.trim())
                        .filter(Boolean);
                      return (
                        <SimpleDropdown
                          key={`ans-${index}`}
                          label={`Choix ${index + 1}`}
                          options={[
                            { label: 'Selectionner', value: '' },
                            ...options.map((option: string) => ({ label: option, value: option }))
                          ]}
                          value={answerList[index] || ''}
                          onChange={(value) =>
                            setAnswerList((prev) => prev.map((item, i) => (i === index ? value : item)))
                          }
                          disabled={submittedOnce}
                        />
                      );
                    })}
                  </View>
                ) : (
                  <VirtualKeyboardInput
                    value={answer}
                    onChangeText={setAnswer}
                    multiline={selected.test_id === 'test11'}
                    placeholder={selected.test_id === 'test11' ? 'Ecris ta nouvelle version...' : 'Ta reponse'}
                    disabled={submittedOnce}
                    inputStyle={selected.test_id === 'test11' ? styles.textArea : undefined}
                  />
                )}
                {selected?.test_id === 'test11' ? (
                  <Text style={styles.muted}>
                    Mots: {correctionWords}/{correctionMinimumWords}
                  </Text>
                ) : null}

                {feedback ? <Text style={lastIsCorrect ? styles.success : styles.error}>{feedback}</Text> : null}

                {!submittedOnce ? (
                  <Pressable
                    style={[styles.button, (submitting || !canSubmitCorrection) && styles.buttonDisabled]}
                    onPress={submitCorrection}
                    disabled={submitting || !canSubmitCorrection}
                  >
                    <Text style={styles.buttonText}>{submitting ? 'Envoi...' : 'Valider la correction'}</Text>
                  </Pressable>
                ) : null}
                {submittedOnce ? (
                  <Pressable style={styles.closeModalButton} onPress={() => setSelected(null)}>
                    <Text style={styles.closeModalButtonText}>Fermer la correction</Text>
                  </Pressable>
                ) : null}
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0f1a' },
  background: { ...StyleSheet.absoluteFillObject, backgroundColor: '#0b0f1a' },
  container: { padding: 20, paddingBottom: 40, gap: 12 },
  header: { marginBottom: 8 },
  back: { color: '#e2e8f0' },
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
  row: {
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    paddingTop: 8
  },
  rowTitle: { color: '#f8fafc', fontWeight: '700' },
  rowMeta: { color: '#94a3b8', fontSize: 12 },
  muted: { color: '#94a3b8' },
  success: { color: '#86efac', fontWeight: '700' },
  error: { color: '#fca5a5' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.72)',
    justifyContent: 'center',
    padding: 20
  },
  modalCard: {
    maxHeight: '88%',
    backgroundColor: '#111827',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 14,
    gap: 8
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  modalTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700' },
  group: { gap: 6, marginBottom: 8 },
  label: { color: '#cbd5e1', fontWeight: '700' },
  prompt: { color: '#f8fafc', lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8
  },
  textArea: { minHeight: 120, textAlignVertical: 'top' },
  readOnlyInput: { opacity: 0.75 },
  button: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center'
  },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: '#052e16', fontWeight: '700' },
  closeModalButton: {
    marginTop: 8,
    backgroundColor: '#1f2937',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 10,
    alignItems: 'center'
  },
  closeModalButtonText: {
    color: '#e2e8f0',
    fontWeight: '700'
  }
});
