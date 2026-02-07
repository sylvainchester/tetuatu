import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { getBackendUrl } from '@/lib/backend';
import { supabase } from '@/lib/supabase';
import { avatarImages, cardImages } from '@/lib/assets';
import { useWakeLock } from '@/lib/wakeLock';
import {
  addRobot,
  cancelBids,
  cancelTrick,
  collectTrick,
  dealHand,
  fetchGame,
  joinGame,
  placeBid,
  playCard,
  undoLast
} from '@/lib/api';

const CARD_NAMES = [
  '7 de pique',
  '8 de pique',
  '9 de pique',
  '10 de pique',
  'valet de pique',
  'dame de pique',
  'roi de pique',
  'as de pique',
  '7 de carreau',
  '8 de carreau',
  '9 de carreau',
  '10 de carreau',
  'valet de carreau',
  'dame de carreau',
  'roi de carreau',
  'as de carreau',
  '7 de trefle',
  '8 de trefle',
  '9 de trefle',
  '10 de trefle',
  'valet de trefle',
  'dame de trefle',
  'roi de trefle',
  'as de trefle',
  '7 de coeur',
  '8 de coeur',
  '9 de coeur',
  '10 de coeur',
  'valet de coeur',
  'dame de coeur',
  'roi de coeur',
  'as de coeur'
];

const CONTRACTS = ['passe', '80', '90', '100', '110', '120', '130', '140', '150', 'capot'];
const SUITS = ['pique', 'carreau', 'trefle', 'coeur', 'toutate', 'sanzate'];
const SUIT_SYMBOLS: Record<string, string> = {
  pique: '♠',
  carreau: '♦',
  trefle: '♣',
  coeur: '♥',
  toutate: 'TA',
  sanzate: 'SA'
};

function formatBidLabel(label: string) {
  if (!label) return '';
  return label
    .replace(/\bpique\b/g, '♠')
    .replace(/\bcarreau\b/g, '♦')
    .replace(/\btrefle\b/g, '♣')
    .replace(/\bcoeur\b/g, '♥');
}

function getAtoutFromMise(mise: string) {
  if (!mise) return '';
  return mise.trim().split(' ')[1] || '';
}

function parseContractValue(value: string) {
  if (!value || value === 'passe') return 0;
  if (value === 'capot') return 250;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getBidHistoryFromStory(rows: any[], storyText: string) {
  const totalBids = rows.reduce((sum, row) => {
    const bids = (row.encheres || ',,').split(',').filter(Boolean);
    return sum + bids.length;
  }, 0);
  if (!storyText || totalBids === 0) return [];

  const nameToSeat = new Map(rows.map((row) => [row.player_name, row.seat]));
  const lines = storyText.split('\n');
  const historyReversed: { seat: number; bid: string }[] = [];

  for (let i = lines.length - 1; i >= 0 && historyReversed.length < totalBids; i -= 1) {
    const line = lines[i].trim();
    const match = line.match(/^(.*) dit: (.*)\.$/);
    if (!match) continue;
    const name = match[1].trim();
    const bid = match[2].trim();
    const seat = nameToSeat.get(name);
    if (!seat) continue;
    historyReversed.push({ seat, bid });
  }

  return historyReversed.reverse();
}

function getTrailingPasses(history: { seat: number; bid: string }[]) {
  let count = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].bid === 'passe') {
      count += 1;
      continue;
    }
    break;
  }
  return count;
}

function getPassesAfterLastBid(history: { seat: number; bid: string }[]) {
  const hasBid = history.some((entry) => entry.bid !== 'passe');
  if (!hasBid) return 0;
  return getTrailingPasses(history);
}

function getCloseSeatFromHistory(history: { seat: number; bid: string }[]) {
  const hasBid = history.some((entry) => entry.bid !== 'passe');
  if (!hasBid) return null;
  const trailingPasses = getTrailingPasses(history);
  if (trailingPasses < 3) return null;
  let idx = history.length - trailingPasses - 1;
  while (idx >= 0 && history[idx].bid === 'passe') {
    idx -= 1;
  }
  return idx >= 0 ? history[idx].seat : null;
}

function decodeHand(bitstring: string) {
  if (!bitstring) return [];
  return bitstring
    .split('')
    .map((bit, idx) => (bit === '1' ? CARD_NAMES[idx] : null))
    .filter(Boolean) as string[];
}

function clearCardFromMain(bitstring: string, cardName: string) {
  if (!bitstring) return bitstring;
  const index = CARD_NAMES.indexOf(cardName);
  if (index < 0) return bitstring;
  const chars = bitstring.split('');
  if (!chars[index] || chars[index] === '0') return bitstring;
  chars[index] = '0';
  return chars.join('');
}

function encodeCardToPli(cardName: string) {
  const index = CARD_NAMES.indexOf(cardName);
  if (index < 0) return '';
  const chars = Array(CARD_NAMES.length).fill('0');
  chars[index] = '1';
  return chars.join('');
}

