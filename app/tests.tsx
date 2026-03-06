import { createElement, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import {
  fetchTest1Verbs,
  fetchTest10DictationByRef,
  fetchTest10Dictations,
  fetchTest10Levels,
  fetchTest11Categories,
  fetchTest11Prompts,
  fetchTest9Categories,
  fetchTest9Exercises,
  type Test1VerbRow,
  type Test10Dictation,
  type Test11Row,
  type Test9Row
} from '@/lib/frenchTests';

const EXERCISES = [
  { id: 'test1', title: 'Conjugaison', subtitle: 'Verbes, temps, pronoms.' },
  { id: 'test9', title: 'Orthographe', subtitle: 'Phrases a trous et homonymes.' },
  { id: 'test10', title: 'Dictee', subtitle: 'Phrase par phrase, correction locale.' },
  { id: 'test11', title: 'Redaction', subtitle: 'Sujet aleatoire et compteur de mots.' }
] as const;

type ExerciseId = (typeof EXERCISES)[number]['id'];

type Test1TenseKey = 'present' | 'futur' | 'imparfait' | 'passeCompose' | 'passeSimple' | 'subjonctif';
type Test1Person = 1 | 2 | 3 | 4 | 5 | 6;
type Test1Gender = 'm' | 'f';

type Test1Round = {
  verb: string;
  translation: string;
  tenseLabel: string;
  personLabel: string;
  pronoun: string;
  expected: string;
};

type Test9Parsed = {
  title: string;
  textPreview: string;
  answers: string[];
};

type Test10Answer = {
  expected: string;
  typed: string;
  mistakes: number;
  exact: boolean;
};

type DropdownOption = {
  label: string;
  value: string;
};

const TEST1_TENSES: Array<{ key: Test1TenseKey; label: string }> = [
  { key: 'present', label: 'Present' },
  { key: 'futur', label: 'Futur' },
  { key: 'imparfait', label: 'Imparfait' },
  { key: 'passeCompose', label: 'Passe compose' },
  { key: 'passeSimple', label: 'Passe simple' },
  { key: 'subjonctif', label: 'Subjonctif' }
];

const TEST1_PERSON_LABELS: Record<Test1Person, string> = {
  1: 'Premiere personne du singulier',
  2: 'Deuxieme personne du singulier',
  3: 'Troisieme personne du singulier',
  4: 'Premiere personne du pluriel',
  5: 'Deuxieme personne du pluriel',
  6: 'Troisieme personne du pluriel'
};

function getExerciseById(id?: string | string[]): { id: ExerciseId; title: string; subtitle: string } | null {
  if (!id || Array.isArray(id)) return null;
  return (EXERCISES.find((exercise) => exercise.id === id) as any) || null;
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom<T>(items: T[]) {
  if (!items.length) return null;
  return items[randomInt(0, items.length - 1)];
}

function normalizeAnswer(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function countWords(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function estimateMistakes(expected: string, typed: string) {
  const a = normalizeAnswer(expected).split(' ').filter(Boolean);
  const b = normalizeAnswer(typed).split(' ').filter(Boolean);
  const len = Math.max(a.length, b.length);
  let mistakes = 0;
  for (let i = 0; i < len; i += 1) {
    if ((a[i] || '') !== (b[i] || '')) mistakes += 1;
  }
  return mistakes;
}

function parseTest9Phrase(rawPhrase: string): Test9Parsed {
  const markerIndex = rawPhrase.indexOf('%');
  const title = markerIndex >= 0 ? rawPhrase.slice(0, markerIndex) : '';
  const body = markerIndex >= 0 ? rawPhrase.slice(markerIndex + 1) : rawPhrase;
  const chunks = body.split('_');
  const answers: string[] = [];
  let textPreview = '';

  for (let i = 0; i < chunks.length; i += 1) {
    if (i % 2 === 0) {
      textPreview += chunks[i];
    } else {
      answers.push(chunks[i]);
      textPreview += `[${answers.length}]`;
    }
  }

  return { title: title.trim(), textPreview: textPreview.trim(), answers };
}

function speakTextWeb(text: string, language: 'fr' | 'en') {
  const g = globalThis as any;
  if (!g?.window?.speechSynthesis) return false;
  g.window.speechSynthesis.cancel();
  const utter = new g.SpeechSynthesisUtterance(text);
  utter.lang = language === 'fr' ? 'fr-FR' : 'en-GB';
  utter.rate = 0.95;
  g.window.speechSynthesis.speak(utter);
  return true;
}

function buildTest1Round(row: Test1VerbRow, enabledTenses: Test1TenseKey[]): Test1Round {
  const tense = pickRandom(enabledTenses) || 'present';
  const person = randomInt(1, 6) as Test1Person;
  const gender = (randomInt(0, 1) === 0 ? 'm' : 'f') as Test1Gender;

  let pronoun = ['Je', 'Tu', 'Il', 'Nous', 'Vous', 'Ils'][person - 1];
  let expected = '';
  let tenseLabel = TEST1_TENSES.find((item) => item.key === tense)?.label || tense;

  if (tense === 'subjonctif') {
    pronoun = ['Que je', 'Que tu', "Qu'il", 'Que nous', 'Que vous', "Qu'ils"][person - 1];
  }
  if (person === 3 && gender === 'f') {
    pronoun = tense === 'subjonctif' ? "Qu'elle" : 'Elle';
  }
  if (person === 6 && gender === 'f') {
    pronoun = tense === 'subjonctif' ? "Qu'elles" : 'Elles';
  }

  const participle = (row.participe_passe || '').trim();
  const aux = (row.auxiliaire || '').trim().toLowerCase();

  if (tense === 'passeCompose') {
    if (aux === 'avoir') {
      const prefixes = ['ai', 'as', 'a', 'avons', 'avez', 'ont'] as const;
      expected = `${prefixes[person - 1]} ${participle}`.trim();
      if (person === 1) pronoun = "J'";
    } else {
      const prefixes = ['suis', 'es', 'est', 'sommes', 'etes', 'sont'] as const;
      let pp = participle;
      if (person === 3 && gender === 'f') pp = `${pp}e`;
      if (person === 4 || person === 5) pp = `${pp}s`;
      if (person === 6) pp = gender === 'f' ? `${pp}es` : `${pp}s`;
      expected = `${prefixes[person - 1]} ${pp}`.trim();
    }
  } else {
    const columnMap: Record<Test1TenseKey, string[]> = {
      present: ['present_je', 'present_tu', 'present_il', 'present_nous', 'present_vous', 'present_ils'],
      futur: ['futur_je', 'futur_tu', 'futur_il', 'futur_nous', 'futur_vous', 'futur_ils'],
      imparfait: [
        'imparfait_je',
        'imparfait_tu',
        'imparfait_il',
        'imparfait_nous',
        'imparfait_vous',
        'imparfait_ils'
      ],
      passeCompose: [],
      passeSimple: [
        'passe_simple_je',
        'passe_simple_tu',
        'passe_simple_il',
        'passe_simple_nous',
        'passe_simple_vous',
        'passe_simple_ils'
      ],
      subjonctif: [
        'subjonctif_je',
        'subjonctif_tu',
        'subjonctif_il',
        'subjonctif_nous',
        'subjonctif_vous',
        'subjonctif_ils'
      ]
    };
    const col = columnMap[tense][person - 1] as keyof Test1VerbRow;
    expected = String(row[col] || '').trim();
  }

  return {
    verb: row.infinitif,
    translation: (row.traduction_en || '').trim(),
    tenseLabel,
    personLabel: TEST1_PERSON_LABELS[person],
    pronoun,
    expected
  };
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <View style={styles.block}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

function LoadingBlock() {
  return (
    <View style={styles.blockCentered}>
      <ActivityIndicator color="#22c55e" />
      <Text style={styles.mutedSmall}>Chargement...</Text>
    </View>
  );
}

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
      <View style={styles.dropdownField}>
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

  function openPicker() {
    if (disabled || !options.length) return;

    Alert.alert(
      label,
      'Choisir une option',
      options.map((option) => ({
        text: option.label,
        onPress: () => onChange(option.value)
      }))
    );
  }

  return (
    <View style={styles.dropdownField}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.dropdownTrigger, disabled && styles.buttonDisabled]}>
        <Text style={styles.dropdownTriggerText}>{selectedLabel}</Text>
      </View>
      <Pressable style={[styles.secondaryButton, disabled && styles.buttonDisabled]} disabled={disabled} onPress={openPicker}>
        <Text style={styles.secondaryButtonText}>Choisir</Text>
      </Pressable>
    </View>
  );
}

function Chips({
  options,
  selected,
  onSelect
}: {
  options: string[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <View style={styles.chips}>
      {options.map((option) => {
        const active = option === selected;
        return (
          <Pressable
            key={option}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onSelect(option)}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{option}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Test1Exercise() {
  const [verbs, setVerbs] = useState<Test1VerbRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<Record<Test1TenseKey, boolean>>({
    present: true,
    futur: true,
    imparfait: true,
    passeCompose: true,
    passeSimple: true,
    subjonctif: true
  });
  const [round, setRound] = useState<Test1Round | null>(null);
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<{ ok: boolean; expected: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const rows = await fetchTest1Verbs();
        if (cancelled) return;
        setVerbs(rows);
      } catch (err: any) {
        if (cancelled) return;
        setError(err.message || 'Erreur chargement test1');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function nextRound() {
    const enabled = TEST1_TENSES.filter((item) => filters[item.key]).map((item) => item.key);
    if (!enabled.length) {
      setError('Selectionne au moins un temps.');
      return;
    }
    const row = pickRandom(verbs);
    if (!row) return;
    setError('');
    setRound(buildTest1Round(row, enabled));
    setAnswer('');
    setResult(null);
  }

  useEffect(() => {
    if (!loading && verbs.length && !round) {
      nextRound();
    }
  }, [loading, verbs.length]);

  if (loading) return <LoadingBlock />;
  if (error && !round) return <ErrorBlock message={error} />;

  return (
    <View style={styles.exerciseSection}>
      <Text style={styles.sectionTitle}>Filtres</Text>
      <View style={styles.chips}>
        {TEST1_TENSES.map((tense) => (
          <Pressable
            key={tense.key}
            style={[styles.chip, filters[tense.key] && styles.chipActive]}
            onPress={() =>
              setFilters((prev) => ({
                ...prev,
                [tense.key]: !prev[tense.key]
              }))
            }
          >
            <Text style={[styles.chipText, filters[tense.key] && styles.chipTextActive]}>{tense.label}</Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {round ? (
        <View style={styles.block}>
          <Text style={styles.questionLine}>Conjuguer le verbe</Text>
          <Text style={styles.questionMain}>
            {round.verb} {round.translation ? `(${round.translation})` : ''}
          </Text>
          <Text style={styles.questionMeta}>{round.tenseLabel}</Text>
          <Text style={styles.questionMeta}>{round.personLabel}</Text>

          <Text style={styles.label}>Reponse</Text>
          <View style={styles.inlineInputRow}>
            <Text style={styles.pronoun}>{round.pronoun}</Text>
            <TextInput
              value={answer}
              onChangeText={setAnswer}
              placeholder="Ta reponse"
              placeholderTextColor="#64748b"
              style={[styles.textInput, styles.flexInput]}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.actionsRow}>
            <Pressable
              style={styles.primaryButton}
              onPress={() => {
                const ok = normalizeAnswer(answer) === normalizeAnswer(round.expected);
                setResult({ ok, expected: round.expected });
              }}
            >
              <Text style={styles.primaryButtonText}>Verifier</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={nextRound}>
              <Text style={styles.secondaryButtonText}>Question suivante</Text>
            </Pressable>
          </View>

          {result ? (
            <View style={[styles.feedbackBox, result.ok ? styles.feedbackOk : styles.feedbackKo]}>
              <Text style={styles.feedbackTitle}>{result.ok ? 'Correct' : 'A corriger'}</Text>
              {!result.ok ? <Text style={styles.feedbackText}>Attendu: {result.expected}</Text> : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Test9Exercise() {
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [rows, setRows] = useState<Test9Row[]>([]);
  const [row, setRow] = useState<Test9Row | null>(null);
  const [parsed, setParsed] = useState<Test9Parsed | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [result, setResult] = useState<boolean[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const cats = await fetchTest9Categories('fr');
        if (cancelled) return;
        setCategories(cats);
        setSelectedCategory(cats[0] || '');
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Erreur chargement categories');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedCategory) return;
    let cancelled = false;
    (async () => {
      setLoadingRows(true);
      setError('');
      try {
        const list = await fetchTest9Exercises(selectedCategory, 'fr');
        if (cancelled) return;
        setRows(list);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Erreur chargement phrases');
      } finally {
        if (!cancelled) setLoadingRows(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCategory]);

  function nextQuestion(nextRows = rows) {
    const selected = pickRandom(nextRows);
    setRow(selected);
    const p = selected ? parseTest9Phrase(selected.phrase) : null;
    setParsed(p);
    setAnswers(p ? p.answers.map(() => '') : []);
    setResult(null);
  }

  useEffect(() => {
    if (rows.length) {
      nextQuestion(rows);
    } else {
      setRow(null);
      setParsed(null);
      setAnswers([]);
      setResult(null);
    }
  }, [rows]);

  if (loading) return <LoadingBlock />;
  if (error && !categories.length) return <ErrorBlock message={error} />;

  const choiceOptions =
    selectedCategory.includes('/') && selectedCategory !== 'Recommandation'
      ? selectedCategory
          .split('/')
          .map((item) => item.trim())
          .filter(Boolean)
      : [];

  return (
    <View style={styles.exerciseSection}>
      <Text style={styles.sectionTitle}>Categorie</Text>
      <Chips options={categories} selected={selectedCategory} onSelect={setSelectedCategory} />
      {loadingRows ? <LoadingBlock /> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {row && parsed ? (
        <View style={styles.block}>
          <Text style={styles.questionMain}>Orthographe</Text>
          {parsed.title ? <Text style={styles.questionMeta}>{parsed.title}</Text> : null}
          <Text style={styles.promptText}>{parsed.textPreview}</Text>

          {parsed.answers.map((_, index) => (
            <View key={index} style={styles.answerRow}>
              <Text style={styles.answerIndex}>[{index + 1}]</Text>
              {choiceOptions.length ? (
                <View style={styles.chips}>
                  {choiceOptions.map((option) => {
                    const active = answers[index] === option;
                    return (
                      <Pressable
                        key={`${index}-${option}`}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() =>
                          setAnswers((prev) => prev.map((value, i) => (i === index ? option : value)))
                        }
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{option}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <TextInput
                  value={answers[index] || ''}
                  onChangeText={(value) =>
                    setAnswers((prev) => prev.map((current, i) => (i === index ? value : current)))
                  }
                  placeholder="Reponse"
                  placeholderTextColor="#64748b"
                  style={[styles.textInput, styles.flexInput]}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              )}
            </View>
          ))}

          <View style={styles.actionsRow}>
            <Pressable
              style={styles.primaryButton}
              onPress={() =>
                setResult(parsed.answers.map((expected, index) => normalizeAnswer(expected) === normalizeAnswer(answers[index] || '')))
              }
            >
              <Text style={styles.primaryButtonText}>Verifier</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => nextQuestion()}>
              <Text style={styles.secondaryButtonText}>Nouvelle phrase</Text>
            </Pressable>
          </View>

          {result ? (
            <View style={[styles.feedbackBox, result.every(Boolean) ? styles.feedbackOk : styles.feedbackKo]}>
              <Text style={styles.feedbackTitle}>
                {result.every(Boolean) ? 'Tout est correct' : `${result.filter(Boolean).length}/${result.length} correct`}
              </Text>
              {parsed.answers.map((expected, index) => (
                <Text key={`feedback-${index}`} style={styles.feedbackText}>
                  [{index + 1}] {result[index] ? 'OK' : `Attendu: ${expected}`}
                </Text>
              ))}
              {row.lecon ? <Text style={styles.mutedSmall}>Lecon: {row.lecon}</Text> : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Test10Exercise() {
  const langue: 'FR' | 'EN' = 'FR';
  const [levels, setLevels] = useState<string[]>([]);
  const [niveau, setNiveau] = useState('');
  const [dictations, setDictations] = useState<Test10Dictation[]>([]);
  const [selectedRef, setSelectedRef] = useState('');
  const [current, setCurrent] = useState<Test10Dictation | null>(null);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [typed, setTyped] = useState('');
  const [answers, setAnswers] = useState<Test10Answer[]>([]);
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDictation, setLoadingDictation] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingFilters(true);
      setError('');
      try {
        const list = await fetchTest10Levels(langue);
        if (cancelled) return;
        setLevels(list);
        setNiveau((prev) => (prev && list.includes(prev) ? prev : list[0] || ''));
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Erreur chargement niveaux');
      } finally {
        if (!cancelled) setLoadingFilters(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [langue]);

  useEffect(() => {
    if (!niveau) return;
    let cancelled = false;
    (async () => {
      setLoadingList(true);
      setError('');
      try {
        const list = await fetchTest10Dictations(langue, niveau);
        if (cancelled) return;
        setDictations(list);
        setSelectedRef((prev) => (prev && list.some((d) => d.ref === prev) ? prev : list[0]?.ref || ''));
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Erreur chargement dictees');
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [langue, niveau]);

  async function startDictation(ref: string) {
    setLoadingDictation(true);
    setError('');
    try {
      const dictation = await fetchTest10DictationByRef(ref, langue, niveau);
      if (!dictation) {
        setError('Dictee introuvable');
        return;
      }
      setCurrent(dictation);
      setPhraseIndex(0);
      setTyped('');
      setAnswers([]);
    } catch (err: any) {
      setError(err.message || 'Erreur ouverture dictee');
    } finally {
      setLoadingDictation(false);
    }
  }

  const total = current?.phrases.length || 0;
  const currentPhrase = current?.phrases[phraseIndex] || '';
  const finished = !!current && phraseIndex >= total;
  const dictationOptions: DropdownOption[] = dictations.map((dictation) => ({
    value: dictation.ref,
    label: `${dictation.titre} (ref ${dictation.ref})`
  }));
  const levelOptions: DropdownOption[] = levels.map((level) => ({ label: level, value: level }));

  return (
    <View style={styles.exerciseSection}>
      <View style={styles.block}>
        <View style={styles.inlineFields}>
          <SimpleDropdown
            label="Niveau"
            options={levelOptions}
            value={niveau}
            onChange={setNiveau}
            disabled={loadingFilters || !levelOptions.length}
          />
        </View>
      </View>

      <View style={styles.block}>
        {dictations.length ? (
          <SimpleDropdown
            label="Choisir une dictee"
            options={dictationOptions}
            value={selectedRef}
            onChange={setSelectedRef}
            disabled={loadingList || !dictationOptions.length}
          />
        ) : (
          <Text style={styles.mutedSmall}>Aucune dictee pour ce filtre.</Text>
        )}
        <View style={styles.actionsRow}>
          <Pressable
            style={styles.primaryButton}
            disabled={!selectedRef || loadingDictation}
            onPress={() => startDictation(selectedRef)}
          >
            <Text style={styles.primaryButtonText}>{loadingDictation ? 'Chargement...' : 'Commencer'}</Text>
          </Pressable>
        </View>
      </View>

      {error ? <ErrorBlock message={error} /> : null}

      {current ? (
        <View style={styles.block}>
          <Text style={styles.questionMain}>{current.titre}</Text>
            <Text style={styles.questionMeta}>
            {current.langue} - {current.niveau} - {total} phrases
          </Text>

          {!finished ? (
            <>
              <Text style={styles.label}>
                Phrase {phraseIndex + 1}/{total}
              </Text>
              <View style={styles.actionsRow}>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => {
                    const ok = speakTextWeb(currentPhrase, current.langue.toLowerCase() === 'fr' ? 'fr' : 'en');
                    if (!ok) {
                      setError('Lecture vocale indisponible sur cet appareil/navigateur.');
                    }
                  }}
                >
                  <Text style={styles.secondaryButtonText}>Lire (web)</Text>
                </Pressable>
              </View>

              <TextInput
                value={typed}
                onChangeText={setTyped}
                placeholder="Tape la phrase entendue"
                placeholderTextColor="#64748b"
                multiline
                style={[styles.textInput, styles.textArea]}
                autoCorrect={false}
              />

              <View style={styles.actionsRow}>
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => {
                    const expected = currentPhrase.trim();
                    const typedValue = typed.trim();
                    const exact = normalizeAnswer(expected) === normalizeAnswer(typedValue);
                    const mistakes = estimateMistakes(expected, typedValue);
                    setAnswers((prev) => [...prev, { expected, typed: typedValue, exact, mistakes }]);
                    setTyped('');
                    setPhraseIndex((prev) => prev + 1);
                  }}
                >
                  <Text style={styles.primaryButtonText}>Valider la phrase</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View style={[styles.feedbackBox, styles.feedbackOk]}>
                <Text style={styles.feedbackTitle}>Dictee terminee</Text>
                <Text style={styles.feedbackText}>
                  Phrases exactes: {answers.filter((item) => item.exact).length}/{answers.length}
                </Text>
                <Text style={styles.feedbackText}>
                  Estimation fautes: {answers.reduce((sum, item) => sum + item.mistakes, 0)}
                </Text>
              </View>

              {answers.map((item, index) => (
                <View key={`t10-${index}`} style={styles.reviewCard}>
                  <Text style={styles.reviewTitle}>
                    Phrase {index + 1} - {item.exact ? 'OK' : `${item.mistakes} faute(s)`}
                  </Text>
                  <Text style={styles.reviewText}>Saisi: {item.typed || '(vide)'}</Text>
                  <Text style={styles.reviewText}>Attendu: {item.expected}</Text>
                </View>
              ))}

              <View style={styles.actionsRow}>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => {
                    setCurrent(null);
                    setAnswers([]);
                    setPhraseIndex(0);
                    setTyped('');
                  }}
                >
                  <Text style={styles.secondaryButtonText}>Retour aux dictees</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

function Test11Exercise() {
  const [langue, setLangue] = useState<'fr' | 'en'>('fr');
  const [categories, setCategories] = useState<string[]>([]);
  const [categorie, setCategorie] = useState('');
  const [prompts, setPrompts] = useState<Test11Row[]>([]);
  const [current, setCurrent] = useState<Test11Row | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingCategories(true);
      setError('');
      try {
        const list = await fetchTest11Categories(langue);
        if (cancelled) return;
        setCategories(list);
        setCategorie((prev) => (prev && list.includes(prev) ? prev : list[0] || ''));
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Erreur chargement categories');
      } finally {
        if (!cancelled) setLoadingCategories(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [langue]);

  useEffect(() => {
    if (!categorie) return;
    let cancelled = false;
    (async () => {
      setLoadingPrompts(true);
      setError('');
      try {
        const list = await fetchTest11Prompts(langue, categorie);
        if (cancelled) return;
        setPrompts(list);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Erreur chargement sujets');
      } finally {
        if (!cancelled) setLoadingPrompts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [langue, categorie]);

  function nextPrompt() {
    if (!prompts.length) return;
    const recent = new Set(history.slice(-5));
    const available = prompts.filter((item) => !recent.has(item.question));
    const chosen = pickRandom(available.length ? available : prompts);
    if (!chosen) return;
    setCurrent(chosen);
    setText('');
    setSubmitted(false);
    setHistory((prev) => [...prev, chosen.question]);
  }

  useEffect(() => {
    if (prompts.length) {
      nextPrompt();
    } else {
      setCurrent(null);
    }
  }, [prompts]);

  const words = countWords(text);
  const canSubmit = !!current && words >= current.nombre_mots;

  return (
    <View style={styles.exerciseSection}>
      <View style={styles.block}>
        <Text style={styles.label}>Langue</Text>
        <Chips options={['fr', 'en']} selected={langue} onSelect={(value) => setLangue(value as 'fr' | 'en')} />
        <Text style={styles.label}>Categorie</Text>
        {loadingCategories ? <LoadingBlock /> : <Chips options={categories} selected={categorie} onSelect={setCategorie} />}
      </View>

      {loadingPrompts ? <LoadingBlock /> : null}
      {error ? <ErrorBlock message={error} /> : null}

      {current ? (
        <View style={styles.block}>
          <Text style={styles.questionMain}>Sujet ({current.categorie})</Text>
          <Text style={styles.questionMeta}>
            Langue: {current.langue} - Niveau: {current.niveau} - Minimum: {current.nombre_mots} mots
          </Text>
          <Text style={styles.promptText}>{current.question}</Text>

          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            style={[styles.textInput, styles.longTextArea]}
            placeholder={langue === 'fr' ? 'Ecris ta reponse ici...' : 'Write your answer here...'}
            placeholderTextColor="#64748b"
          />
          <Text style={styles.mutedSmall}>
            Mots: {words}/{current.nombre_mots}
          </Text>

          <View style={styles.actionsRow}>
            <Pressable style={[styles.primaryButton, !canSubmit && styles.buttonDisabled]} disabled={!canSubmit} onPress={() => setSubmitted(true)}>
              <Text style={styles.primaryButtonText}>Valider</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={nextPrompt}>
              <Text style={styles.secondaryButtonText}>Nouveau sujet</Text>
            </Pressable>
          </View>

          {submitted ? (
            <View style={[styles.feedbackBox, styles.feedbackOk]}>
              <Text style={styles.feedbackTitle}>Reponse enregistree (locale)</Text>
              <Text style={styles.feedbackText}>Commentaire legacy non reproduit ici pour le moment.</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function TestScreen({ id }: { id: ExerciseId }) {
  if (id === 'test1') return <Test1Exercise />;
  if (id === 'test9') return <Test9Exercise />;
  if (id === 'test10') return <Test10Exercise />;
  if (id === 'test11') return <Test11Exercise />;
  return null;
}

export default function FrenchTestsScreen() {
  const { test } = useLocalSearchParams<{ test?: string }>();
  const selected = getExerciseById(test);

  if (selected) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.background} />
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.header}>
            <Pressable onPress={() => router.replace('/tests')}>
              <Text style={styles.back}>Retour</Text>
            </Pressable>
            <Text style={styles.title}>{selected.title}</Text>
            <Text style={styles.subtitle}>{selected.subtitle}</Text>
          </View>
          <TestScreen id={selected.id} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.background} />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Retour</Text>
          </Pressable>
          <Text style={styles.title}>Exercices de francais</Text>
          <Text style={styles.subtitle}>MVP connecte a Supabase (tests 1, 9, 10, 11).</Text>
        </View>

        <View style={styles.grid}>
          {EXERCISES.map((exercise) => (
            <Pressable
              key={exercise.id}
              style={styles.card}
              onPress={() => router.push({ pathname: '/tests', params: { test: exercise.id } })}
            >
              <Text style={styles.cardTitle}>{exercise.title}</Text>
              <Text style={styles.cardMeta}>{exercise.subtitle}</Text>
              <View style={styles.cardAction}>
                <Text style={styles.cardActionText}>Ouvrir</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0b0f1a'
  },
  background: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0b0f1a'
  },
  container: {
    padding: 20,
    paddingBottom: 40
  },
  header: {
    marginBottom: 20
  },
  back: {
    color: '#e2e8f0',
    marginBottom: 8
  },
  title: {
    fontSize: 26,
    fontFamily: 'serif',
    color: '#f8fafc'
  },
  subtitle: {
    marginTop: 6,
    color: '#94a3b8'
  },
  grid: {
    gap: 16
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1f2937'
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f8fafc'
  },
  cardMeta: {
    marginTop: 6,
    color: '#94a3b8'
  },
  cardAction: {
    marginTop: 14,
    alignSelf: 'flex-start',
    backgroundColor: '#22c55e',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10
  },
  cardActionText: {
    color: '#052e16',
    fontWeight: '700'
  },
  exerciseSection: {
    gap: 14
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 8
  },
  block: {
    backgroundColor: '#111827',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    gap: 10
  },
  blockCentered: {
    backgroundColor: '#111827',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  chip: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#0f172a'
  },
  chipActive: {
    backgroundColor: '#22c55e',
    borderColor: '#22c55e'
  },
  chipText: {
    color: '#cbd5e1',
    fontSize: 13
  },
  chipTextActive: {
    color: '#052e16',
    fontWeight: '700'
  },
  questionLine: {
    color: '#cbd5e1'
  },
  questionMain: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700'
  },
  questionMeta: {
    color: '#94a3b8'
  },
  label: {
    color: '#e2e8f0',
    fontWeight: '600',
    marginTop: 4
  },
  inlineInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  pronoun: {
    color: '#f8fafc',
    minWidth: 50
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  flexInput: {
    flex: 1
  },
  textArea: {
    minHeight: 90,
    textAlignVertical: 'top'
  },
  longTextArea: {
    minHeight: 180,
    textAlignVertical: 'top'
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4
  },
  primaryButton: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10
  },
  primaryButtonText: {
    color: '#052e16',
    fontWeight: '700'
  },
  secondaryButton: {
    backgroundColor: '#1f2937',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155'
  },
  secondaryButtonText: {
    color: '#e2e8f0',
    fontWeight: '600'
  },
  buttonDisabled: {
    opacity: 0.45
  },
  feedbackBox: {
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    gap: 4
  },
  feedbackOk: {
    backgroundColor: '#052e16',
    borderColor: '#166534'
  },
  feedbackKo: {
    backgroundColor: '#3f1d1d',
    borderColor: '#7f1d1d'
  },
  feedbackTitle: {
    color: '#f8fafc',
    fontWeight: '700'
  },
  feedbackText: {
    color: '#e2e8f0'
  },
  promptText: {
    color: '#f8fafc',
    lineHeight: 22
  },
  answerRow: {
    gap: 8
  },
  answerIndex: {
    color: '#cbd5e1',
    fontWeight: '600'
  },
  mutedSmall: {
    color: '#94a3b8',
    fontSize: 12
  },
  errorText: {
    color: '#fca5a5'
  },
  inlineFields: {
    flexDirection: 'row',
    gap: 10
  },
  dropdownField: {
    flex: 1,
    gap: 6
  },
  dropdownTrigger: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    backgroundColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  dropdownTriggerText: {
    color: '#f8fafc'
  },
  dictationList: {
    gap: 10
  },
  dictationCard: {
    backgroundColor: '#0f172a',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12
  },
  dictationCardActive: {
    borderColor: '#22c55e'
  },
  reviewCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 10,
    gap: 4
  },
  reviewTitle: {
    color: '#f8fafc',
    fontWeight: '700'
  },
  reviewText: {
    color: '#cbd5e1'
  }
});
