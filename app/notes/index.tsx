import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';

import { fetchNotes, type Note } from '@/lib/notesApi';
import { requireAdminNotesAccess } from '@/lib/notesAccess';

type ExpiryStatus = 'past' | 'soon' | 'future' | 'none';

function expiryStatus(expiresAt: string | null): ExpiryStatus {
  if (!expiresAt) return 'none';
  const endOfDay = new Date(`${expiresAt}T23:59:59`);
  const diff = endOfDay.getTime() - Date.now();
  if (diff < 0) return 'past';
  if (diff <= 24 * 60 * 60 * 1000) return 'soon';
  return 'future';
}

function formatDate(dateISO: string | null) {
  if (!dateISO) return 'Sans échéance';
  const [year, month, day] = dateISO.split('-');
  return `${day}/${month}/${year}`;
}

const palette = {
  bg: '#f4f0e6',
  card: '#fffaf1',
  ink: '#1f2937',
  sub: '#6b7280',
  accent: '#9a3412',
  accentSoft: '#fed7aa',
  border: '#e5d7bf',
  past: '#dc2626',
  soon: '#d97706',
  future: '#16a34a',
};

export default function NotesScreen() {
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [onlyWithExpiry, setOnlyWithExpiry] = useState(false);
  const [keyword, setKeyword] = useState('');

  const loadNotes = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchNotes();
      setNotes(data);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshNotes = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await fetchNotes();
      setNotes(data);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    requireAdminNotesAccess()
      .then((result) => {
        if (!alive) return;
        if (!result.allowed) {
          router.replace('/');
          return;
        }
        setAllowed(true);
        setReady(true);
        loadNotes();
      })
      .catch(() => {
        if (!alive) return;
        router.replace('/');
      });
    return () => {
      alive = false;
    };
  }, [loadNotes]);

  const filtered = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    return notes.filter((note) => {
      if (onlyWithExpiry && !note.expires_at) return false;
      if (!key) return true;
      return note.title.toLowerCase().includes(key);
    });
  }, [notes, onlyWithExpiry, keyword]);

  if (!ready || !allowed) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={palette.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>Retour</Text>
        </Pressable>
        <Text style={styles.title}>Notes</Text>
        <Text style={styles.subtitle}>Notes personnelles administrateur.</Text>
      </View>

      <View style={styles.filtersCard}>
        <TextInput
          value={keyword}
          onChangeText={setKeyword}
          placeholder="Filtrer par titre"
          placeholderTextColor="#94a3b8"
          style={styles.searchInput}
        />
        <View style={styles.switchRow}>
          <Switch value={onlyWithExpiry} onValueChange={setOnlyWithExpiry} />
          <Text style={styles.switchLabel}>Afficher seulement les notes avec échéance</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={palette.accent} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshNotes} />}
          renderItem={({ item }) => {
            const status = expiryStatus(item.expires_at);
            const statusColor =
              status === 'past' ? palette.past : status === 'soon' ? palette.soon : palette.future;

            return (
              <Pressable onPress={() => router.push(`/notes/${item.id}` as any)} style={styles.noteCard}>
                <View style={styles.noteTop}>
                  <Text style={styles.noteTitle}>{item.title}</Text>
                  {item.expires_at ? (
                    <View style={[styles.deadlinePill, { borderColor: statusColor, backgroundColor: `${statusColor}22` }]}>
                      <Text style={[styles.deadlineText, { color: statusColor }]}>{formatDate(item.expires_at)}</Text>
                    </View>
                  ) : null}
                </View>
                <Text numberOfLines={3} style={styles.noteBody}>
                  {item.body}
                </Text>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>Aucune note</Text>
              <Text style={styles.emptyText}>Utilise le bouton + pour en créer une.</Text>
            </View>
          }
        />
      )}

      <Pressable onPress={() => router.push('/notes/new' as any)} style={styles.fab}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    gap: 6,
  },
  back: {
    color: palette.ink,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: palette.ink,
  },
  subtitle: {
    color: palette.sub,
  },
  filtersCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: palette.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 14,
    gap: 12,
  },
  searchInput: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: palette.ink,
    borderWidth: 1,
    borderColor: '#eadfce',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  switchLabel: {
    color: palette.sub,
    fontWeight: '600',
    flex: 1,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 120,
    gap: 12,
  },
  noteCard: {
    backgroundColor: palette.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 14,
    gap: 8,
  },
  noteTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  noteTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: palette.ink,
    flex: 1,
  },
  deadlinePill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  deadlineText: {
    fontWeight: '700',
  },
  noteBody: {
    color: palette.sub,
  },
  emptyWrap: {
    marginTop: 40,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    color: palette.ink,
    fontWeight: '800',
  },
  emptyText: {
    color: '#94a3b8',
  },
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 24,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#fff',
  },
});
