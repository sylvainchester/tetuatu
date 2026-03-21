import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { fetchWhitelistByEmail } from '@/lib/accessControl';
import { createFinoGame, deleteFinoGame, joinFinoGame, listFinoGames, type FinoLobbyGame } from '@/lib/finoApi';
import { ensureProfileUsername } from '@/lib/profile';
import { supabase } from '@/lib/supabase';

export default function FinoLobbyScreen() {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [username, setUsername] = useState('');
  const [games, setGames] = useState<FinoLobbyGame[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadLobby = useCallback(async (currentUsername?: string) => {
    const nextUsername = currentUsername || username;
    if (!nextUsername) return;
    setLoading(true);
    setError('');
    try {
      const data = await listFinoGames(nextUsername);
      setGames(data);
    } catch (err: any) {
      setError(err.message || 'Erreur chargement Fino.');
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data.session;
        const email = session?.user?.email ?? null;
        if (!session || !email) {
          router.replace('/');
          return;
        }

        const access = await fetchWhitelistByEmail(email);
        if (!alive) return;
        if (!access || !['admin', 'member'].includes(access.role)) {
          router.replace('/');
          return;
        }

        const profileUsername = await ensureProfileUsername(session.user);
        if (!alive) return;
        setUsername(profileUsername);
        setAllowed(true);
        loadLobby(profileUsername);
      } catch (err: any) {
        if (!alive) return;
        setError(err.message || 'Erreur accès Fino.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadLobby]);

  async function handleCreate() {
    setBusy(true);
    try {
      const game = await createFinoGame();
      await loadLobby();
      router.push(`/fino/game/${game}` as any);
    } catch (err: any) {
      Alert.alert('Création impossible', err.message || 'Impossible de créer la partie.');
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(game: number, seat: 'seat1' | 'seat2') {
    setBusy(true);
    try {
      await joinFinoGame(game, seat, username);
      await loadLobby();
    } catch (err: any) {
      Alert.alert('Entrée impossible', err.message || 'Impossible de rejoindre la partie.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(game: number) {
    setBusy(true);
    try {
      await deleteFinoGame(game, username);
      await loadLobby();
    } catch (err: any) {
      Alert.alert('Suppression impossible', err.message || 'Impossible de supprimer la partie.');
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#d97706" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Retour</Text>
          </Pressable>
          <Text style={styles.title}>Fino</Text>
          <Text style={styles.subtitle}>Lobby et mise en place de la migration.</Text>
        </View>

        <Pressable style={[styles.createButton, busy && styles.buttonDisabled]} onPress={handleCreate} disabled={busy}>
          <Text style={styles.createText}>{busy ? 'Traitement...' : 'Créer une partie'}</Text>
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color="#d97706" />
          </View>
        ) : (
          <View style={styles.gamesList}>
            {!games.length ? <Text style={styles.empty}>Aucune partie pour le moment.</Text> : null}
            {games.map((game) => (
              <View key={game.game} style={styles.gameCard}>
                <View style={styles.gameTop}>
                  <Text style={styles.gameTitle}>Partie {game.game}</Text>
                  {game.canDelete ? (
                    <Pressable style={styles.deleteButton} onPress={() => handleDelete(game.game)}>
                      <Text style={styles.deleteText}>Supprimer</Text>
                    </Pressable>
                  ) : null}
                </View>

                <View style={styles.seatsRow}>
                  {game.seat1 ? (
                    <View style={styles.seatFilled}>
                      <Text style={styles.seatText}>{game.seat1}</Text>
                    </View>
                  ) : (
                    <Pressable style={styles.seatOpen} onPress={() => handleJoin(game.game, 'seat1')}>
                      <Text style={styles.seatJoin}>Rejoindre place 1</Text>
                    </Pressable>
                  )}

                  {game.seat2 ? (
                    <View style={styles.seatFilled}>
                      <Text style={styles.seatText}>{game.seat2}</Text>
                    </View>
                  ) : (
                    <Pressable style={styles.seatOpen} onPress={() => handleJoin(game.game, 'seat2')}>
                      <Text style={styles.seatJoin}>Rejoindre place 2</Text>
                    </Pressable>
                  )}
                </View>

                {game.canEnter ? (
                  <Pressable style={styles.enterButton} onPress={() => router.push(`/fino/game/${game.game}` as any)}>
                    <Text style={styles.enterText}>Entrer dans la partie</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.pendingText}>En attente du deuxième joueur.</Text>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#120f1b',
  },
  container: {
    padding: 16,
    gap: 14,
  },
  header: {
    gap: 6,
  },
  back: {
    color: '#fef3c7',
  },
  title: {
    color: '#fff7ed',
    fontSize: 30,
    fontWeight: '900',
  },
  subtitle: {
    color: '#cbd5e1',
  },
  createButton: {
    backgroundColor: '#d97706',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  createText: {
    color: '#1c1917',
    fontWeight: '900',
  },
  error: {
    color: '#fecaca',
  },
  loadingWrap: {
    flex: 1,
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gamesList: {
    gap: 12,
  },
  empty: {
    color: '#cbd5e1',
  },
  gameCard: {
    backgroundColor: '#1c1917',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#44403c',
    padding: 16,
    gap: 12,
  },
  gameTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  gameTitle: {
    color: '#fff7ed',
    fontSize: 20,
    fontWeight: '900',
  },
  deleteButton: {
    backgroundColor: '#7f1d1d',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  deleteText: {
    color: '#fee2e2',
    fontWeight: '800',
  },
  seatsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  seatFilled: {
    flex: 1,
    backgroundColor: '#292524',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#57534e',
  },
  seatText: {
    color: '#f8fafc',
    fontWeight: '800',
    textAlign: 'center',
  },
  seatOpen: {
    flex: 1,
    backgroundColor: '#78350f',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#d97706',
  },
  seatJoin: {
    color: '#fffbeb',
    fontWeight: '800',
    textAlign: 'center',
  },
  enterButton: {
    backgroundColor: '#2563eb',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  enterText: {
    color: '#eff6ff',
    fontWeight: '900',
  },
  pendingText: {
    color: '#cbd5e1',
  },
});
