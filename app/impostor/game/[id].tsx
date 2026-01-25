import { getImpostorApiBase, getImpostorAuthHeaders } from '@/lib/impostor/api';
import { ensureProfileUsername } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { useGameStore } from '@/store/impostor/useGameStore';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Pusher from 'pusher-js';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function GameScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const { user, ensureUser } = useGameStore();
    const [gameState, setGameState] = useState<any>(null);
    const [wordInput, setWordInput] = useState('');
    const [loading, setLoading] = useState(true);
    const [isRevealing, setIsRevealing] = useState(false);
    const [sessionChecked, setSessionChecked] = useState(false);
    const [initError, setInitError] = useState('');

    const gameId = id;
    const apiUrl = getImpostorApiBase();

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

    const fetchGameState = async () => {
        if (!user || !apiUrl) return;
        try {
            const headers = await getImpostorAuthHeaders();
            if (!headers) return;
            const res = await axios.get(`${apiUrl}/games/${gameId}`, { headers });
            setGameState(res.data);
            setLoading(false);
        } catch (error) {
            console.error(error);
        }
    };

    useEffect(() => {
        if (!gameId || !user || !apiUrl) return;
        fetchGameState();

        const pusher = new Pusher('74c987d1696a0d660d3d', {
            cluster: 'eu',
            disableStats: true,
            enabledTransports: ['ws', 'wss']
        });

        const channel = pusher.subscribe(`game-${gameId}`);
        channel.bind('game-updated', () => {
            console.log('Pusher received: game-updated');
            fetchGameState();
        });

        return () => {
            channel.unbind_all();
            pusher.unsubscribe(`game-${gameId}`);
            pusher.disconnect();
        };
    }, [gameId, user, apiUrl]);

    const startGame = async () => {
        try {
            const headers = await getImpostorAuthHeaders();
            if (!headers) return;
            await axios.post(`${apiUrl}/games/${gameId}/start`, {}, { headers });
            fetchGameState();
        } catch (error) {
            Alert.alert('Error', 'Failed to start game');
        }
    };

    // --- FEEDBACK STATE ---
    const lastTurnUserRef = useRef<string | null>(null);
    const lastGameStatusRef = useRef<string | null>(null);

    // --- FEEDBACK EFFECT ---
    useEffect(() => {
        if (!gameState || !user) return;

        const { game } = gameState;
        const myId = user.id;

        const triggerFeedback = async () => {
            // Haptics
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

            // Sound
            try {
                const { sound } = await Audio.Sound.createAsync(
                    { uri: 'https://github.com/maykbrito/sounds/raw/master/notifications/01.mp3' },
                    { shouldPlay: true }
                );
            } catch (error) {
                // Ignore sound errors
            }
        };

        // 1. My Turn Detection
        if (game.status === 'playing' && game.current_turn_user_id === myId) {
            // Only trigger if we haven't already noticed this turn
            if (lastTurnUserRef.current !== myId) {
                triggerFeedback();
            }
        }

        // 2. Voting Phase Detection
        if (game.status === 'voting' && lastGameStatusRef.current !== 'voting') {
            triggerFeedback();
        }

        // Update Refs
        lastTurnUserRef.current = game.current_turn_user_id;
        lastGameStatusRef.current = game.status;

    }, [gameState, user]); // Depend on user too

    const submitWord = async () => {
        if (!wordInput.trim()) return;
        try {
            const headers = await getImpostorAuthHeaders();
            if (!headers) return;
            await axios.post(`${apiUrl}/games/${gameId}/turn`, { word: wordInput }, { headers });
            setWordInput('');
            fetchGameState();
        } catch (error) {
            Alert.alert('Error', 'Failed to submit word');
        }
    };

    const castVote = async (suspectId: string) => {
        try {
            const headers = await getImpostorAuthHeaders();
            if (!headers) return;
            await axios.post(`${apiUrl}/games/${gameId}/vote`, { suspectId }, { headers });
            fetchGameState();
        } catch (error) {
            Alert.alert('Error', 'Failed to vote');
        }
    };

    if (!apiUrl) {
        return (
            <View style={styles.outerContainer}>
                <Text style={styles.info}>API impostor manquante.</Text>
            </View>
        );
    }

    if (!sessionChecked || !user) {
        return (
            <View style={styles.outerContainer}>
                <ActivityIndicator size="large" color="#e94560" />
                {initError ? <Text style={styles.errorText}>{initError}</Text> : null}
            </View>
        );
    }

    if (loading || !gameState) {
        return (
            <View style={styles.outerContainer}>
                <ActivityIndicator size="large" color="#e94560" />
            </View>
        );
    }

    const { game, players, turns, votes } = gameState;
    const myPlayer = players.find((p: any) => p.user_id === user?.id);
    const isImpostor = myPlayer?.role === 'impostor';

    // Sort players by ID or join order to keep consistent list
    const sortedPlayers = [...players].sort((a: any, b: any) => String(a.user_id).localeCompare(String(b.user_id)));

    return (
        <View style={styles.outerContainer}>
            <ScrollView
                contentContainerStyle={styles.container}
                keyboardShouldPersistTaps='handled'
            >
                <View style={styles.headerSpacer}>
                    <Text style={styles.status}>
                        Status: {game.status.toUpperCase()} (R{game.round})
                        {game.status === 'playing' && ` | ${players.find((p: any) => p.user_id === game.current_turn_user_id)?.username || 'someone'}'s turn`}
                    </Text>
                    <Text style={styles.playerInfo}>Playing as: <Text style={styles.playerHighlight}>{user?.username}</Text></Text>
                </View>

                {/* WAITING PHASE */}
                {game.status === 'waiting' && (
                    <View style={styles.section}>
                        <Text style={styles.info}>Waiting for players... ({players.length})</Text>
                        <View style={styles.waitingList}>
                            {players.map((p: any) => (
                                <View key={p.user_id} style={styles.waitingPlayerRow}>
                                    <View style={styles.waitingPlayerMain}>
                                        <Ionicons name="person-circle-outline" size={24} color="#e94560" />
                                        <Text style={styles.playerItem}>{p.username}</Text>
                                    </View>
                                    <Text style={styles.scoreTag}>Score: {p.score || 0}</Text>
                                </View>
                            ))}
                        </View>
                        {(user?.username?.toLowerCase() === 'sylvain' || players.length >= 3) && (
                            <TouchableOpacity style={styles.actionButton} onPress={startGame}>
                                <Text style={styles.buttonText}>Start Game</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                )}

                {/* PLAYING PHASE */}
                {game.status === 'playing' && (
                    <View style={styles.section}>
                        <TouchableOpacity
                            activeOpacity={1}
                            style={[
                                styles.secretCard,
                                isRevealing ? (isImpostor ? styles.secretCardImpostor : styles.secretCardCrew) : styles.secretCardHidden
                            ]}
                            onPressIn={() => setIsRevealing(true)}
                            onPressOut={() => setIsRevealing(false)}
                        >
                            <View style={styles.secretContent}>
                                {isRevealing ? (
                                    <>
                                        <Text style={styles.secretTitle}>{isImpostor ? 'ERES EL IMPOSTOR' : 'ERES UN JUGADOR'}</Text>
                                        <Text style={styles.secretInfo}>
                                            {isImpostor ? `Clue: ${game.clue}` : `Word: ${game.word}`}
                                        </Text>
                                        <Text style={styles.secretHint}>(Release to hide)</Text>
                                    </>
                                ) : (
                                    <>
                                        <Ionicons name="finger-print" size={48} color="#aaa" style={{ marginBottom: 10 }} />
                                        <Text style={styles.secretHiddenText}>HOLD TO REVEAL ROLE</Text>
                                        <Text style={styles.secretSubText}>Keep pressed to see your secret word</Text>
                                    </>
                                )}
                            </View>
                        </TouchableOpacity>

                        {/* INPUT BOX ABOVE HISTORY */}
                        <View style={styles.inputWrapper}>
                            {game.current_turn_user_id === user?.id ? (
                                <View style={styles.inputContainer}>
                                    <TextInput
                                        style={styles.input}
                                        value={wordInput}
                                        onChangeText={setWordInput}
                                        placeholder="Enter your word..."
                                        placeholderTextColor="#999"
                                    />
                                    <TouchableOpacity style={styles.sendButton} onPress={submitWord}>
                                        <Ionicons name="send" size={24} color="#fff" />
                                    </TouchableOpacity>
                                </View>
                            ) : (
                                <View style={styles.waitBox}>
                                    <ActivityIndicator size="small" color="#e94560" style={{ marginRight: 10 }} />
                                    <Text style={styles.waitText}>
                                        Waiting for {players.find((p: any) => p.user_id === game.current_turn_user_id)?.username || 'someone'}...
                                    </Text>
                                </View>
                            )}
                        </View>

                        <Text style={styles.subHeader}>Word History:</Text>
                        <View style={styles.historyBox}>
                            {sortedPlayers.map((pl: any) => {
                                const playerTurns = turns.filter((t: any) => t.user_id === pl.user_id);
                                if (playerTurns.length === 0) return null;
                                return (
                                    <View key={pl.user_id} style={styles.playerTurnRow}>
                                        <Text style={styles.turnUser}>{pl.username}: </Text>
                                        <View style={styles.wordsRow}>
                                            {playerTurns.map((t: any, idx: number) => (
                                                <React.Fragment key={t.id}>
                                                    {idx > 0 && <Text style={styles.wordSeparator}> | </Text>}
                                                    <Text style={styles.turnWord}>{t.word_entered}</Text>
                                                </React.Fragment>
                                            ))}
                                        </View>
                                    </View>
                                );
                            })}
                        </View>
                    </View>
                )}

                {/* VOTING PHASE */}
                {game.status === 'voting' && (
                    <View style={styles.section}>
                        <Text style={styles.info}>Vote for the Impostor!</Text>

                        <View style={styles.roundBanner}>
                            <Text style={styles.roundText}>Vote after Round {game.round}</Text>
                        </View>

                        <View style={styles.voteList}>
                            {sortedPlayers.map((p: any) => {
                                if (p.user_id === user?.id) return null; // Can't vote for self
                                const myVote = votes.find((v: any) => v.voter_id === user?.id);
                                const votedThis = myVote?.suspect_id === p.user_id;
                                const hasCastVote = votes.some((v: any) => v.voter_id === p.user_id);
                                const playerTurns = turns.filter((t: any) => t.user_id === p.user_id);
                                return (
                                    <TouchableOpacity
                                        key={p.user_id}
                                        style={[styles.voteButton, votedThis && styles.voteSelected]}
                                        onPress={() => castVote(p.user_id)}
                                    >
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.voteText}>{p.username}</Text>
                                            <View style={styles.voteWordsRow}>
                                                {playerTurns.map((t: any, idx: number) => (
                                                    <Text key={t.id} style={styles.voteWordReminder}>
                                                        {idx > 0 && ' | '}
                                                        "{t.word_entered}"
                                                    </Text>
                                                ))}
                                            </View>
                                            <Text style={[styles.voteSub, hasCastVote && styles.votedText]}>
                                                {hasCastVote ? '✓ Ha votado' : 'Pendiente...'}
                                            </Text>
                                        </View>
                                        {votedThis && <Ionicons name="checkmark-circle" size={24} color="#fff" />}
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                        <Text style={styles.voteProgress}>
                            Voted: {votes.length} / {players.length} players
                        </Text>
                    </View>
                )}

                {/* FINISHED PHASE */}
                {game.status === 'finished' && (
                    <View style={styles.section}>
                        <Text style={styles.gameOver}>GAME OVER</Text>

                        <View style={[styles.resultCard, game.winner === 'impostor' ? styles.impostorWin : styles.cabronazosWin]}>
                            <Text style={styles.winnerText}>
                                {game.winner === 'impostor' ? '¡EL IMPOSTOR GANA!' : '¡LOS JUGADORES GANAN!'}
                            </Text>
                            <Text style={styles.resultDetails}>{game.result_details}</Text>
                        </View>

                        <View style={styles.revealSection}>
                            <Text style={styles.revealLabel}>The word was: <Text style={styles.revealValue}>{game.word}</Text></Text>
                            <Text style={styles.revealLabel}>The clue was: <Text style={styles.revealValue}>{game.clue}</Text></Text>
                        </View>

                        <Text style={styles.subHeader}>Final State & Scores:</Text>
                        <View style={styles.playerList}>
                            {players.map((p: any) => (
                                <View key={p.user_id} style={styles.finalPlayerRow}>
                                    {/* HEAD: Name, Role, Score */}
                                    <View style={styles.playerHeaderRow}>
                                        <View style={styles.playerIdentity}>
                                            <Text style={[styles.playerItem, p.role === 'impostor' && styles.impostorText]}>
                                                {p.username}
                                            </Text>
                                            <Text style={styles.roleTag}>{p.role.toUpperCase()}</Text>
                                        </View>
                                        <View style={styles.playerStats}>
                                            <Text style={styles.voteTag}>
                                                {votes.filter((v: any) => v.suspect_id === p.user_id).length} votes
                                            </Text>
                                            <Text style={styles.playerScore}>Score: {p.score}</Text>
                                        </View>
                                    </View>

                                    {/* BODY: Words */}
                                    <View style={styles.wordsContainer}>
                                        <Text style={styles.wordsLabel}>Words:</Text>
                                        <View style={styles.wordsList}>
                                            {turns
                                                .filter((t: any) => t.user_id === p.user_id)
                                                .map((t: any, idx: number) => (
                                                    <Text key={t.id} style={styles.wordItem}>
                                                        {idx > 0 ? ' • ' : ''}"{t.word_entered}"
                                                    </Text>
                                                ))}
                                        </View>
                                    </View>
                                </View>
                            ))}
                        </View>

                        <TouchableOpacity style={styles.actionButton} onPress={() => router.back()}>
                            <Text style={styles.buttonText}>Back to Lobby</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    outerContainer: {
        flex: 1,
        backgroundColor: '#1a1a2e',
    },
    container: {
        flexGrow: 1,
        width: '100%',
        maxWidth: 500,
        padding: 20,
        alignSelf: 'center',
    },
    headerSpacer: {
        marginBottom: 20,
    },
    status: {
        color: '#a0a0a0',
        marginBottom: 5,
        fontSize: 14,
        fontWeight: 'bold',
        letterSpacing: 2,
    },
    playerInfo: {
        color: '#aaa',
        fontSize: 16,
    },
    playerHighlight: {
        color: '#e94560',
        fontWeight: 'bold',
    },
    section: {
        width: '100%',
        alignItems: 'center',
    },
    info: {
        color: '#fff',
        fontSize: 22,
        fontWeight: 'bold',
        marginBottom: 20,
    },
    waitingList: {
        width: '100%',
        backgroundColor: '#16213e',
        borderRadius: 15,
        padding: 15,
        marginBottom: 20,
    },
    waitingPlayerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#252545',
    },
    waitingPlayerMain: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 15,
    },
    playerItem: {
        color: '#eee',
        fontSize: 18,
    },
    scoreTag: {
        color: '#888',
        fontSize: 14,
        fontWeight: 'bold',
    },
    impostorText: {
        color: '#ff4444',
        fontWeight: 'bold',
    },
    actionButton: {
        backgroundColor: '#e94560',
        paddingHorizontal: 40,
        paddingVertical: 18,
        borderRadius: 30,
        marginTop: 30,
        elevation: 8,
        shadowColor: '#e94560',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.4,
        shadowRadius: 10,
    },
    buttonText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
    },
    roleCard: {
        padding: 25,
        borderRadius: 20,
        width: '100%',
        alignItems: 'center',
        marginBottom: 30,
        elevation: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
    },
    impostorCard: {
        backgroundColor: '#6b1c28',
        borderWidth: 2,
        borderColor: '#ff4444',
    },
    cabronazoCard: {
        backgroundColor: '#1c4a2e',
        borderWidth: 2,
        borderColor: '#4caf50',
    },
    roleTitle: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 15,
        letterSpacing: 1.2,
    },
    roleInfo: {
        color: '#fff',
        fontSize: 36,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 15,
    },
    roleSub: {
        color: '#ddd',
        fontStyle: 'italic',
        fontSize: 16,
    },
    inputWrapper: {
        width: '100%',
        marginBottom: 30,
    },
    subHeader: {
        color: '#aaa',
        alignSelf: 'flex-start',
        marginBottom: 10,
        fontSize: 18,
        fontWeight: '600',
    },
    historyBox: {
        width: '100%',
        backgroundColor: '#0f3460',
        borderRadius: 15,
        padding: 10,
        marginBottom: 20,
    },
    playerTurnRow: {
        backgroundColor: '#16213e',
        padding: 15,
        borderRadius: 10,
        marginBottom: 8,
    },
    wordsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginTop: 5,
    },
    wordSeparator: {
        color: '#e94560',
        fontWeight: 'bold',
    },
    turnUser: {
        color: '#e94560',
        fontWeight: 'bold',
        fontSize: 16,
    },
    turnWord: {
        color: '#fff',
        fontSize: 16,
    },
    inputContainer: {
        flexDirection: 'row',
        width: '100%',
    },
    input: {
        flex: 1,
        backgroundColor: '#0f3460',
        color: '#fff',
        padding: 18,
        borderRadius: 12,
        marginRight: 10,
        fontSize: 16,
    },
    sendButton: {
        backgroundColor: '#e94560',
        padding: 18,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    waitBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#16213e',
        padding: 20,
        borderRadius: 12,
        width: '100%',
        justifyContent: 'center',
    },
    waitText: {
        color: '#e94560',
        fontStyle: 'italic',
        fontSize: 16,
    },
    roundBanner: {
        backgroundColor: 'rgba(233, 69, 96, 0.1)',
        paddingHorizontal: 15,
        paddingVertical: 5,
        borderRadius: 10,
        marginBottom: 15,
    },
    roundText: {
        color: '#e94560',
        fontWeight: 'bold',
    },
    voteList: {
        width: '100%',
    },
    voteButton: {
        backgroundColor: '#16213e',
        padding: 20,
        borderRadius: 15,
        marginBottom: 12,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#0f3460',
    },
    voteSelected: {
        borderColor: '#e94560',
        borderWidth: 2,
    },
    voteText: {
        color: '#fff',
        fontSize: 20,
        fontWeight: 'bold',
    },
    voteSub: {
        color: '#888',
        fontSize: 14,
    },
    votedText: {
        color: '#4caf50',
        fontWeight: 'bold',
    },
    voteProgress: {
        color: '#888',
        marginTop: 15,
        fontSize: 14,
        fontStyle: 'italic',
    },
    voteWordsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 5,
    },
    voteWordReminder: {
        color: '#e94560',
        fontSize: 14,
        fontStyle: 'italic',
    },
    gameOver: {
        fontSize: 48,
        color: '#e94560',
        fontWeight: 'bold',
        marginBottom: 30,
        textAlign: 'center',
    },
    resultCard: {
        width: '100%',
        padding: 30,
        borderRadius: 20,
        alignItems: 'center',
        marginBottom: 30,
        elevation: 10,
    },
    impostorWin: {
        backgroundColor: '#6b1c28',
        borderColor: '#ff4444',
        borderWidth: 2,
    },
    cabronazosWin: {
        backgroundColor: '#1c4a2e',
        borderColor: '#4caf50',
        borderWidth: 2,
    },
    winnerText: {
        color: '#fff',
        fontSize: 28,
        fontWeight: 'bold',
        marginBottom: 15,
        textAlign: 'center',
    },
    resultDetails: {
        color: '#ddd',
        fontSize: 18,
        textAlign: 'center',
    },
    revealSection: {
        width: '100%',
        backgroundColor: '#16213e',
        padding: 25,
        borderRadius: 15,
        marginBottom: 30,
    },
    revealLabel: {
        color: '#aaa',
        fontSize: 18,
        marginBottom: 8,
    },
    revealValue: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 22,
    },
    playerList: {
        marginTop: 10,
        width: '100%',
        backgroundColor: '#16213e',
        borderRadius: 15,
        padding: 10,
        marginBottom: 30,
    },
    finalPlayerRow: {
        flexDirection: 'column', // Stack Header and Words vertically
        alignItems: 'stretch',
        width: '100%',
        padding: 15,
        borderBottomWidth: 1,
        borderBottomColor: '#252545',
    },
    playerHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
        marginBottom: 8,
    },
    playerIdentity: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1, // Allow name to take space but not push stats off
        flexWrap: 'wrap', // Wrap long names + role if needed
    },
    playerStats: {
        alignItems: 'flex-end',
        minWidth: 80, // Prevent shrinking too much
    },
    playerScore: {
        color: '#aaa',
        fontSize: 12,
        marginTop: 2,
    },
    roleTag: {
        color: '#888',
        fontSize: 12,
        marginLeft: 10,
        backgroundColor: '#0f3460',
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 4,
    },
    voteTag: {
        color: '#e94560',
        fontSize: 16,
        fontWeight: 'bold',
    },
    // SECRET CARD STYLES
    secretCard: {
        width: '100%',
        padding: 30,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 30,
        borderWidth: 2,
        minHeight: 180,
    },
    secretCardHidden: {
        backgroundColor: '#16213e',
        borderColor: '#252545',
        borderStyle: 'dashed',
    },
    secretCardImpostor: {
        backgroundColor: '#2c0b0e', // Very dark discrete red
        borderColor: '#5c1e26',
    },
    secretCardCrew: {
        backgroundColor: '#0b1e12', // Very dark discrete green
        borderColor: '#1e4a2c',
    },
    secretContent: {
        alignItems: 'center',
    },
    secretTitle: {
        color: '#fff',
        fontSize: 22,
        fontWeight: 'bold',
        marginBottom: 10,
        textAlign: 'center',
    },
    secretInfo: {
        color: '#fff',
        fontSize: 28,
        fontWeight: 'bold',
        marginBottom: 10,
        textAlign: 'center',
    },
    secretHint: {
        color: '#666',
        fontSize: 14,
        fontStyle: 'italic',
    },
    secretHiddenText: {
        color: '#aaa',
        fontSize: 18,
        fontWeight: 'bold',
        marginTop: 10,
    },
    secretSubText: {
        color: '#666',
        fontSize: 14,
        marginTop: 5,
    },
    errorText: {
        marginTop: 12,
        color: '#fca5a5',
        textAlign: 'center',
    },
    wordsContainer: {
        marginTop: 8,
        width: '100%',
        backgroundColor: 'rgba(0,0,0,0.2)',
        padding: 8,
        borderRadius: 8,
    },
    wordsLabel: {
        color: '#666',
        fontSize: 12,
        marginBottom: 4,
        fontWeight: 'bold',
    },
    wordsList: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    wordItem: {
        color: '#ccc',
        fontSize: 14,
        fontStyle: 'italic',
    },
});
