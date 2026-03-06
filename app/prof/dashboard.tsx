import { useEffect, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { fetchProfAttempt, listProfAttempts } from '@/lib/exerciseApi';

type AttemptSummary = {
  id: string;
  student_email: string;
  test_id: string;
  title: string;
  summary: string;
  score: number | null;
  created_at: string;
};

type AttemptDetail = AttemptSummary & {
  payload: Record<string, any>;
};

export default function ProfDashboardScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [selected, setSelected] = useState<AttemptDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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
    } catch (err: any) {
      setError(err.message || 'Erreur chargement detail.');
    } finally {
      setDetailLoading(false);
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
          <Text style={styles.title}>Dashboard Prof</Text>
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
            <Text style={styles.sectionTitle}>Exercices recus</Text>
            {!attempts.length ? <Text style={styles.muted}>Aucun exercice pour le moment.</Text> : null}
            {attempts.map((attempt) => (
              <Pressable key={attempt.id} style={styles.row} onPress={() => openAttempt(attempt.id)}>
                <Text style={styles.rowTitle}>{attempt.student_email} • {attempt.title}</Text>
                <Text style={styles.rowMeta}>
                  {attempt.created_at.slice(0, 19).replace('T', ' ')} • {attempt.summary || '-'}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {detailLoading ? (
          <View style={styles.block}>
            <Text style={styles.muted}>Chargement detail...</Text>
          </View>
        ) : null}

        {selected ? (
          <View style={styles.block}>
            <Text style={styles.sectionTitle}>Detail resultat</Text>
            <Text style={styles.detailLine}>Eleve: {selected.student_email}</Text>
            <Text style={styles.detailLine}>Exercice: {selected.title} ({selected.test_id})</Text>
            <Text style={styles.detailLine}>Date: {selected.created_at.slice(0, 19).replace('T', ' ')}</Text>
            <Text style={styles.detailLine}>Resume: {selected.summary || '-'}</Text>
            <Text style={styles.detailLine}>Score: {selected.score ?? '-'}</Text>
            <Text style={styles.detailPayload}>{JSON.stringify(selected.payload || {}, null, 2)}</Text>
          </View>
        ) : null}
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
  row: {
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    paddingTop: 8
  },
  rowTitle: { color: '#f8fafc', fontWeight: '600' },
  rowMeta: { color: '#94a3b8', fontSize: 12 },
  detailLine: { color: '#e2e8f0' },
  detailPayload: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 12,
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    padding: 10,
    fontSize: 12
  },
  muted: { color: '#94a3b8' },
  error: { color: '#fca5a5' }
});
