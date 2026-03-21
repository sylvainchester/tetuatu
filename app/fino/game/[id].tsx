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
  getFinoRuleLabel,
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

const JACK_CHOICES = ['heart', 'diamond', 'spade', 'club'] as const;
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
  const deck = rows.find((row) => row.seat === 'deck');
  const play = rows.find((row) => row.seat === 'play');
  const me = seat1?.player_name === username ? seat1 : seat2?.player_name === username ? seat2 : undefined;
  const opponent = me?.seat === 'seat1' ? seat2 : me?.seat === 'seat2' ? seat1 : undefined;
  const myCards = useMemo(() => splitCards(me?.cards), [me?.cards]);
  const opponentCards = useMemo(() => splitCards(opponent?.cards), [opponent?.cards]);
  const deckCards = useMemo(() => splitCards(deck?.cards), [deck?.cards]);
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
  const topCardWidth = Math.min(Math.max(width * 0.2, 92), 150);
  const playerCardWidth = Math.min(Math.max(width * 0.18, 76), 132);
  const opponentCardWidth = Math.min(Math.max(width * 0.18, 68), 132);

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
      await action();
      await loadGame(username, true);
    } catch (err: any) {
      Alert.alert('Action impossible', err.message || 'Action impossible.');
    } finally {
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
        Alert.alert('Carte interdite', 'Cette carte ne peut pas être jouée sur la pile.');
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
      Alert.alert('Carte interdite', 'Cette carte ne peut pas être jouée sur la pile.');
      return;
    }
    await runAction(() => playFinoCard(gameId, username, selectedCard));
  }

  async function handleDeckAction() {
    if (busy || !canPlay || needsJackChoice || needsThreeChoice || !!winner) return;
    if (canSwap) {
      if (!selectedCard) {
        Alert.alert('Choisissez une carte', 'Sélectionnez d’abord une carte à échanger.');
        return;
      }
      await runAction(() => swapFinoCard(gameId, username, selectedCard));
      return;
    }
    if (canDraw) {
      await runAction(() => pickFinoCardFromDeck(gameId, username));
    }
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
    : specialRule === '0'
      ? 'Choisissez une carte adverse'
      : specialRule === '5'
        ? 'Déposez une carte sur le deck'
        : specialRule === '6'
          ? 'Main adverse visible'
          : specialRule === 'p'
            ? 'Vous pouvez passer'
            : canPlay
              ? 'À vous de jouer'
              : `Tour de ${opponent?.player_name || 'l’adversaire'}`;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.screen} onLayout={onBoardLayout}>
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

              <View style={styles.playerHandRow}>
                {myCards.map((card, index) => {
                  const authorized = play?.cards ? isFinoCardAuthorized(card, play.cards, me?.jack_rule) : false;
                  const disabled = busy || !canPlay || needsJackChoice || needsThreeChoice || !!winner || (canSwap ? false : !authorized);
                  const overlap = myCards.length > 6 ? -playerCardWidth * 0.32 : -playerCardWidth * 0.18;
                  return (
                    <View key={`${card}-${index}`} style={{ marginLeft: index === 0 ? 0 : overlap }}>
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
              </View>
            </View>

            <View style={styles.centerZone}>
              <View style={styles.deckRow}>
                <Pressable
                  ref={deckRef}
                  style={[styles.centerCardSlot, canDraw && styles.activeSlot]}
                  onPress={handleDeckAction}
                  disabled={(!canDraw && !canSwap) || busy}
                >
                  <Image source={finoCardAssets.back} style={[styles.centerCardImage, { width: topCardWidth, height: topCardWidth * 1.45 }]} resizeMode="contain" />
                  <Text style={styles.deckCount}>{deckCards.length}</Text>
                </Pressable>

                <Pressable ref={pileRef} style={styles.centerCardSlot} onPress={handlePlaySelectedCard} disabled={busy || !canPlay || canSwap}>
                  <Image source={assetForCard(play?.cards || 'back')} style={[styles.centerCardImage, { width: topCardWidth, height: topCardWidth * 1.45 }]} resizeMode="contain" />
                </Pressable>
              </View>

              <View style={styles.bannerWrap}>
                <Text style={[styles.bannerText, winner && styles.bannerWinner]}>{statusText}</Text>
                {error ? <Text style={styles.error}>{error}</Text> : null}
                {(specialRule !== '-' && specialRule !== 'p' && specialRule !== '6' && !winner) ? (
                  <Text style={styles.ruleHint}>Règle: {getFinoRuleLabel(me?.jack_rule || specialRule)}</Text>
                ) : null}
              </View>

              <View style={styles.actionRow}>
                <Pressable style={[styles.actionButton, !canPass && styles.buttonDisabled]} onPress={() => runAction(() => passFinoTurn(gameId, username))} disabled={!canPass || busy}>
                  <Image source={finoCardAssets.pass} style={styles.actionImage} resizeMode="contain" />
                </Pressable>
                <Pressable style={[styles.refreshButton, busy && styles.buttonDisabled]} onPress={() => loadGame(username)} disabled={busy}>
                  <Text style={styles.refreshText}>Rafraîchir</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.bottomZone}>
              <Text style={styles.opponentName}>{opponent?.player_name || 'Adversaire'} · {opponentCards.length} cartes</Text>
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
                  <View style={styles.choiceGrid}>
                    {(needsJackChoice ? JACK_CHOICES : THREE_CHOICES).map((choice) => (
                      <Pressable
                        key={choice}
                        style={[styles.choiceCard, busy && styles.buttonDisabled]}
                        onPress={() => runAction(() => defineFinoRule(gameId, username, choice))}
                        disabled={busy}
                      >
                        <Image source={assetForCard(choice)} style={styles.choiceImage} resizeMode="contain" />
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
    flex: 1,
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
  playerHandRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: 6,
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
  cardImage: {
    width: '100%',
    height: '100%',
  },
  centerZone: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 18,
    gap: 10,
  },
  deckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  centerCardSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 96,
    minHeight: 140,
    position: 'relative',
  },
  activeSlot: {
    shadowColor: '#f59e0b',
    shadowOpacity: 0.8,
    shadowRadius: 16,
    elevation: 8,
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
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  actionButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  actionImage: {
    width: 84,
    height: 48,
  },
  refreshButton: {
    backgroundColor: '#1f2937',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  refreshText: {
    color: '#fff',
    fontWeight: '800',
  },
  bottomZone: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingBottom: 6,
  },
  opponentName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 6,
  },
  opponentRow: {
    flexDirection: 'row',
    justifyContent: 'center',
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
  },
  choiceTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  choiceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  choiceCard: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  choiceImage: {
    width: 72,
    height: 104,
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
