import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type View as RNView,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { fetchWhitelistByEmail } from '@/lib/accessControl';
import { finoCardAssets, type FinoCardAssetKey } from '@/lib/finoCardAssets';
import { ensureProfileUsername } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import {
  applyFinoPenalty,
  defineFinoRule,
  getFinoSnapshot,
  isFinoCardAuthorized,
  passFinoTurn,
  pickFinoCardFromDeck,
  pickFinoOpponentCard,
  playFinoCard,
  swapFinoCard,
  type FinoRow,
} from '@/lib/finoApi';

type TargetRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const JACK_CHOICES = [
  { label: 'Coeur', value: 'h' },
  { label: 'Carreau', value: 'd' },
  { label: 'Pique', value: 's' },
  { label: 'Trèfle', value: 'c' },
] as const;
const THREE_CHOICES = ['2', '3', '4', '5', '6', '7', '8', '9', '0', 'j', 'q', 'k', '1', 'a'] as const;

function splitCards(cards: string | null | undefined) {
  if (!cards) return [] as string[];
  return cards.split(',').map((card) => card.trim()).filter(Boolean);
}

function assetForCard(card: string) {
  const key = (card || 'back') as FinoCardAssetKey;
  return finoCardAssets[key] ?? finoCardAssets.back;
}

function containsPoint(rect: TargetRect | null, x: number, y: number) {
  if (!rect) return false;
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

async function measureRect(ref: React.RefObject<RNView | null>) {
  return await new Promise<TargetRect | null>((resolve) => {
    const node = ref.current as any;
    if (!node?.measureInWindow) {
      resolve(null);
      return;
    }
    node.measureInWindow((x: number, y: number, width: number, height: number) => {
      resolve({ x, y, width, height });
    });
  });
}

function DraggableCard({
  card,
  width,
  disabled,
  selected,
  onSelect,
  onDrop,
}: {
  card: string;
  width: number;
  disabled: boolean;
  selected: boolean;
  onSelect: () => void;
  onDrop: (point: { x: number; y: number }) => Promise<void>;
}) {
  const pan = useRef(new Animated.ValueXY()).current;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
        onPanResponderRelease: async (_, gestureState) => {
          try {
            await onDrop({ x: gestureState.moveX, y: gestureState.moveY });
          } finally {
            Animated.spring(pan, {
              toValue: { x: 0, y: 0 },
              useNativeDriver: false,
              bounciness: 6,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: false,
          }).start();
        },
      }),
    [disabled, onDrop, pan]
  );

  return (
    <Pressable onPress={onSelect}>
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.playerCardWrap,
          {
            width,
            transform: [{ translateX: pan.x }, { translateY: pan.y }],
            opacity: disabled ? 0.5 : 1,
          },
          selected && styles.selectedPlayerCardWrap,
        ]}
      >
        <Image source={assetForCard(card)} style={styles.cardImage} resizeMode="contain" />
      </Animated.View>
    </Pressable>
  );
}

