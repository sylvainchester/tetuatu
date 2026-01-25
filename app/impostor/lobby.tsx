import { useGameStore } from '@/store/impostor/useGameStore';
import { ensureProfileUsername } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Pusher from 'pusher-js';
import registerForWebPushAsync from '@/lib/impostor/registerForWebPushAsync';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';

export default function LobbyScreen() {
  const router = useRouter();
  const {
    user,
    games,
    fetchGames,
    createGame,
    joinGame,
    cancelGame,
    logout,
    isLoading,
    scoreboard,
    fetchScoreboard,
    ensureUser
  } = useGameStore();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [isRegisteringPush, setIsRegisteringPush] = useState(false);
  const [initError, setInitError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        setSessionChecked(true);
        return;
      }
      ensureProfileUsername(data.session.user)
        .then((name) => ensureUser(name))
        .then((ok) => {
          if (!ok) {
            setInitError('Impossible de preparer le profil imposteur.');
          }
        })
        .finally(() => setSessionChecked(true));
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!nextSession) {
        setSessionChecked(true);
        return;
      }
      ensureProfileUsername(nextSession.user)
        .then((name) => ensureUser(name))
        .then((ok) => {
          if (!ok) {
            setInitError('Impossible de preparer le profil imposteur.');
          }
        })
        .finally(() => setSessionChecked(true));
    });

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, [ensureUser]);

  useEffect(() => {
    if (!sessionChecked) return;
    if (!user) {
      router.replace('/');
    }
  }, [sessionChecked, user, router]);

  useEffect(() => {
    if (!user) return;
    fetchGames();
    fetchScoreboard();

    const pusher = new Pusher('74c987d1696a0d660d3d', {
      cluster: 'eu',
      disableStats: true,
      enabledTransports: ['ws', 'wss']
    });

    const channel = pusher.subscribe('lobby');
    channel.bind('lobby-updated', () => {
      fetchGames();
      fetchScoreboard();
    });

    return () => {
      channel.unbind_all();
      pusher.unsubscribe('lobby');
      pusher.disconnect();
    };
  }, [user, fetchGames, fetchScoreboard]);

  const handleCreateGame = async () => {
    const gameId = await createGame();
    if (gameId) {
      await handleJoinGame(gameId);
    }
  };

  const handleJoinGame = async (gameId: number) => {
    const success = await joinGame(gameId);
    if (success) {
      router.push(`/impostor/game/${gameId}` as any);
    } else {
      Alert.alert('Error', 'Could not join game');
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    await logout();
    router.replace('/');
  };

  const handleEnableNotifications = async () => {
    try {
      setIsRegisteringPush(true);
      const subscription = await registerForWebPushAsync();
      if (subscription) {
        Alert.alert('Notifications', 'Notifications activees sur le web.');
      } else {
        Alert.alert('Notifications', "Impossible d'activer les notifications.");
      }
    } catch (_err) {
      Alert.alert('Notifications', "Erreur lors de l'activation des notifications.");
    } finally {
      setIsRegisteringPush(false);
    }
  };

  const renderGameItem = ({ item }: { item: any }) => {
    const isUserInGame = item.player_ids?.includes(user?.id) || item.player_ids?.includes(String(user?.id));
    const canJoin = item.status === 'waiting';

    return (
      <View style={styles.gameCard}>
        <View style={styles.gameInfo}>
          <Text style={styles.gameTitle}>Game #{item.id}</Text>
          <Text style={styles.gameStatus}>Status: {item.status}</Text>
          <Text style={styles.gamePlayers}>Players: {item.player_count}</Text>
        </View>
        <View style={styles.gameActions}>
          {(canJoin || isUserInGame) && (
            <TouchableOpacity style={styles.joinButton} onPress={() => handleJoinGame(item.id)}>
              <Text style={styles.joinButtonText}>{isUserInGame ? 'Rejoin' : 'Join'}</Text>
            </TouchableOpacity>
          )}
          {(String(user?.username || '').toLowerCase() === 'sylvain' ||
            (item.player_ids && item.player_ids.length > 0 && item.player_ids[0] == user?.id)) && (
            <TouchableOpacity style={styles.cancelButton} onPress={() => cancelGame(item.id)}>
              <Ionicons name="trash-outline" size={20} color="#ff4444" />
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  if (!sessionChecked || !user) {
    return (
      <View style={styles.outerContainer}>
        <ActivityIndicator size="large" color="#e94560" />
        {initError ? <Text style={styles.errorText}>{initError}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.outerContainer}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.welcome}>Hola, {user?.username}!</Text>
          <TouchableOpacity
            onPress={handleEnableNotifications}
            style={styles.notifyButton}
            disabled={isRegisteringPush}
          >
            <Ionicons name="notifications-outline" size={22} color="#ffd166" />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
            <Ionicons name="log-out-outline" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Scoreboard</Text>
        <View style={styles.scoreboardContainer}>
          {scoreboard.length > 0 ? (
            scoreboard.map((entry) => (
              <View key={entry.username} style={styles.scoreRow}>
                <Text style={styles.scoreName}>{entry.username}</Text>
                <Text style={styles.scoreValue}>{entry.score}</Text>
              </View>
            ))
          ) : (
            <ActivityIndicator color="#e94560" />
          )}
        </View>

        <Text style={styles.sectionTitle}>Active Games</Text>

        <FlatList
          data={games}
          renderItem={renderGameItem}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={() => {
                fetchGames();
                fetchScoreboard();
              }}
              tintColor="#fff"
            />
          }
          ListEmptyComponent={<Text style={styles.emptyText}>No active games. Create one!</Text>}
          style={styles.flatList}
        />

        <TouchableOpacity style={styles.fab} onPress={handleCreateGame}>
          <Ionicons name="add" size={30} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: '#1a1a2e'
  },
  container: {
    flex: 1,
    width: '100%',
    maxWidth: 500,
    padding: 10,
    alignSelf: 'center'
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingTop: 50,
    paddingBottom: 20
  },
  welcome: {
    fontSize: 28,
    color: '#e94560',
    fontWeight: 'bold',
    textShadowColor: 'rgba(233, 69, 96, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 5
  },
  logoutButton: {
    backgroundColor: 'rgba(233, 69, 96, 0.1)',
    padding: 10,
    borderRadius: 12
  },
  notifyButton: {
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 209, 102, 0.15)',
    marginRight: 8
  },
  sectionTitle: {
    fontSize: 22,
    color: '#fff',
    marginHorizontal: 15,
    marginTop: 10,
    marginBottom: 10,
    fontWeight: '600'
  },
  scoreboardContainer: {
    backgroundColor: '#16213e',
    marginHorizontal: 15,
    marginBottom: 20,
    borderRadius: 15,
    padding: 15,
    borderWidth: 1,
    borderColor: '#0f3460'
  },
  scoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(233, 69, 96, 0.1)'
  },
  scoreName: {
    color: '#fff',
    fontSize: 18,
    textTransform: 'capitalize'
  },
  scoreValue: {
    color: '#e94560',
    fontSize: 18,
    fontWeight: 'bold'
  },
  flatList: {
    flex: 1
  },
  list: {
    paddingHorizontal: 15,
    paddingBottom: 100
  },
  gameCard: {
    backgroundColor: '#16213e',
    padding: 20,
    borderRadius: 15,
    marginBottom: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
    elevation: 3
  },
  gameInfo: {
    flex: 1
  },
  gameTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold'
  },
  gameStatus: {
    color: '#a0a0a0',
    fontSize: 14,
    marginTop: 5,
    textTransform: 'uppercase',
    letterSpacing: 1
  },
  gamePlayers: {
    color: '#e94560',
    fontSize: 14,
    marginTop: 2,
    fontWeight: '500'
  },
  gameActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  joinButton: {
    backgroundColor: '#e94560',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    shadowColor: '#e94560',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4
  },
  joinButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16
  },
  cancelButton: {
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
    padding: 8,
    borderRadius: 8
  },
  emptyText: {
    color: '#666',
    textAlign: 'center',
    marginTop: 100,
    fontSize: 18,
    fontStyle: 'italic'
  },
  fab: {
    position: 'absolute',
    bottom: 30,
    alignSelf: 'center',
    backgroundColor: '#e94560',
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 10,
    shadowColor: '#e94560',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.5,
    shadowRadius: 10
  },
  errorText: {
    marginTop: 12,
    color: '#fca5a5'
  }
});
