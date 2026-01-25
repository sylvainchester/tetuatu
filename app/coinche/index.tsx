import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { router } from 'expo-router';

import { createGame, listGames } from '@/lib/api';
import { getBackendUrl } from '@/lib/backend';
import { ensureProfileUsername } from '@/lib/profile';
import { supabase } from '@/lib/supabase';

export default function CoincheHomeScreen() {
  const [session, setSession] = useState<Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [games, setGames] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState('');
  const backendUrl = getBackendUrl();

  function deriveWsUrl(baseUrl: string) {
    if (baseUrl.startsWith('https://')) {
      return baseUrl.replace('https://', 'wss://');
    }
    if (baseUrl.startsWith('http://')) {
      return baseUrl.replace('http://', 'ws://');
    }
    return baseUrl;
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionChecked(true);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setSessionChecked(true);
    });

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!sessionChecked) return;
    if (!session) {
      router.replace('/');
      return;
    }
    ensureProfileUsername(session.user);
  }, [sessionChecked, session]);

  async function loadGames() {
    setLoading(true);
    setRequestError('');
    try {
      const payload = await listGames();
      setGames(payload.data || []);
    } catch (err: any) {
      setRequestError(err?.message || 'Erreur chargement');
      setGames([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session) {
      loadGames();
    }
  }, [session]);

  useEffect(() => {
    if (!session || !backendUrl) return;
    const ws = new WebSocket(deriveWsUrl(backendUrl));
    ws.onmessage = () => {
      loadGames();
    };
    return () => ws.close();
  }, [session, backendUrl]);

  async function handleCreate() {
    setLoading(true);
    setRequestError('');
    try {
      const payload = await createGame();
      const gameId = payload.data?.id;
      if (gameId) {
        router.push(`/coinche/game/${gameId}`);
      }
      await loadGames();
    } catch (err: any) {
      setRequestError(err?.message || 'Erreur creation');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setGames([]);
    router.replace('/');
  }

  if (!sessionChecked || !session) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#0f172a" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.background}>
        <View style={styles.circleOne} />
        <View style={styles.circleTwo} />
      </View>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Tables Coinche</Text>
          <Text style={styles.subtitle}>Choisis une table ou cree ta partie.</Text>
          <Text style={styles.backendUrl}>Backend: {backendUrl || 'missing'}</Text>
        </View>
        <Pressable style={styles.logout} onPress={handleSignOut}>
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.primaryButton} onPress={handleCreate}>
          <Text style={styles.primaryButtonText}>Creer une table</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={loadGames}>
          <Text style={styles.secondaryButtonText}>Rafraichir</Text>
        </Pressable>
      </View>
      {requestError ? <Text style={styles.requestError}>{requestError}</Text> : null}

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#0f172a" />
        </View>
      ) : (
        <FlatList
          data={games}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => router.push(`/coinche/game/${item.id}`)}>
              <Text style={styles.cardTitle}>Table {item.id.slice(0, 6).toUpperCase()}</Text>
              <Text style={styles.cardMeta}>Derniere action: {item.last_action_at || '---'}</Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.empty}>Aucune table active.</Text>}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#e9edf3'
  },
  background: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#e9edf3'
  },
  circleOne: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: '#f59e0b',
    opacity: 0.15,
    top: -40,
    left: -60
  },
  circleTwo: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: '#1d4ed8',
    opacity: 0.12,
    bottom: -120,
    right: -80
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  title: {
    fontSize: 26,
    fontFamily: 'serif',
    color: '#0f172a'
  },
  subtitle: {
    marginTop: 4,
    color: '#475569'
  },
  backendUrl: {
    marginTop: 6,
    color: '#64748b',
    fontSize: 12
  },
  logout: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#111827'
  },
  logoutText: {
    color: '#f8fafc',
    fontSize: 12
  },
  actions: {
    paddingHorizontal: 20,
    marginTop: 20,
    flexDirection: 'row',
    gap: 12
  },
  primaryButton: {
    flex: 1,
    backgroundColor: '#0f172a',
    paddingVertical: 14,
    borderRadius: 18,
    alignItems: 'center'
  },
  primaryButtonText: {
    color: '#f8fafc',
    fontWeight: '700'
  },
  secondaryButton: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#0f172a'
  },
  secondaryButtonText: {
    color: '#0f172a'
  },
  list: {
    padding: 20,
    paddingBottom: 80
  },
  card: {
    backgroundColor: '#f8fafc',
    padding: 18,
    borderRadius: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0'
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a'
  },
  cardMeta: {
    marginTop: 6,
    color: '#475569'
  },
  empty: {
    textAlign: 'center',
    color: '#64748b'
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  requestError: {
    marginTop: 10,
    textAlign: 'center',
    color: '#b91c1c'
  }
});