function groupCards<T>(items: T[], size: number) {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

export default function FinoGameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { width, height } = useWindowDimensions();
  const pileRef = useRef<RNView | null>(null);
  const deckRef = useRef<RNView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [username, setUsername] = useState('');
  const [rows, setRows] = useState<FinoRow[]>([]);
  const [error, setError] = useState('');
  const [liveStatus, setLiveStatus] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle');
  const [finoReady, setFinoReady] = useState(false);
  const [boardHeight, setBoardHeight] = useState(height);
  const [selectedCard, setSelectedCard] = useState<string>('');
  const finoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finoAckRef = useRef(false);

  const gameId = Number(id);
  const seat1 = rows.find((row) => row.seat === 'seat1');
  const seat2 = rows.find((row) => row.seat === 'seat2');
  const play = rows.find((row) => row.seat === 'play');
  const me = seat1?.player_name === username ? seat1 : seat2?.player_name === username ? seat2 : undefined;
  const opponent = me?.seat === 'seat1' ? seat2 : me?.seat === 'seat2' ? seat1 : undefined;
  const myCards = useMemo(() => splitCards(me?.cards), [me?.cards]);
  const opponentCards = useMemo(() => splitCards(opponent?.cards), [opponent?.cards]);
  const myCardRows = useMemo(() => groupCards(myCards, 7), [myCards]);
  const canPlay = !!me && me.turn_flag === 'Turn';
  const specialRule = me?.last_card ?? '-';
  const visibleOpponentCards = specialRule === '0' || specialRule === '6';
  const canDraw = canPlay && (specialRule === '-' || specialRule === '6');
  const canPass = canPlay && specialRule === 'p';
  const needsJackChoice = canPlay && specialRule === 'j';
  const needsThreeChoice = canPlay && specialRule === '3';
  const canSwap = canPlay && specialRule === '5';
  const canSteal = canPlay && specialRule === '0';
  const winner = seat1 && splitCards(seat1.cards).length === 0 ? seat1.player_name : seat2 && splitCards(seat2.cards).length === 0 ? seat2.player_name : '';
  const topCardWidth = Math.min(Math.max(width * 0.15, 72), 118);
  const playerCardWidth = Math.min(Math.max(width * 0.15, 72), 118);
  const opponentCardWidth = Math.min(Math.max(width * 0.18, 68), 132);
  const opponentZoneHeight = opponentCardWidth * 1.45 + 34;
  const playerRowOverlap = Math.min(10, playerCardWidth * 0.12);
  const playerRowWidth = Math.max(54, Math.min(playerCardWidth, (width - 28 + playerRowOverlap * 6) / 7));

  const loadGame = useCallback(async (currentUsername?: string, silent = false) => {
    const activeUsername = currentUsername || username;
    if (!gameId || !activeUsername) return;
    if (!silent) setLoading(true);
    try {
      const data = await getFinoSnapshot(gameId);
      setRows(data);
      setError('');
      setSelectedCard('');
    } catch (err: any) {
      setError(err.message || 'Erreur chargement Fino.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [gameId, username]);

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
        setLiveStatus('connecting');
        await loadGame(profileUsername);
      } catch (err: any) {
        if (!alive) return;
        setError(err.message || 'Erreur accès Fino.');
      }
    })();

    return () => {
      alive = false;
    };
  }, [loadGame]);

  useEffect(() => {
    if (!allowed || !username || !gameId) return;

    const channel = supabase
      .channel(`fino-game-${gameId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'fino_rows',
          filter: `game=eq.${gameId}`,
        },
        () => {
          setLiveStatus('live');
          loadGame(username, true);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setLiveStatus('live');
          loadGame(username, true);
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setLiveStatus('error');
        } else {
          setLiveStatus('connecting');
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [allowed, username, gameId, loadGame]);

  useEffect(() => {
    if (finoTimerRef.current) {
      clearTimeout(finoTimerRef.current);
      finoTimerRef.current = null;
    }

    if (myCards.length > 3) {
      finoAckRef.current = false;
      setFinoReady(false);
      return;
    }

    if (myCards.length === 3 && canPlay && !finoAckRef.current) {
      setFinoReady(true);
      finoTimerRef.current = setTimeout(async () => {
        if (finoAckRef.current) return;
        try {
          await applyFinoPenalty(gameId, username);
          await loadGame(username, true);
        } catch (err: any) {
          setError(err.message || 'Erreur FINO.');
        } finally {
          setFinoReady(false);
          finoAckRef.current = true;
        }
      }, 2000);
      return;
    }

    setFinoReady(false);
  }, [myCards.length, canPlay, gameId, username, loadGame]);

  useEffect(() => {
    return () => {
      if (finoTimerRef.current) clearTimeout(finoTimerRef.current);
    };
  }, []);

  async function runAction(action: () => Promise<void>) {
    setBusy(true);
    try {
      setError('');
      console.log('[Fino] runAction:start', {
        gameId,
        username,
        canPlay,
        specialRule,
        selectedCard,
      });
      await action();
      console.log('[Fino] runAction:success');
      await loadGame(username, true);
    } catch (err: any) {
      const message = err?.message || 'Action impossible.';
      console.error('[Fino] runAction:error', err);
      setError(message);
      if (Platform.OS !== 'web') {
        Alert.alert('Action impossible', message);
      }
    } finally {
      console.log('[Fino] runAction:end');
      setBusy(false);
    }
  }

  async function handleDrop(card: string, point: { x: number; y: number }) {
    if (busy || !canPlay || needsJackChoice || needsThreeChoice || winner) return;

    const pileRect = await measureRect(pileRef);
    const deckRect = await measureRect(deckRef);

    if (containsPoint(pileRect, point.x, point.y)) {
      if (canSwap) return;
      const authorized = play?.cards ? isFinoCardAuthorized(card, play.cards, me?.jack_rule) : false;
      if (!authorized) {
        setError('Cette carte ne peut pas être jouée sur la pile.');
        return;
      }
      await runAction(() => playFinoCard(gameId, username, card));
      return;
    }

    if (containsPoint(deckRect, point.x, point.y) && canSwap) {
      await runAction(() => swapFinoCard(gameId, username, card));
    }
  }

  async function handlePlaySelectedCard() {
    if (!selectedCard || busy || !canPlay || needsJackChoice || needsThreeChoice || !!winner || canSwap) return;
    const authorized = play?.cards ? isFinoCardAuthorized(selectedCard, play.cards, me?.jack_rule) : false;
    if (!authorized) {
      setError('Cette carte ne peut pas être jouée sur la pile.');
      return;
    }
    await runAction(() => playFinoCard(gameId, username, selectedCard));
  }

  async function handleDeckAction() {
    if (busy || !canPlay || needsJackChoice || needsThreeChoice || !!winner) return;
    if (canSwap) {
      if (!selectedCard) {
        setError('Sélectionnez d’abord une carte à échanger.');
        return;
      }
      await runAction(() => swapFinoCard(gameId, username, selectedCard));
      return;
    }
    if (canDraw) {
      await runAction(() => pickFinoCardFromDeck(gameId, username));
    }
  }

  async function handleDefineRule(choice: string) {
    setError('');
    console.log('[Fino] handleDefineRule:click', {
      choice,
      gameId,
      username,
      canPlay,
      myLastCard: me?.last_card,
      myTurn: me?.turn_flag,
      needsJackChoice,
      needsThreeChoice,
      busy,
    });
    await runAction(() => defineFinoRule(gameId, username, choice));
  }

  function handleFinoClick() {
    finoAckRef.current = true;
    setFinoReady(false);
    if (finoTimerRef.current) {
      clearTimeout(finoTimerRef.current);
      finoTimerRef.current = null;
    }
  }

  function onBoardLayout(event: LayoutChangeEvent) {
    setBoardHeight(event.nativeEvent.layout.height);
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

  const statusText = winner
    ? winner === username
      ? 'VICTOIRE'
      : 'DÉFAITE'
    : '';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={[styles.screen, !canPlay && !winner ? styles.screenWaiting : null]} onLayout={onBoardLayout}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Retour</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Fino {id}</Text>
          <Text style={styles.headerMeta}>{liveStatus === 'live' ? 'Temps réel' : liveStatus === 'connecting' ? 'Connexion…' : 'Hors ligne'}</Text>
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color="#d97706" />
          </View>
        ) : (
          <>
            <View style={styles.topZone}>
              <View style={styles.topMeta}>
                <Text style={styles.playerName}>{me?.player_name || '-'}</Text>
                <Text style={styles.smallMeta}>{seat1?.player_name || '?'} {seat1?.points ?? 0} / {seat2?.player_name || '?'} {seat2?.points ?? 0}</Text>
              </View>

              <View style={styles.playerHandGrid}>
                {myCardRows.map((row, rowIndex) => (
                  <View key={`row-${rowIndex}`} style={styles.playerHandRow}>
                    {row.map((card, index) => {
                      const authorized = play?.cards ? isFinoCardAuthorized(card, play.cards, me?.jack_rule) : false;
                      const disabled = busy || !canPlay || needsJackChoice || needsThreeChoice || !!winner || (canSwap ? false : !authorized);
                      return (
                        <View
                          key={`${card}-${rowIndex}-${index}`}
                          style={[
                            styles.playerCardCell,
                            { width: playerRowWidth },
                            index > 0 ? { marginLeft: -playerRowOverlap } : null,
                          ]}
                        >
                          <DraggableCard
                            card={card}
                            width={playerCardWidth}
                            disabled={disabled && Platform.OS !== 'web'}
                            selected={selectedCard === card}
                            onSelect={() => setSelectedCard((current) => current === card ? '' : card)}
                            onDrop={(point) => handleDrop(card, point)}
                          />
                        </View>
                      );
                    })}
                    {canPass && rowIndex === myCardRows.length - 1 && row.length < 7 ? (
                      <View style={[styles.playerCardCell, { width: playerRowWidth }, row.length > 0 ? { marginLeft: -playerRowOverlap } : null]}>
                        <Pressable style={styles.passCardWrap} onPress={() => runAction(() => passFinoTurn(gameId, username))} disabled={busy}>
                          <Image source={finoCardAssets.pass} style={styles.cardImage} resizeMode="contain" />
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                ))}
                {canPass && myCards.length === 0 ? (
                  <View style={styles.playerHandRow}>
                    <View style={styles.playerCardCell}>
                      <Pressable style={styles.passCardWrap} onPress={() => runAction(() => passFinoTurn(gameId, username))} disabled={busy}>
                        <Image source={finoCardAssets.pass} style={styles.cardImage} resizeMode="contain" />
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </View>

              {!winner && canPlay ? (
                <View style={styles.selectedActionBar}>
                  {selectedCard && !canSwap ? (
                    <Pressable style={[styles.primaryActionButton, busy && styles.buttonDisabled]} onPress={handlePlaySelectedCard} disabled={busy || !canPlay}>
                      <Text style={styles.primaryActionText}>Jouer {selectedCard}</Text>
                    </Pressable>
                  ) : null}
                  {selectedCard && canSwap ? (
                    <Pressable style={[styles.primaryActionButton, busy && styles.buttonDisabled]} onPress={handleDeckAction} disabled={busy || !canPlay}>
                      <Text style={styles.primaryActionText}>Échanger {selectedCard}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>

            <View style={[styles.deckZone, { bottom: opponentZoneHeight - 6 }]}>
              <View style={styles.deckRow}>
                <Pressable
                  ref={deckRef}
                  style={styles.centerCardSlot}
                  onPress={handleDeckAction}
                  disabled={(!canDraw && !canSwap) || busy}
                >
                  <Image source={finoCardAssets.back} style={[styles.centerCardImage, { width: topCardWidth, height: topCardWidth * 1.45 }]} resizeMode="contain" />
                </Pressable>

                <Pressable ref={pileRef} style={styles.centerCardSlot} onPress={handlePlaySelectedCard} disabled={busy || !canPlay || canSwap}>
                  <Image source={assetForCard(play?.cards || 'back')} style={[styles.centerCardImage, { width: topCardWidth, height: topCardWidth * 1.45 }]} resizeMode="contain" />
                </Pressable>
              </View>
            </View>

            <View style={styles.centerZone}>
              <View style={styles.bannerWrap}>
                {statusText ? <Text style={[styles.bannerText, winner && styles.bannerWinner]}>{statusText}</Text> : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}
              </View>
            </View>

            <View style={[styles.bottomZone, { height: opponentZoneHeight }]}>
              <View style={styles.opponentRow}>
                {opponentCards.map((card, index) => {
                  const overlap = opponentCards.length > 6 ? -opponentCardWidth * 0.58 : -opponentCardWidth * 0.42;
                  return (
                    <Pressable
                      key={`${card}-${index}`}
                      style={{ marginLeft: index === 0 ? 0 : overlap }}
                      onPress={() => canSteal && runAction(() => pickFinoOpponentCard(gameId, username, card))}
                      disabled={!canSteal || busy}
                    >
                      <Image
                        source={visibleOpponentCards ? assetForCard(card) : finoCardAssets.back}
                        style={[styles.opponentCard, { width: opponentCardWidth, height: opponentCardWidth * 1.45, opacity: !canSteal || busy ? 1 : 0.95 }]}
                        resizeMode="contain"
                      />
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {(needsJackChoice || needsThreeChoice) ? (
              <View style={[styles.overlay, { height: boardHeight }]}>
                <View style={styles.choicePanel}>
                  <Text style={styles.choiceTitle}>{needsJackChoice ? 'Choisissez une couleur' : 'Choisissez la valeur imposée'}</Text>
                  {error ? <Text style={styles.choiceError}>{error}</Text> : null}
                  <View style={styles.choiceGrid}>
                    {needsJackChoice
                      ? JACK_CHOICES.map((choice) => (
                          <Pressable
                            key={choice.value}
                            style={[
                              styles.choiceTextButton,
                              busy && styles.buttonDisabled,
                            ]}
                            onPress={() => handleDefineRule(choice.value)}
                            disabled={busy}
                          >
                            <Text style={styles.choiceTextLabel}>{choice.label}</Text>
                          </Pressable>
                        ))
                      : THREE_CHOICES.map((choice) => (
                          <Pressable
                            key={choice}
                            style={[
                              styles.choiceTextButton,
                              styles.choiceValueTextButton,
                              busy && styles.buttonDisabled,
                            ]}
                            onPress={() => handleDefineRule(choice)}
                            disabled={busy}
                          >
                            <Text style={styles.choiceTextLabel}>{choice}</Text>
                          </Pressable>
                        ))}
                  </View>
                </View>
              </View>
            ) : null}

            {finoReady ? (
              <Pressable
                style={[
                  styles.finoOverlay,
                  {
                    left: Math.max(16, width * 0.5 - 90),
                    top: Math.max(120, height * 0.32 - 60),
                  },
                ]}
                onPress={handleFinoClick}
              >
                <Image source={finoCardAssets.fino} style={styles.finoImage} resizeMode="contain" />
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#000',
  },
  screen: {
    flex: 1,
    backgroundColor: '#000',
  },
  screenWaiting: {
    backgroundColor: '#0000cc',
  },
  header: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 5,
  },
  back: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
  },
  headerMeta: {
    color: '#d1d5db',
    fontSize: 13,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topZone: {
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingTop: 4,
  },
  topMeta: {
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  playerName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
  },
  smallMeta: {
    color: '#e5e7eb',
    fontSize: 13,
  },
  playerHandGrid: {
    paddingTop: 6,
    maxWidth: 860,
    alignSelf: 'center',
    gap: 8,
  },
  playerHandRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  playerCardCell: {
    alignItems: 'center',
  },
  selectedActionBar: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 10,
  },
  playerCardWrap: {
    aspectRatio: 0.69,
  },
  selectedPlayerCardWrap: {
    borderWidth: 3,
    borderColor: '#f59e0b',
    borderRadius: 12,
    shadowColor: '#f59e0b',
    shadowOpacity: 0.9,
    shadowRadius: 12,
    elevation: 8,
  },
  passCardWrap: {
    width: '100%',
    aspectRatio: 0.69,
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  centerZone: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 8,
    gap: 10,
    zIndex: 2,
    flex: 1,
  },
  deckZone: {
    position: 'absolute',
    left: 8,
    zIndex: 3,
  },
  deckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    justifyContent: 'flex-start',
  },
  centerCardSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 96,
    minHeight: 140,
    position: 'relative',
  },
  centerCardImage: {
    height: 180,
  },
  deckCount: {
    position: 'absolute',
    top: 8,
    right: 8,
    color: '#fff',
    fontSize: 28,
    fontWeight: '900',
    textShadowColor: '#000',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },
  bannerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 72,
    paddingHorizontal: 16,
  },
  bannerText: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '900',
    textAlign: 'center',
  },
  bannerWinner: {
    color: '#ef4444',
    fontSize: 46,
  },
  error: {
    color: '#fca5a5',
    textAlign: 'center',
    marginTop: 6,
  },
  ruleHint: {
    color: '#fde68a',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 6,
  },
  actionRow: {
    minHeight: 1,
  },
  primaryActionButton: {
    backgroundColor: '#d97706',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryActionText: {
    color: '#111827',
    fontWeight: '900',
  },
  bottomZone: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: 6,
    zIndex: 1,
  },
  opponentRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingHorizontal: 6,
  },
  opponentCard: {
    aspectRatio: 0.69,
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    zIndex: 200,
    elevation: 200,
  },
  choicePanel: {
    backgroundColor: '#111827',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#374151',
    padding: 16,
    width: '100%',
    maxWidth: 860,
    gap: 14,
    zIndex: 201,
    elevation: 201,
  },
  choiceTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  choiceError: {
    color: '#fca5a5',
    textAlign: 'center',
    fontWeight: '700',
  },
  choiceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  choiceCard: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1f2937',
    borderWidth: 1,
    borderColor: '#374151',
  },
  choiceSuitCard: {
    width: 104,
    height: 104,
  },
  choiceValueCard: {
    width: 86,
    height: 118,
  },
  choiceSuitImage: {
    width: 58,
    height: 58,
  },
  choiceValueImage: {
    width: 72,
    height: 104,
  },
  choiceTextButton: {
    minWidth: 132,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#374151',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceValueTextButton: {
    minWidth: 72,
  },
  choiceTextLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  finoOverlay: {
    position: 'absolute',
    zIndex: 30,
  },
  finoImage: {
    width: 180,
    height: 180,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
});