function applyOptimisticPlay(rows: any[], userId: string, cardName: string) {
  if (!userId) return rows;
  const nextOrder = rows.reduce((max, row) => {
    const order = Number(row?.dernier || 0);
    return order > max ? order : max;
  }, 0) + 1;
  return rows.map((row) => {
    if (row.player_id !== userId) return row;
    return {
      ...row,
      main: clearCardFromMain(row.main || '', cardName),
      pli: encodeCardToPli(cardName),
      dernier: nextOrder
    };
  });
}

function deriveWsUrl(baseUrl: string) {
  if (baseUrl.startsWith('https://')) {
    return baseUrl.replace('https://', 'wss://');
  }
  if (baseUrl.startsWith('http://')) {
    return baseUrl.replace('http://', 'ws://');
  }
  return baseUrl;
}

function getCardNameFromPli(pli: string) {
  if (!pli) return null;
  const index = pli.indexOf('1');
  if (index < 0) return null;
  return CARD_NAMES[index] || null;
}

function getDisplayName(row: any) {
  if (!row) return '';
  if (row.player_name === String(row.seat)) return 'En attente';
  const raw = row.robot_name || row.player_name || '';
  if (!raw) return '';
  return `${raw.charAt(0).toUpperCase()}${raw.slice(1).toLowerCase()}`;
}

function getAvatarKey(row: any) {
  return String(row?.robot_name || row?.player_name || '').toLowerCase();
}

function AvatarBox({ row, active }: { row: any; active: boolean }) {
  const avatarKey = getAvatarKey(row);
  const source = avatarImages[avatarKey];
  return (
    <View style={[styles.avatarFrame, active ? styles.avatarFrameActive : null]}>
      {source ? <Image source={source} style={styles.avatarImage} /> : <View style={styles.avatarPlaceholderInner} />}
    </View>
  );
}

function HandCard({
  index,
  total,
  disabled,
  onPress,
  image,
  label
}: {
  index: number;
  total: number;
  disabled?: boolean;
  onPress: () => void;
  image?: number;
  label: string;
}) {
  const lift = useState(() => new Animated.Value(0))[0];
  const center = (total - 1) / 2;
  const offset = index - center;
  const rotate = `${offset * 4}deg`;
  const translateX = offset * 14;

  const translateY = lift.interpolate({ inputRange: [0, 1], outputRange: [0, -14] });
  const scale = lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });

  function handlePressIn() {
    if (disabled) return;
    Animated.spring(lift, { toValue: 1, useNativeDriver: true, speed: 20 }).start();
  }

  function handlePressOut() {
    if (disabled) return;
    Animated.spring(lift, { toValue: 0, useNativeDriver: true, speed: 20 }).start();
  }

  const cardBody = (
    <Animated.View
      style={[
        styles.cardChip,
        {
          zIndex: index,
          transform: [{ translateX }, { translateY }, { rotateZ: rotate }, { scale }]
        }
      ]}
    >
      {image ? <Image source={image} style={styles.cardImage} /> : <Text style={styles.cardText}>{label}</Text>}
    </Animated.View>
  );

  if (disabled) {
    return cardBody;
  }

  return (
    <Pressable disabled={disabled} onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut}>
      {cardBody}
    </Pressable>
  );
}

function TableCard({
  image,
  label,
  style,
  highlight
}: {
  image?: number;
  label: string;
  style: any;
  highlight?: boolean;
}) {
  const [anim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(anim, {
      toValue: image ? 1 : 0,
      duration: 220,
      useNativeDriver: true
    }).start();
  }, [anim, image]);

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });

  return (
    <Animated.View
      style={[
        styles.tableCardSlot,
        style,
        highlight ? styles.tableCardHighlight : null,
        { opacity: image ? 1 : 0.35, transform: [{ scale }] }
      ]}
    >
      {image ? (
        <Image source={image} style={styles.tableCardImage} />
      ) : (
        <View style={styles.tablePlaceholder}>
          <Text style={styles.tablePlaceholderText}>{label || '...'}</Text>
        </View>
      )}
    </Animated.View>
  );
}

