import { supabase } from '@/lib/supabase';

export type FinoSeat = 'seat1' | 'seat2' | 'deck' | 'bin' | 'play';

export type FinoRow = {
  id: string;
  game: number;
  seat: FinoSeat;
  player_name: string | null;
  cards: string;
  turn_flag: string | null;
  points: number | null;
  first_flag: string | null;
  last_card: string | null;
  jack_rule: string | null;
  created_at: string;
  updated_at: string;
};

export type FinoLobbyGame = {
  game: number;
  seat1: string | null;
  seat2: string | null;
  canEnter: boolean;
  canDelete: boolean;
  mySeat: 'seat1' | 'seat2' | null;
};

export type FinoResolvedGame = {
  rows: FinoRow[];
  me: FinoRow;
  opponent: FinoRow;
  deck: FinoRow;
  play: FinoRow;
  mySeat: 'seat1' | 'seat2';
};

const FULL_DECK = [
  'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c0', 'cj', 'cq', 'ck',
  's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's0', 'sj', 'sq', 'sk',
  'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9', 'd0', 'dj', 'dq', 'dk',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h0', 'hj', 'hq', 'hk',
];

function shuffleDeck(cards: string[]) {
  const copy = [...cards];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function splitCards(cards: string | null | undefined) {
  if (!cards) return [] as string[];
  return cards.split(',').map((card) => card.trim()).filter(Boolean);
}

function joinCards(cards: string[]) {
  return cards.filter(Boolean).join(',');
}

function sameColorGroup(cardA: string, cardB: string) {
  const red = ['h', 'd'];
  const black = ['s', 'c'];
  if (red.includes(cardA[0]) && red.includes(cardB[0])) return true;
  if (black.includes(cardA[0]) && black.includes(cardB[0])) return true;
  return false;
}

async function updateFinoRow(id: string, patch: Partial<FinoRow>) {
  const { error } = await supabase.from('fino_rows').update(patch).eq('id', id);
  if (error) throw error;
}

async function resolveFinoGame(game: number, username: string): Promise<FinoResolvedGame> {
  const rows = await getFinoSnapshot(game);
  const seat1 = rows.find((row) => row.seat === 'seat1');
  const seat2 = rows.find((row) => row.seat === 'seat2');
  const deck = rows.find((row) => row.seat === 'deck');
  const play = rows.find((row) => row.seat === 'play');

  if (!seat1 || !seat2 || !deck || !play) {
    throw new Error('Partie Fino incomplète.');
  }

  if (seat1.player_name === username) {
    return { rows, me: seat1, opponent: seat2, deck, play, mySeat: 'seat1' };
  }

  if (seat2.player_name === username) {
    return { rows, me: seat2, opponent: seat1, deck, play, mySeat: 'seat2' };
  }

  throw new Error('Vous ne faites pas partie de cette partie.');
}

export function formatFinoCard(card: string) {
  if (!card) return '-';

  const suitMap: Record<string, string> = {
    c: '♣',
    s: '♠',
    d: '♦',
    h: '♥',
  };
  const valueMap: Record<string, string> = {
    '1': 'A',
    '0': '10',
    j: 'J',
    q: 'Q',
    k: 'K',
  };

  const suit = suitMap[card[0]] ?? card[0];
  const value = valueMap[card.slice(1)] ?? card.slice(1);
  return `${value}${suit}`;
}

export function getFinoRuleLabel(code: string | null | undefined) {
  const value = (code ?? '').trim();
  if (!value || value === '-' || value === 'F') return '';
  const ruleMap: Record<string, string> = {
    '1': 'As',
    '0': '10',
    j: 'Valet',
    q: 'Dame',
    k: 'Roi',
    a: 'n’importe quelle carte',
    h: 'coeur',
    d: 'carreau',
    s: 'pique',
    c: 'trèfle',
  };
  return ruleMap[value[0]] ?? value;
}

export function isFinoCardAuthorized(movedCard: string, playCard: string, jackThree: string | null | undefined) {
  if (!movedCard || !playCard) return false;
  const rule = (jackThree ?? 'F')[0];
  let valid = false;

  if (playCard[1] === '1') {
    valid = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(movedCard[1]) || movedCard[0] === playCard[0];
  }

  if (playCard[1] === 'k') {
    valid = ['j', 'q', 'k'].includes(movedCard[1]) || movedCard[0] === playCard[0];
  }

  if (playCard[1] === '2') {
    valid = movedCard[1] === '2' || (movedCard[0] === playCard[0] && !['j', 'q', 'k'].includes(movedCard[1]));
  }

  if (playCard[1] === '4') {
    valid = movedCard[1] !== '4' && movedCard[0] === playCard[0];
  }

  if (['3', '5', '6', '7', '8', '9', '0', 'j', 'q'].includes(playCard[1])) {
    valid = playCard[0] === movedCard[0] || playCard[1] === movedCard[1];
  }

  if (movedCard[1] === '8') {
    valid = sameColorGroup(movedCard, playCard) || playCard[1] === '8' || playCard[1] === '1';
  }

  if (playCard[1] === 'j') {
    valid = movedCard[0] === rule;
  }

  if (playCard[1] === '3') {
    valid = movedCard[1] === rule && movedCard[0] === playCard[0];
    if (rule === '3' && movedCard[1] === '3') valid = true;
    if (movedCard[1] === '8' && rule === '8') valid = sameColorGroup(movedCard, playCard);
    if (rule === 'a') {
      valid = playCard[0] === movedCard[0] || playCard[1] === movedCard[1];
      if (movedCard[1] === '8') valid = sameColorGroup(movedCard, playCard) || playCard[1] === '8';
    }
  }

  if (rule === 'F') {
    valid = playCard[0] === movedCard[0] || playCard[1] === movedCard[1];
  }

  return valid;
}

export async function listFinoGames(currentUsername: string) {
  const { data, error } = await supabase
    .from('fino_rows')
    .select('id,game,seat,player_name,cards,turn_flag,points,first_flag,last_card,jack_rule,created_at,updated_at')
    .order('game', { ascending: true });

  if (error) throw error;

  const byGame = new Map<number, FinoLobbyGame>();
  (data ?? []).forEach((row) => {
    const typedRow = row as FinoRow;
    if (!byGame.has(typedRow.game)) {
      byGame.set(typedRow.game, {
        game: typedRow.game,
        seat1: null,
        seat2: null,
        canEnter: false,
        canDelete: false,
        mySeat: null,
      });
    }
    const game = byGame.get(typedRow.game)!;
    if (typedRow.seat === 'seat1') {
      game.seat1 = typedRow.player_name;
      if (typedRow.player_name === currentUsername) game.mySeat = 'seat1';
    }
    if (typedRow.seat === 'seat2') {
      game.seat2 = typedRow.player_name;
      if (typedRow.player_name === currentUsername) game.mySeat = 'seat2';
    }
  });

  return [...byGame.values()].map((game) => {
    const joined = game.mySeat !== null;
    const ready = !!game.seat1 && !!game.seat2;
    return {
      ...game,
      canEnter: joined && ready,
      canDelete: joined,
    };
  });
}

export async function createFinoGame() {
  const { data: currentRows, error: listError } = await supabase
    .from('fino_rows')
    .select('game')
    .order('game', { ascending: false })
    .limit(1);
  if (listError) throw listError;

  const nextGame = (currentRows?.[0]?.game ?? 0) + 1;
  const shuffled = shuffleDeck(FULL_DECK);

  const seat1Cards = shuffled.slice(0, 7).join(',');
  const seat2Cards = shuffled.slice(7, 14).join(',');
  const deckCards = shuffled.slice(14, 51).join(',');
  const playCard = shuffled.slice(51, 52).join(',');

  const payload = [
    {
      game: nextGame,
      seat: 'seat1' as const,
      player_name: null,
      cards: seat1Cards,
      turn_flag: 'Turn',
      points: 0,
      first_flag: 'yes',
      last_card: '-',
      jack_rule: 'F',
    },
    {
      game: nextGame,
      seat: 'seat2' as const,
      player_name: null,
      cards: seat2Cards,
      turn_flag: '',
      points: 0,
      first_flag: '',
      last_card: '-',
      jack_rule: 'F',
    },
    {
      game: nextGame,
      seat: 'deck' as const,
      player_name: 'Deck',
      cards: deckCards,
      turn_flag: '',
      points: null,
      first_flag: '',
      last_card: '',
      jack_rule: '',
    },
    {
      game: nextGame,
      seat: 'bin' as const,
      player_name: 'Bin',
      cards: '',
      turn_flag: '',
      points: null,
      first_flag: '',
      last_card: '',
      jack_rule: '',
    },
    {
      game: nextGame,
      seat: 'play' as const,
      player_name: 'Play',
      cards: playCard,
      turn_flag: '',
      points: null,
      first_flag: '',
      last_card: '',
      jack_rule: '',
    },
  ];

  const { error } = await supabase.from('fino_rows').insert(payload);
  if (error) throw error;
  return nextGame;
}

export async function joinFinoGame(game: number, seat: 'seat1' | 'seat2', username: string) {
  const { data: existingRows, error: existingError } = await supabase
    .from('fino_rows')
    .select('seat, player_name')
    .eq('game', game)
    .in('seat', ['seat1', 'seat2']);
  if (existingError) throw existingError;

  const alreadyJoined = (existingRows ?? []).find((row) => row.player_name === username);
  if (alreadyJoined) {
    return;
  }

  const targetSeat = (existingRows ?? []).find((row) => row.seat === seat);
  if (!targetSeat || targetSeat.player_name) {
    throw new Error('place_not_available');
  }

  const { error } = await supabase
    .from('fino_rows')
    .update({ player_name: username })
    .eq('game', game)
    .eq('seat', seat)
    .is('player_name', null);
  if (error) throw error;
}

export async function deleteFinoGame(game: number, username: string) {
  const { data: seats, error: seatsError } = await supabase
    .from('fino_rows')
    .select('player_name')
    .eq('game', game)
    .in('seat', ['seat1', 'seat2']);
  if (seatsError) throw seatsError;

  const belongsToPlayer = (seats ?? []).some((row) => row.player_name === username);
  if (!belongsToPlayer) {
    throw new Error('not_allowed_to_delete');
  }

  const { error } = await supabase.from('fino_rows').delete().eq('game', game);
  if (error) throw error;
}

export async function getFinoSnapshot(game: number) {
  const { data, error } = await supabase
    .from('fino_rows')
    .select('id,game,seat,player_name,cards,turn_flag,points,first_flag,last_card,jack_rule,created_at,updated_at')
    .eq('game', game)
    .order('seat', { ascending: true });

  if (error) throw error;
  return (data ?? []) as FinoRow[];
}

export async function playFinoCard(game: number, username: string, playedCard: string) {
  const state = await resolveFinoGame(game, username);
  const myCards = splitCards(state.me.cards);
  if (!myCards.includes(playedCard)) {
    throw new Error('Carte introuvable dans votre main.');
  }
  if (state.me.turn_flag !== 'Turn') {
    throw new Error('Ce n’est pas votre tour.');
  }
  if (!isFinoCardAuthorized(playedCard, state.play.cards, state.me.jack_rule)) {
    throw new Error('Carte non autorisée.');
  }

  const remaining = myCards.filter((card) => card !== playedCard);
  const opponentCards = splitCards(state.opponent.cards);
  let deckCards = splitCards(state.deck.cards);

  await updateFinoRow(state.me.id, { cards: joinCards(remaining) });

  if (playedCard[1] === '7' && deckCards.length >= 2) {
    const newOpponentCards = [...opponentCards, deckCards[0], deckCards[1]];
    deckCards = deckCards.slice(2);
    await updateFinoRow(state.opponent.id, { cards: joinCards(newOpponentCards) });
  }

  if (playedCard[1] === '9') {
    await updateFinoRow(state.me.id, { cards: state.opponent.cards });
    await updateFinoRow(state.opponent.id, { cards: joinCards(remaining) });
  }

  if (playedCard[1] === '6' || playedCard[1] === '0') {
    await updateFinoRow(state.opponent.id, { last_card: playedCard[1] });
  }

  const myLastCard = ['3', '5', 'j'].includes(playedCard[1]) ? playedCard[1] : '-';
  await updateFinoRow(state.me.id, { last_card: myLastCard });

  const resetJackUpdates = state.rows
    .filter((row) => row.jack_rule !== '-')
    .map((row) => updateFinoRow(row.id, { jack_rule: '-' }));
  await Promise.all(resetJackUpdates);

  const nextDeckCards = [...deckCards, state.play.cards];
  await updateFinoRow(state.deck.id, { cards: joinCards(nextDeckCards) });
  await updateFinoRow(state.play.id, { cards: playedCard });

  if (playedCard[1] === 'q') {
    const refreshed = await resolveFinoGame(game, username);
    const refreshedCards = splitCards(refreshed.me.cards);
    const refreshedDeck = splitCards(refreshed.deck.cards);
    if (!refreshedCards.length && refreshedDeck.length) {
      await updateFinoRow(refreshed.me.id, { cards: refreshedDeck[0] });
      await updateFinoRow(refreshed.deck.id, { cards: joinCards(refreshedDeck.slice(1)) });
    }
  }

  if (!['7', 'q', '5', '3', 'j'].includes(playedCard[1])) {
    await updateFinoRow(state.me.id, { turn_flag: '' });
    await updateFinoRow(state.opponent.id, { turn_flag: 'Turn' });
  }
}

export async function pickFinoCardFromDeck(game: number, username: string) {
  const state = await resolveFinoGame(game, username);
  if (state.me.turn_flag !== 'Turn') {
    throw new Error('Ce n’est pas votre tour.');
  }
  if (state.me.last_card === 'p') {
    return;
  }
  const deckCards = splitCards(state.deck.cards);
  if (!deckCards.length) {
    throw new Error('Le deck est vide.');
  }

  const myCards = splitCards(state.me.cards);
  await updateFinoRow(state.me.id, {
    cards: joinCards([...myCards, deckCards[0]]),
    last_card: 'p',
  });
  await updateFinoRow(state.deck.id, { cards: joinCards(deckCards.slice(1)) });
}

export async function passFinoTurn(game: number, username: string) {
  const state = await resolveFinoGame(game, username);
  if (state.me.turn_flag !== 'Turn') {
    throw new Error('Ce n’est pas votre tour.');
  }
  await updateFinoRow(state.me.id, { turn_flag: '', last_card: '-' });
  await updateFinoRow(state.opponent.id, { turn_flag: 'Turn' });
}

export async function swapFinoCard(game: number, username: string, swapCard: string) {
  const state = await resolveFinoGame(game, username);
  if (state.me.turn_flag !== 'Turn' || state.me.last_card !== '5') {
    throw new Error('Échange non autorisé.');
  }

  const myCards = splitCards(state.me.cards).filter((card) => card !== swapCard);
  const deckCards = splitCards(state.deck.cards);
  if (!deckCards.length) {
    throw new Error('Le deck est vide.');
  }

  const nextCards = [...myCards, deckCards[0]];
  const nextDeck = [...deckCards.slice(1), swapCard];

  await updateFinoRow(state.me.id, { cards: joinCards(nextCards), last_card: '-', turn_flag: '' });
  await updateFinoRow(state.deck.id, { cards: joinCards(nextDeck) });
  await updateFinoRow(state.opponent.id, { turn_flag: 'Turn' });
}

export async function pickFinoOpponentCard(game: number, username: string, pickedCard: string) {
  const state = await resolveFinoGame(game, username);
  if (state.me.turn_flag !== 'Turn' || state.me.last_card !== '0') {
    throw new Error('Action non autorisée.');
  }

  const opponentCards = splitCards(state.opponent.cards);
  if (!opponentCards.includes(pickedCard)) {
    throw new Error('Carte adverse introuvable.');
  }

  const myCards = splitCards(state.me.cards);
  await updateFinoRow(state.me.id, {
    cards: joinCards([...myCards, pickedCard]),
    last_card: '-',
  });
  await updateFinoRow(state.opponent.id, {
    cards: joinCards(opponentCards.filter((card) => card !== pickedCard)),
  });
}

export async function defineFinoRule(game: number, username: string, kind: string) {
  console.log('[FinoApi] defineFinoRule:start', { game, username, kind });
  const state = await resolveFinoGame(game, username);
  console.log('[FinoApi] defineFinoRule:state', {
    mySeat: state.mySeat,
    turnFlag: state.me.turn_flag,
    lastCard: state.me.last_card,
    opponent: state.opponent.player_name,
  });
  if (state.me.turn_flag !== 'Turn' || !['3', 'j'].includes(state.me.last_card ?? '')) {
    console.error('[FinoApi] defineFinoRule:forbidden', {
      turnFlag: state.me.turn_flag,
      lastCard: state.me.last_card,
    });
    throw new Error('Choix de règle non autorisé.');
  }

  await updateFinoRow(state.me.id, { turn_flag: '', last_card: '-' });
  await updateFinoRow(state.opponent.id, { turn_flag: 'Turn' });
  await Promise.all(state.rows.map((row) => updateFinoRow(row.id, { jack_rule: kind })));
  console.log('[FinoApi] defineFinoRule:success', { game, username, kind });
}

export async function applyFinoPenalty(game: number, username: string) {
  const state = await resolveFinoGame(game, username);
  const deckCards = splitCards(state.deck.cards);
  if (deckCards.length < 2) return;

  const myCards = splitCards(state.me.cards);
  await updateFinoRow(state.me.id, {
    cards: joinCards([...myCards, deckCards[0], deckCards[1]]),
  });
  await updateFinoRow(state.deck.id, { cards: joinCards(deckCards.slice(2)) });
}