export default function GameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const gameId = id as string;
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<any[]>([]);
  const [session, setSession] = useState<any>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [contract, setContract] = useState('passe');
  const [suit, setSuit] = useState<string | null>(null);
  const [handResultShown, setHandResultShown] = useState(false);
  const [pendingPlay, setPendingPlay] = useState<{ card: string; prevRows: any[] } | null>(null);
  const loadInFlightRef = useRef(false);
  const lastLoadAtRef = useRef(0);
  const queuedLoadRef = useRef(false);
  const backendUrl = getBackendUrl();
  const wakeLock = useWakeLock();

  function triggerHaptic() {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (_err) {
      // Ignore haptics failures on unsupported devices.
    }
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
    wakeLock.enable();
    return () => wakeLock.disable();
  }, []);

  useEffect(() => {
    if (!sessionChecked) return;
    if (!session) {
      router.replace('/');
    }
  }, [sessionChecked, session]);

  async function loadGame({ silent = false } = {}) {
    if (!gameId) return;
    if (loadInFlightRef.current) {
      queuedLoadRef.current = true;
      return;
    }
    const now = Date.now();
    if (now - lastLoadAtRef.current < 350) {
      queuedLoadRef.current = true;
      return;
    }
    if (!silent) {
      setLoading(true);
    }
    loadInFlightRef.current = true;
    try {
      const payload = await fetchGame(gameId);
      setRows(payload.data || []);
    } catch (_err) {
      // Avoid crashing the UI on transient network errors.
    } finally {
      loadInFlightRef.current = false;
      lastLoadAtRef.current = Date.now();
      if (queuedLoadRef.current) {
        queuedLoadRef.current = false;
        setTimeout(() => {
          loadGame({ silent: true });
        }, 120);
      }
      if (!silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadGame();
  }, [gameId]);

  useEffect(() => {
    if (!backendUrl || !gameId) return;
    const ws = new WebSocket(deriveWsUrl(backendUrl));
    ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', gameId }));
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === 'game.deleted') {
          router.replace('/coinche');
          return;
        }
        if (Array.isArray(payload?.data)) {
          setRows(payload.data);
          return;
        }
      } catch (_err) {
        // Fall back to refetch when payload is not JSON.
      }
      loadGame({ silent: rows.length > 0 });
    };
    return () => ws.close();
  }, [backendUrl, gameId, rows.length]);

  const activeRow = rows.find((row) => row.tour === 'tour');
  const currentRow = rows.find((row) => row.player_id === session?.user?.id);
  const gamePhase = rows.some((row) => row.mise) ? 'play' : 'bid';
  const hand = decodeHand(currentRow?.main || '');
  const story = rows.find((row) => row.seat === 1)?.story || '';
  const atout = useMemo(() => {
    const miseRow = rows.find((row) => row.mise);
    return miseRow ? getAtoutFromMise(miseRow.mise) : '';
  }, [rows]);
  const beloteAtout = ['pique', 'carreau', 'trefle', 'coeur'].includes(atout) ? atout : '';
  const bidsById = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((row) => {
      if (gamePhase === 'bid') {
        const bids = (row.encheres || '').split(',').filter(Boolean);
        const last = bids[bids.length - 1] || '';
        map.set(row.id, formatBidLabel(last));
      } else if (row.mise) {
        map.set(row.id, formatBidLabel(row.mise));
      } else {
        map.set(row.id, '');
      }
    });
    return map;
  }, [rows, gamePhase]);
  const bidMeta = useMemo(() => {
    let max = 0;
    let passCount = 0;
    rows.forEach((row) => {
      const bids = (row.encheres || '').split(',').filter(Boolean);
      const last = bids[bids.length - 1] || '';
      if (last === 'passe') {
        passCount += 1;
      }
      bids.forEach((bid) => {
        const value = parseContractValue(bid.split(' ')[0] || '');
        if (value > max) {
          max = value;
        }
      });
    });
    const storyText = rows.find((row) => row.seat === 1)?.story || '';
    const bidHistory = getBidHistoryFromStory(rows, storyText);
    const closeSeat = max === 0 ? null : getCloseSeatFromHistory(bidHistory);
    const passesAfterLastBid = getPassesAfterLastBid(bidHistory);
    return { highest: max, passCount, closeSeat, passesAfterLastBid };
  }, [rows]);
  const highestBidValue = bidMeta.highest;
  const closeBidPhase =
    activeRow?.player_id === session?.user?.id &&
    bidMeta.closeSeat != null &&
    activeRow?.seat === bidMeta.closeSeat;
  const myLastBid = useMemo(() => {
    if (!currentRow) return '';
    return bidsById.get(currentRow.id) || '';
  }, [currentRow, bidsById]);
  const allSeatsFilled = rows.length > 0 && rows.every((row) => row.player_name !== String(row.seat));
  const handOver = allSeatsFilled && rows.length > 0 && rows.every((row) => row.main === '00000000000000000000000000000000');
  const starterRow = rows.find((row) => row.tas && row.tas.includes('%'));
  const playedCards = rows.map((row) => {
    const cardName = getCardNameFromPli(row.pli);
    return {
      seat: row.seat,
      cardName,
      image: cardName ? cardImages[cardName] : undefined,
      order: Number(row.dernier || 0)
    };
  });
  const maxDernier = useMemo(() => {
    return playedCards.reduce((max, card) => (card.order > max ? card.order : max), 0);
  }, [playedCards]);

  const teams = useMemo(() => {
    const team1 = rows.filter((row) => row.seat === 1 || row.seat === 3);
    const team2 = rows.filter((row) => row.seat === 2 || row.seat === 4);
    return { team1, team2 };
  }, [rows]);
  const team1Belote = teams.team1.some((row) => (row.belote || 0) > 0);
  const team2Belote = teams.team2.some((row) => (row.belote || 0) > 0);

  useEffect(() => {
    const cardsOnTable = rows.some((row) => row.pli && row.pli.includes('1'));
    if (!handOver || cardsOnTable) {
      if (handResultShown) {
        setHandResultShown(false);
      }
      return;
    }
    if (handResultShown) return;

    const miseRow = rows.find((row) => row.mise);
    if (!miseRow) {
      setHandResultShown(true);
      return;
    }

    const contractValue = parseContractValue(miseRow.mise.split(' ')[0] || '');
    const team1Points = teams.team1.reduce((sum, row) => sum + (row.points || 0), 0);
    const team2Points = teams.team2.reduce((sum, row) => sum + (row.points || 0), 0);
    const attackTeamIsTeam1 = miseRow.seat % 2 === 1;
    const attackPoints = attackTeamIsTeam1 ? team1Points : team2Points;
    const attackBelote = attackTeamIsTeam1 ? team1Belote : team2Belote;
    const attackPointsSansBelote = attackPoints - (attackBelote ? 20 : 0);
    const wins =
      attackPointsSansBelote >= 82 &&
      (contractValue === 0 || attackPoints >= contractValue);
    const message = wins ? 'partie gagnée' : 'partie chutée';

    Alert.alert(message);
    setHandResultShown(true);
  }, [handOver, handResultShown, rows, teams]);

  const seats = useMemo(() => {
    if (!currentRow) {
      return { partner: null, leftOpp: null, rightOpp: null };
    }
    const partnerSeat = currentRow.seat <= 2 ? currentRow.seat + 2 : currentRow.seat - 2;
    const leftSeat = currentRow.seat === 1 ? 4 : currentRow.seat - 1;
    const rightSeat = currentRow.seat === 4 ? 1 : currentRow.seat + 1;
    return {
      partner: rows.find((row) => row.seat === partnerSeat) || null,
      leftOpp: rows.find((row) => row.seat === leftSeat) || null,
      rightOpp: rows.find((row) => row.seat === rightSeat) || null
    };
  }, [currentRow, rows]);

  const isBeloteVisible = (row: any) => {
    if (!row || !beloteAtout || !row.pli || !row.pli.includes('1')) return false;
    if (!row.belote) return false;
    const cardName = getCardNameFromPli(row.pli);
    if (!cardName) return false;
    return (
      (cardName.startsWith('dame de ') || cardName.startsWith('roi de ')) &&
      cardName.includes(beloteAtout)
    );
  };

  useEffect(() => {
    if (contract !== 'passe' && parseContractValue(contract) <= highestBidValue) {
      setContract('passe');
      setSuit(null);
    }
  }, [contract, highestBidValue]);

  async function handleCloseBids(mode: 'lancer' | 'coinche' | 'contre-coinche') {
    triggerHaptic();
    const payload: { contrat: string; coinche?: string } = { contrat: 'passe', coinche: mode };
    if (mode === 'coinche') {
      payload.coinche = 'coinche';
    } else if (mode === 'contre-coinche') {
      payload.coinche = 'contre-coinche';
    }
    await placeBid(gameId, payload);
    setContract('passe');
    setSuit(null);
  }

  async function handleBid() {
    triggerHaptic();
    const payload: { contrat: string; atout?: string } = { contrat: contract };
    if (suit) {
      payload.atout = suit;
    }
    await placeBid(gameId, payload);
    setContract('passe');
    setSuit(null);
  }

  async function handlePlay(card: string) {
    if (gamePhase === 'bid') {
      return;
    }
    if (activeRow?.player_id !== session?.user?.id) {
      return;
    }
    if (pendingPlay) {
      return;
    }
    triggerHaptic();
    const prevRows = rows;
    const optimisticRows = applyOptimisticPlay(rows, session?.user?.id, card);
    setPendingPlay({ card, prevRows });
    setRows(optimisticRows);
    try {
      await playCard(gameId, card);
    } catch (_err) {
      setRows(prevRows);
    } finally {
      setPendingPlay(null);
    }
  }

  async function handleJoin(seat: number) {
    triggerHaptic();
    await joinGame(gameId, seat);
    await loadGame();
  }

  async function handleRobot(seat: number) {
    triggerHaptic();
    await addRobot(gameId, seat);
    await loadGame();
  }

  async function handleDeal() {
    triggerHaptic();
    await dealHand(gameId);
    await loadGame({ silent: true });
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator size="large" color="#0f172a" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: insets.top + 8 }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.back}>Retour</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Table {gameId.slice(0, 6).toUpperCase()}</Text>
          <View style={styles.headerSpacer} />
        </View>

        {currentRow ? (
          <View style={styles.seatLayout}>
            <View style={styles.seatRowTop}>
              {seats.partner ? (
                <View style={[styles.seatCardCenter, seats.partner.tour === 'tour' ? styles.seatActive : null]}>
                  <View style={styles.partnerRow}>
                    <View style={styles.seatHeaderCompact}>
                      <AvatarBox row={seats.partner} active={false} />
                      <Text style={styles.seatNameCompact}>{getDisplayName(seats.partner)}</Text>
                    </View>
                    {bidsById.get(seats.partner.id) ? (
                      <View style={[styles.bidBubble, styles.partnerBidBubble]}>
                        <Text style={styles.bidBubbleText}>{bidsById.get(seats.partner.id)}</Text>
                      </View>
                    ) : null}
                    {isBeloteVisible(seats.partner) ? (
                      <View style={[styles.beloteBubble, styles.partnerBeloteBubble]}>
                        <Text style={styles.beloteText}>Belote</Text>
                      </View>
                    ) : null}
                  </View>
                  {seats.partner.player_name === String(seats.partner.seat) ? (
                    <View style={styles.joinActionsCenter}>
                      {!currentRow ? (
                        <Pressable style={styles.joinButton} onPress={() => handleJoin(seats.partner.seat)}>
                          <Text style={styles.joinText}>Entrer</Text>
                        </Pressable>
                      ) : null}
                      <Pressable style={styles.robotButton} onPress={() => handleRobot(seats.partner.seat)}>
                        <Text style={styles.robotText}>Robot</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={styles.tableGrid}>
            {rows.map((row) => (
              <View key={row.id} style={[styles.seatCard, row.tour === 'tour' ? styles.seatActive : null]}>
                <View style={styles.seatHeader}>
                  <AvatarBox row={row} active={false} />
                  <View>
                    <Text style={styles.seatName}>{getDisplayName(row)}</Text>
                    <Text style={styles.seatMeta}>Seat {row.seat}</Text>
                    <Text style={styles.seatMeta}>Points {row.points}</Text>
                  </View>
                </View>
                {row.player_name === String(row.seat) ? (
                  <View style={styles.joinActions}>
                    <Pressable style={styles.joinButton} onPress={() => handleJoin(row.seat)}>
                      <Text style={styles.joinText}>Entrer</Text>
                    </Pressable>
                    <Pressable style={styles.robotButton} onPress={() => handleRobot(row.seat)}>
                      <Text style={styles.robotText}>Robot</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        )}

          <View style={styles.tableRow}>
          {currentRow ? (
            <View style={[styles.seatCardEdge, seats.leftOpp?.tour === 'tour' ? styles.seatActive : null]}>
              {seats.leftOpp ? (
                <View style={styles.seatHeaderCompact}>
                  <AvatarBox row={seats.leftOpp} active={false} />
                  <Text style={styles.seatNameCompact}>{getDisplayName(seats.leftOpp)}</Text>
                </View>
              ) : null}
              {seats.leftOpp && bidsById.get(seats.leftOpp.id) ? (
                <View style={styles.bidBubble}>
                  <Text style={styles.bidBubbleText}>{bidsById.get(seats.leftOpp.id)}</Text>
                </View>
              ) : null}
              {seats.leftOpp && isBeloteVisible(seats.leftOpp) ? (
                <View style={styles.beloteBubble}>
                  <Text style={styles.beloteText}>Belote</Text>
                </View>
              ) : null}
              {seats.leftOpp?.player_name === String(seats.leftOpp?.seat) ? (
                <View style={styles.joinActionsStack}>
                  {!currentRow ? (
                    <Pressable style={styles.joinButton} onPress={() => handleJoin(seats.leftOpp.seat)}>
                      <Text style={styles.joinText}>Entrer</Text>
                    </Pressable>
                  ) : null}
                  <Pressable style={styles.robotButton} onPress={() => handleRobot(seats.leftOpp.seat)}>
                    <Text style={styles.robotText}>Robot</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}
          <View style={styles.tableSurface}>
            <View style={styles.tableGlow} />
            {playedCards.map((card) => {
              let style = styles.tableSeatBottom;
              let highlight = false;
              if (currentRow) {
                const relative = (card.seat - currentRow.seat + 4) % 4;
                if (relative === 0) {
                  style = styles.tableSeatBottom;
                } else if (relative === 1) {
                  style = styles.tableSeatRight;
                } else if (relative === 2) {
                  style = styles.tableSeatTop;
                } else if (relative === 3) {
                  style = styles.tableSeatLeft;
                }
              } else {
                style = styles[`tableSeat${card.seat}` as keyof typeof styles] || styles.tableSeatBottom;
              }
              return (
                <TableCard
                  key={card.seat}
                  label={card.cardName || ''}
                  image={card.image}
                  style={[style, { zIndex: card.order || 0 }]}
                  highlight={highlight}
                />
              );
            })}
          </View>
          {currentRow ? (
            <View style={[styles.seatCardEdge, seats.rightOpp?.tour === 'tour' ? styles.seatActive : null]}>
              {seats.rightOpp ? (
                <View style={styles.seatHeaderCompact}>
                  <AvatarBox row={seats.rightOpp} active={false} />
                  <Text style={styles.seatNameCompact}>{getDisplayName(seats.rightOpp)}</Text>
                </View>
              ) : null}
              {seats.rightOpp && bidsById.get(seats.rightOpp.id) ? (
                <View style={styles.bidBubble}>
                  <Text style={styles.bidBubbleText}>{bidsById.get(seats.rightOpp.id)}</Text>
                </View>
              ) : null}
              {seats.rightOpp && isBeloteVisible(seats.rightOpp) ? (
                <View style={styles.beloteBubble}>
                  <Text style={styles.beloteText}>Belote</Text>
                </View>
              ) : null}
              {seats.rightOpp?.player_name === String(seats.rightOpp?.seat) ? (
                <View style={styles.joinActionsStack}>
                  {!currentRow ? (
                    <Pressable style={styles.joinButton} onPress={() => handleJoin(seats.rightOpp.seat)}>
                      <Text style={styles.joinText}>Entrer</Text>
                    </Pressable>
                  ) : null}
                  <Pressable style={styles.robotButton} onPress={() => handleRobot(seats.rightOpp.seat)}>
                    <Text style={styles.robotText}>Robot</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        {currentRow && !allSeatsFilled ? (
          <View style={styles.selfBlock}>
            <AvatarBox row={currentRow} active={false} />
            <Text style={styles.selfName}>{getDisplayName(currentRow)}</Text>
          </View>
        ) : null}

        {allSeatsFilled ? (
          <View style={styles.sectionCompact}>
            <View style={styles.beloteLine}>
              {currentRow && isBeloteVisible(currentRow) ? (
                <View style={styles.beloteBubble}>
                  <Text style={styles.beloteText}>Belote</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.myBidLine}>
              {myLastBid ? (
                <View style={styles.bidBubble}>
                  <Text style={styles.bidBubbleText}>{myLastBid}</Text>
                </View>
              ) : null}
            </View>
            {currentRow?.proposition && currentRow.proposition !== 'desactive' ? (
              <View style={styles.propositionBlock}>
                <Text style={styles.propositionLabel}>Proposition</Text>
                <Text style={styles.propositionValue}>{currentRow.proposition}</Text>
                {currentRow.proposition_reason ? (
                  <Text style={styles.propositionReason}>{currentRow.proposition_reason}</Text>
                ) : null}
              </View>
            ) : null}
            <View
              style={[
                styles.handGrid,
                activeRow?.player_id === session?.user?.id ? styles.handActive : null
              ]}
              pointerEvents={gamePhase === 'bid' ? 'none' : 'auto'}
            >
              {hand.map((card, index) => {
                const image = cardImages[card];
                return (
                  <HandCard
                    key={`${card}-${index}`}
                    index={index}
                    total={hand.length}
                    disabled={gamePhase === 'bid' || activeRow?.player_id !== session?.user?.id || !!pendingPlay}
                    onPress={() => handlePlay(card)}
                    image={image}
                    label={card}
                  />
                );
              })}
            </View>
            {gamePhase === 'bid' ? (
              <View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillRow}>
                  {CONTRACTS.filter((value) => {
                    if (closeBidPhase && value === 'passe') {
                      return false;
                    }
                    return value === 'passe' || parseContractValue(value) > highestBidValue;
                  }).map((value) => {
                    const isActive = contract === value;
                    return (
                    <Pressable
                      key={value}
                      onPress={() => {
                        triggerHaptic();
                        setContract(value);
                        if (value === 'passe') {
                          setSuit(null);
                        }
                        }}
                        style={[styles.pill, isActive ? styles.pillActive : null]}
                      >
                        <Text style={[styles.pillText, isActive ? styles.pillTextActive : null]}>{value}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={[styles.pillRow, contract === 'passe' ? styles.suitRowHidden : null]}
                >
                  {SUITS.map((value) => (
                    <Pressable
                      key={value}
                      onPress={() => {
                        triggerHaptic();
                        setSuit(value);
                      }}
                      style={[
                        styles.pill,
                        styles.suitPill,
                        ['pique', 'trefle', 'carreau', 'coeur'].includes(value) ? styles.suitPillFace : null,
                        suit === value ? styles.suitPillActive : null
                      ]}
                      disabled={contract === 'passe'}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          styles.pillSymbol,
                          ['pique', 'trefle'].includes(value) ? styles.suitSymbolDark : null,
                          value === 'coeur' || value === 'carreau' ? styles.suitSymbolRed : null
                        ]}
                      >
                        {SUIT_SYMBOLS[value] || value}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <View style={styles.actionRowCompact}>
                  <Pressable
                    style={[
                      styles.primaryButtonCompact,
                      activeRow?.player_id !== session?.user?.id || (contract !== 'passe' && !suit)
                      ? styles.disabled
                      : null
                  ]}
                  onPress={handleBid}
                  disabled={activeRow?.player_id !== session?.user?.id || (contract !== 'passe' && !suit)}
                  >
                    <Text style={styles.primaryButtonText}>Valider</Text>
                  </Pressable>
                  {closeBidPhase ? (
                    <Pressable
                      style={styles.secondaryButtonCompact}
                      onPress={() => {
                        triggerHaptic();
                        cancelBids(gameId);
                      }}
                    >
                      <Text style={styles.secondaryButtonText}>Annuler les encheres</Text>
                    </Pressable>
                  ) : null}
                </View>
                {activeRow?.player_id === session?.user?.id &&
                closeBidPhase ? (
                  <View style={styles.actionRowCompact}>
                    <Pressable style={styles.launchButton} onPress={() => handleCloseBids('lancer')}>
                      <Text style={styles.launchButtonText}>Lancer</Text>
                    </Pressable>
                    <Pressable style={styles.coincheButton} onPress={() => handleCloseBids('coinche')}>
                      <Text style={styles.coincheButtonText}>Coincher</Text>
                    </Pressable>
                    <Pressable
                      style={styles.contreCoincheButton}
                      onPress={() => handleCloseBids('contre-coinche')}
                    >
                      <Text style={styles.contreCoincheButtonText}>Contre-coincher</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={styles.actionRowCompact}>
                {currentRow?.dernier && Number(currentRow.dernier) === maxDernier ? (
                  <Pressable
                    style={styles.secondaryButtonCompact}
                    onPress={() => {
                      triggerHaptic();
                      undoLast(gameId);
                    }}
                  >
                    <Text style={styles.secondaryButtonText}>Annuler carte</Text>
                  </Pressable>
                ) : null}
                {currentRow?.resultat === 'gagnant' ? (
                  <>
                    <Pressable
                      style={styles.secondaryButtonCompact}
                      onPress={() => {
                        triggerHaptic();
                        cancelTrick(gameId);
                      }}
                    >
                      <Text style={styles.secondaryButtonText}>Annuler pli</Text>
                    </Pressable>
                    <Pressable
                      style={styles.primaryButtonCompact}
                      onPress={() => {
                        triggerHaptic();
                        collectTrick(gameId);
                      }}
                    >
                      <Text style={styles.primaryButtonText}>Ramasser</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            )}
            {handOver && handResultShown && currentRow?.id === starterRow?.id ? (
              <View style={styles.dealRow}>
                <Pressable style={styles.primaryButtonCompact} onPress={handleDeal}>
                  <Text style={styles.primaryButtonText}>Distribuer</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        {null}

        {allSeatsFilled ? (
          <View style={styles.sectionCompact}>
            <Text style={styles.sectionTitle}>Equipes</Text>
            <Text style={styles.sectionText}>
              {teams.team1.map((row) => getDisplayName(row)).join(' / ')} :{' '}
              {teams.team1.reduce((sum, row) => sum + (row.partie || 0), 0)} /{' '}
              {teams.team1.reduce((sum, row) => sum + (row.points || 0), 0)}
              {team1Belote ? ' (belote)' : ''}
            </Text>
            <Text style={styles.sectionText}>
              {teams.team2.map((row) => getDisplayName(row)).join(' / ')} :{' '}
              {teams.team2.reduce((sum, row) => sum + (row.partie || 0), 0)} /{' '}
              {teams.team2.reduce((sum, row) => sum + (row.points || 0), 0)}
              {team2Belote ? ' (belote)' : ''}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0f172a'
  },
  container: {
    padding: 14,
    paddingBottom: 32
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  back: {
    color: '#f8fafc'
  },
  headerTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontFamily: 'serif'
  },
  headerSpacer: {
    width: 64
  },
  tableGrid: {
    marginTop: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10
  },
  seatLayout: {
    marginTop: 12,
    gap: 0
  },
  seatRowTop: {
    alignItems: 'center',
    marginBottom: 0
  },
  partnerRow: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56
  },
  partnerBidBubble: {
    position: 'absolute',
    right: -68,
    top: 6
  },
  partnerBeloteBubble: {
    position: 'absolute',
    right: -68,
    top: 32
  },
  tableRow: {
    marginTop: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8
  },
  seatHeaderCompact: {
    alignItems: 'center',
    gap: 6
  },
  seatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  avatarFrame: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center'
  },
  avatarFrameActive: {
    borderColor: '#ef4444'
  },
  avatarImage: {
    width: 44,
    height: 44,
    borderRadius: 14
  },
  avatarPlaceholderInner: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#1f2937'
  },
  seatCard: {
    backgroundColor: '#111827',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    width: '48%'
  },
  seatCardSmall: {
    backgroundColor: '#111827',
    padding: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    flex: 1
  },
  seatCardEdge: {
    backgroundColor: '#111827',
    padding: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    width: 72,
    alignItems: 'center'
  },
  seatCardCenter: {
    backgroundColor: '#111827',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    width: 96
  },
  selfBlock: {
    marginTop: 10,
    alignItems: 'center',
    gap: 6
  },
  selfName: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700'
  },
  seatActive: {
    borderColor: '#f59e0b',
    shadowColor: '#f59e0b',
    shadowOpacity: 0.4,
    shadowRadius: 8
  },
  seatName: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700'
  },
  seatNameCompact: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center'
  },
  sideBid: {
    marginTop: 6,
    color: '#cbd5f5',
    fontSize: 14,
    textAlign: 'center'
  },
  bidBubble: {
    marginTop: 6,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    alignSelf: 'center',
    minWidth: 72
  },
  bidBubbleText: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '700'
  },
  beloteBubble: {
    marginTop: 6,
    backgroundColor: '#facc15',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    alignSelf: 'center'
  },
  beloteText: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '700'
  },
  seatMeta: {
    marginTop: 4,
    color: '#94a3b8'
  },
  joinActions: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 8
  },
  joinActionsCenter: {
    marginTop: 10,
    alignItems: 'center',
    gap: 6
  },
  joinActionsStack: {
    marginTop: 10,
    gap: 6
  },
  joinButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#f59e0b'
  },
  joinText: {
    color: '#1f2937',
    fontWeight: '700'
  },
  robotButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#64748b',
    minWidth: 64,
    alignItems: 'center'
  },
  robotText: {
    color: '#e2e8f0'
  },
  sectionCompact: {
    marginTop: 12,
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1f2937'
  },
  tableSurface: {
    marginTop: 10,
    height: 190,
    borderRadius: 22,
    backgroundColor: '#0b1a2a',
    borderWidth: 1,
    borderColor: '#1f2f4a',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    flex: 1
  },
  tableGlow: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: '#1d4ed8',
    opacity: 0.1
  },
  tableCardSlot: {
    position: 'absolute'
  },
  tableSeatTop: {
    top: 12,
    left: '50%',
    marginLeft: -32
  },
  tableSeatBottom: {
    bottom: 12,
    left: '50%',
    marginLeft: -32
  },
  tableSeatLeft: {
    left: 12,
    top: '50%',
    marginTop: -46
  },
  tableSeatRight: {
    right: 12,
    top: '50%',
    marginTop: -46
  },
  tableSeat1: {
    bottom: 12,
    left: '50%',
    marginLeft: -32
  },
  tableSeat2: {
    top: 12,
    left: '50%',
    marginLeft: -32
  },
  tableSeat3: {
    top: '50%',
    left: 12,
    marginTop: -46
  },
  tableSeat4: {
    top: '50%',
    right: 12,
    marginTop: -46
  },
  tableCardImage: {
    width: 64,
    height: 92,
    borderRadius: 8,
    resizeMode: 'contain'
  },
  tablePlaceholder: {
    width: 64,
    height: 92,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center'
  },
  tablePlaceholderText: {
    color: '#64748b',
    fontSize: 10
  },
  sectionTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700'
  },
  sectionText: {
    marginTop: 8,
    color: '#cbd5f5'
  },
  propositionBlock: {
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b'
  },
  propositionLabel: {
    color: '#94a3b8',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1
  },
  propositionValue: {
    marginTop: 4,
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700'
  },
  propositionReason: {
    marginTop: 6,
    color: '#cbd5f5',
    fontSize: 12
  },
  pillRow: {
    marginTop: 8
  },
  pill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
    marginRight: 8
  },
  pillActive: {
    backgroundColor: '#f59e0b',
    borderColor: '#f59e0b'
  },
  pillText: {
    color: '#f8fafc'
  },
  pillTextActive: {
    color: '#0f172a'
  },
  pillSymbol: {
    fontSize: 16
  },
  suitPill: {
    backgroundColor: 'transparent'
  },
  suitPillFace: {
    backgroundColor: '#ffffff'
  },
  suitPillActive: {
    borderColor: '#f59e0b',
    backgroundColor: '#f59e0b'
  },
  suitSymbolDark: {
    color: '#0f172a'
  },
  suitSymbolRed: {
    color: '#b91c1c'
  },
  suitRowHidden: {
    opacity: 0
  },
  myBidLine: {
    minHeight: 22,
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: -10
  },
  beloteLine: {
    minHeight: 22,
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: -10
  },
  myBidText: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700'
  },
  primaryButtonCompact: {
    backgroundColor: '#f59e0b',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: 'center'
  },
  primaryButtonText: {
    color: '#1f2937',
    fontWeight: '700'
  },
  launchButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#86efac',
    alignItems: 'center'
  },
  launchButtonText: {
    color: '#14532d',
    fontWeight: '700'
  },
  coincheButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#fef08a',
    alignItems: 'center'
  },
  coincheButtonText: {
    color: '#713f12',
    fontWeight: '700'
  },
  contreCoincheButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: '#f87171',
    alignItems: 'center'
  },
  contreCoincheButtonText: {
    color: '#7f1d1d',
    fontWeight: '700'
  },
  secondaryButtonCompact: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#64748b',
    alignItems: 'center'
  },
  secondaryButtonText: {
    color: '#e2e8f0'
  },
  handGrid: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    minHeight: 96,
    paddingVertical: 6
  },
  handActive: {
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: 16,
    paddingHorizontal: 6
  },
  cardChip: {
    marginHorizontal: -22,
    borderRadius: 14,
    backgroundColor: 'transparent'
  },
  cardImage: {
    width: 66,
    height: 95,
    borderRadius: 8,
    resizeMode: 'contain'
  },
  cardText: {
    color: '#f8fafc',
    fontSize: 12
  },
  actionRowCompact: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  disabled: {
    opacity: 0.5
  },
  story: {
    marginTop: 10,
    color: '#94a3b8',
    lineHeight: 18
  },
  storyBlock: {
    marginTop: 12
  }
});
