const { supabase } = require('../db');
const {
  CARD_NAMES,
  CARD_CODES,
  getCardIndexByName,
  getSuitFromIndex,
  getValueIndex,
  buildCardMask,
  pickTrickWinner,
  bitStringHasCard,
  removeCardFromHand,
  addCardToHand,
  scoreCard
} = require('./coincheRules');

const DEFAULT_HAND = '00000000000000000000000000000000';
const DEFAULT_BIDS = ',,';
const ROBOT_NAMES = ['donald', 'poutine', 'macron'];

function dealHands() {
  const deck = Array.from({ length: 32 }, (_, idx) => idx);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  const hands = [DEFAULT_HAND, DEFAULT_HAND, DEFAULT_HAND, DEFAULT_HAND].map((hand) =>
    hand.split('')
  );

  deck.forEach((cardIndex, idx) => {
    const seat = Math.floor(idx / 8);
    hands[seat][cardIndex] = '1';
  });

  return hands.map((hand) => hand.join(''));
}

function countCards(bitstring) {
  if (!bitstring) return 0;
  let count = 0;
  for (let i = 0; i < bitstring.length; i += 1) {
    if (bitstring[i] === '1') count += 1;
  }
  return count;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function autoPlayLastTrick(gameId, rows) {
  if (!rows.every((row) => countCards(row.main) === 1)) {
    return;
  }
  if (rows.some((row) => row.pli && row.pli.includes('1'))) {
    return;
  }

  await updateAllRows(gameId, { tour: '', resultat: 'auto' });

  const leaderRow = rows.find((row) => row.tour === 'tour') || rows[0];
  const cardsInOrder = [];
  let order = 1;

  for (let i = 0; i < 4; i += 1) {
    const seat = ((leaderRow.seat - 1 + i) % 4) + 1;
    const seatRow = rows.find((row) => row.seat === seat);
    if (!seatRow) continue;
    const cardIndex = seatRow.main.indexOf('1');
    if (cardIndex < 0) continue;
    await updateRow(seatRow.id, {
      pli: buildCardMask(cardIndex),
      main: removeCardFromHand(seatRow.main, cardIndex),
      dernier: String(order)
    });
    cardsInOrder.push({ seat, rowId: seatRow.id, cardIndex });
    order += 1;
    if (i < 3) {
      await sleep(500);
    }
  }

  const miseRow = rows.find((row) => row.mise);
  const atout = miseRow ? getBidParts(miseRow.mise).atout : '';
  const { winner } = pickTrickWinner(cardsInOrder, atout);

  await updateAllRows(gameId, { tour: '', resultat: '' });
  const winnerRow = rows.find((row) => row.seat === winner.seat);
  if (winnerRow) {
    await updateRow(winnerRow.id, { resultat: 'gagnant', tour: 'tour' });
  }

  await updateAllRows(gameId, { log: new Date().toISOString() });
  await updateGameTimestamp(gameId);
}

function pickRobotName(rows) {
  const used = new Set(rows.map((row) => row.robot_name).filter(Boolean));
  const available = ROBOT_NAMES.filter((name) => !used.has(name));
  const pool = available.length ? available : ROBOT_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function updateGameTimestamp(gameId) {
  const now = new Date().toISOString();
  await supabase
    .from('games')
    .update({ last_action_at: now, updated_at: now })
    .eq('id', gameId);
}

async function updateAllRows(gameId, payload) {
  const { error } = await supabase
    .from('coinche_rows')
    .update(payload)
    .eq('game_id', gameId);

  if (error) {
    return { error };
  }

  return { error: null };
}

async function updateRow(rowId, payload) {
  const { error } = await supabase
    .from('coinche_rows')
    .update(payload)
    .eq('id', rowId);

  if (error) {
    return { error };
  }

  return { error: null };
}

async function updateStory(gameId, appendText) {
  const { data, error } = await supabase
    .from('coinche_rows')
    .select('id, story')
    .eq('game_id', gameId)
    .eq('seat', 1)
    .single();

  if (error || !data) {
    return { error };
  }

  const nextStory = `${data.story || ''}${appendText}`;
  return updateRow(data.id, { story: nextStory });
}

async function createGame({ userId, username }) {
  const now = new Date().toISOString();
  const { data: game, error: gameError } = await supabase
    .from('games')
    .insert({ created_by: userId, last_action_at: now })
    .select()
    .single();

  if (gameError) {
    return { data: null, error: gameError };
  }

  const hands = dealHands();
  const rows = [1, 2, 3, 4].map((seat, idx) => ({
    game_id: game.id,
    seat,
    player_id: seat === 3 ? userId : null,
    player_name: seat === 3 ? username : String(seat),
    is_robot: false,
    robot_name: null,
    tour: seat === 3 ? 'tour' : '',
    main: hands[idx],
    tas: seat === 3 ? '%' : '',
    encheres: ',,',
    log: now
  }));

  const { error: rowsError } = await supabase
    .from('coinche_rows')
    .insert(rows);

  if (rowsError) {
    return { data: null, error: rowsError };
  }

  return { data: game, error: null };
}

async function listGames() {
  const { data: games, error } = await supabase
    .from('games')
    .select('id, created_at, status, last_action_at');

  if (error) {
    return { data: null, error };
  }

  return { data: games, error: null };
}

async function getGameRows(gameId) {
  const { data, error } = await supabase
    .from('coinche_rows')
    .select('*')
    .eq('game_id', gameId)
    .order('seat', { ascending: true });

  if (error) {
    return { data: null, error };
  }

  return { data, error: null };
}

async function getGameState(gameId) {
  const { data, error } = await getGameRows(gameId);
  if (error) {
    return { data: null, error };
  }

  return { data, error: null };
}

async function joinSeat({ gameId, seat, userId, username }) {
  const { error } = await supabase
    .from('coinche_rows')
    .update({
      player_id: userId,
      player_name: username,
      is_robot: false,
      robot_name: null
    })
    .eq('game_id', gameId)
    .eq('seat', seat);

  if (error) {
    return { data: null, error };
  }

  return getGameRows(gameId);
}

async function addRobot({ gameId, seat }) {
  const { data: rows, error } = await getGameRows(gameId);
  if (error) {
    return { data: null, error };
  }

  const nextRobotIndex = rows.filter((row) => row.is_robot).length + 1;
  const robotName = `robot${nextRobotIndex}`;
  const robotAvatar = pickRobotName(rows);

  const { error: updateError } = await supabase
    .from('coinche_rows')
    .update({
      player_id: null,
      player_name: robotName,
      is_robot: true,
      robot_name: robotAvatar
    })
    .eq('game_id', gameId)
    .eq('seat', seat);

  if (updateError) {
    return { data: null, error: updateError };
  }

  return getGameRows(gameId);
}

async function leaveGame({ gameId, userId }) {
  const { data: rows, error } = await getGameRows(gameId);
  if (error) {
    return { data: null, error };
  }

  const currentRow = rows.find((row) => row.player_id === userId);
  if (!currentRow) {
    return { data: null, error: { message: 'not_in_game' } };
  }

  const nextRobotIndex = rows.filter((row) => row.is_robot).length + 1;
  const robotName = `robot${nextRobotIndex}`;
  const robotAvatar = pickRobotName(rows);

  const { error: updateError } = await supabase
    .from('coinche_rows')
    .update({
      player_id: null,
      player_name: robotName,
      is_robot: true,
      robot_name: robotAvatar
    })
    .eq('id', currentRow.id);

  if (updateError) {
    return { data: null, error: updateError };
  }

  return getGameRows(gameId);
}

async function deleteGame({ gameId }) {
  const { error } = await supabase
    .from('games')
    .delete()
    .eq('id', gameId);

  if (error) {
    return { data: null, error };
  }

  return { data: { ok: true }, error: null };
}

async function dealNewHand({ gameId }) {
  const { data: rows, error } = await getGameRows(gameId);
  if (error) {
    return { data: null, error };
  }

  const starterRow = rows.find((row) => row.tas && row.tas.includes('%')) || rows[0];
  const nextSeat = getNextSeat(starterRow.seat);
  const hands = dealHands();

  await Promise.all(
    rows.map((row) =>
      updateRow(row.id, {
        main: hands[row.seat - 1],
        pli: '',
        tour: row.seat === nextSeat ? 'tour' : '',
        mise: '',
        resultat: '',
        encheres: DEFAULT_BIDS,
        atout_restant: '',
        entames: '',
        belote: 0,
        points: 0,
        dernier: '',
        debrief: 0,
        dernier_pli_rang: null,
        dernier_pli_carte: ''
      })
    )
  );

  await updateGameTimestamp(gameId);
  return getGameRows(gameId);
}

async function clearPropositions(gameId, rows) {
  const updates = rows
    .filter((row) => row.proposition !== 'desactive')
    .map((row) => updateRow(row.id, { proposition: '' }));

  await Promise.all(updates);
}

function parseBidValue(value) {
  if (!value || value === 'passe') return 0;
  const raw = value.split(' ')[0];
  if (raw === 'capot') return 250;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getBidParts(mise) {
  if (!mise) return { contrat: '', atout: '' };
  const parts = mise.trim().split(' ');
  return { contrat: parts[0], atout: parts[1] || '' };
}

function getNextSeat(seat) {
  return seat === 4 ? 1 : seat + 1;
}

function getBidHistoryFromStory(rows, storyText) {
  const totalBids = rows.reduce((sum, row) => {
    const bids = (row.encheres || DEFAULT_BIDS).split(',').filter(Boolean);
    return sum + bids.length;
  }, 0);
  if (!storyText || totalBids === 0) {
    return [];
  }

  const nameToSeat = new Map(rows.map((row) => [row.player_name, row.seat]));
  const lines = storyText.split('\n');
  const historyReversed = [];

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

function getTrailingPasses(history) {
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

function getCloseSeatFromHistory(history) {
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

async function bid({ gameId, userId, contrat, atout, coinche }) {
  const { data: rows, error } = await getGameRows(gameId);
  if (error) {
    return { data: null, error };
  }

  const activeRow = rows.find((row) => row.tour === 'tour');
  if (!activeRow) {
    return { data: null, error: { message: 'no_active_player' } };
  }

  if (activeRow.player_id !== userId && !activeRow.is_robot) {
    return { data: null, error: { message: 'not_your_turn' } };
  }

  const chosenBid = contrat === 'passe' ? 'passe' : `${contrat} ${atout}`;
  const updatedBid = `${activeRow.encheres || DEFAULT_BIDS}${chosenBid},`;

  const { error: bidError } = await updateRow(activeRow.id, { encheres: updatedBid });
  if (bidError) {
    return { data: null, error: bidError };
  }

  const storyLine =
    chosenBid === 'passe'
      ? `${activeRow.player_name} dit: passe.\n`
      : `${activeRow.player_name} dit: ${chosenBid}.\n`;
  await updateStory(gameId, storyLine);
  await clearPropositions(gameId, rows);

  const stateRows = rows.map((row) =>
    row.id === activeRow.id ? { ...row, encheres: updatedBid } : row
  );

  const summaries = stateRows.map((row) => {
    const bids = (row.encheres || DEFAULT_BIDS).split(',').filter(Boolean);
    const lastBid = bids[bids.length - 1] || '';
    let lastNonPass = '';
    for (let i = bids.length - 1; i >= 0; i -= 1) {
      if (bids[i] && bids[i] !== 'passe') {
        lastNonPass = bids[i];
        break;
      }
    }
    return { row, bids, lastBid, lastNonPass };
  });

  let highestValue = 0;
  let highestBid = '';
  let highestRow = null;
  summaries.forEach(({ row, bids }) => {
    bids.forEach((bid) => {
      const value = parseBidValue(bid);
      if (value > highestValue) {
        highestValue = value;
        highestBid = bid;
        highestRow = row;
      }
    });
  });

  const passCount = summaries.filter((summary) => summary.lastBid === 'passe').length;
  const storyBase = rows.find((row) => row.seat === 1)?.story || '';
  const storyForCalc = `${storyBase}${storyLine}`;
  const bidHistory = getBidHistoryFromStory(stateRows, storyForCalc);
  const closeSeat = highestValue > 0 ? getCloseSeatFromHistory(bidHistory) : null;

  const closeBidAction = ['lancer', 'coinche', 'contre-coinche'].includes(coinche || '');
  if (closeBidAction) {
    const winnerRow = highestRow || activeRow;
    const winnerSummary = summaries.find((summary) => summary.row.id === winnerRow.id);
    const winningBid = winnerSummary?.lastNonPass || highestBid;
    const parsedWinning = getBidParts(winningBid);
    const normalizedCoinche = coinche === 'lancer' ? '' : coinche || '';
    const miseFinale = `${parsedWinning.contrat} ${parsedWinning.atout} ${normalizedCoinche}`.trim();

    await updateAllRows(gameId, {
      resultat: '',
      atout_restant: '1234',
      entames: '1234',
      belote: 0,
      tour: ''
    });

    if (winnerRow) {
      await updateRow(winnerRow.id, { mise: miseFinale });
    }

    const beloteUpdates = stateRows.map((row) => {
      if (!parsedWinning.atout) return null;
      let baseIndex = 0;
      if (parsedWinning.atout === 'carreau') baseIndex = 8;
      if (parsedWinning.atout === 'trefle') baseIndex = 16;
      if (parsedWinning.atout === 'coeur') baseIndex = 24;
      const queenIndex = baseIndex + 5;
      const kingIndex = baseIndex + 6;
      const hasQueen = row.main?.[queenIndex] === '1';
      const hasKing = row.main?.[kingIndex] === '1';
      if (hasQueen && hasKing) {
        return updateRow(row.id, { belote: 20 });
      }
      return null;
    });

    await Promise.all(beloteUpdates.filter(Boolean));

    const starterRow = stateRows.find((row) => row.tas && row.tas !== '');
    if (starterRow) {
      await updateRow(starterRow.id, { tour: 'tour' });
    }

    await updateGameTimestamp(gameId);
    return getGameRows(gameId);
  }

  if (closeSeat && chosenBid === 'passe') {
    const closeRow = stateRows.find((row) => row.seat === closeSeat);
    if (closeRow) {
      await updateAllRows(gameId, { resultat: '', tour: '' });
      await updateRow(closeRow.id, { resultat: 'fin des encheres', tour: 'tour' });
      await updateGameTimestamp(gameId);
      return getGameRows(gameId);
    }
  }

  if (highestValue === 0 && passCount === 4) {
    const hands = dealHands();
    await updateAllRows(gameId, {
      tas: '',
      tour: '',
      mise: '',
      pli: '',
      encheres: DEFAULT_BIDS,
      resultat: '',
      atout_restant: '',
      main: DEFAULT_HAND
    });

    const nextSeat = getNextSeat(activeRow.seat);
    const nextRow = stateRows.find((row) => row.seat === nextSeat);
    if (nextRow) {
      await updateRow(nextRow.id, { tas: '%', tour: 'tour' });
    }

    await Promise.all(
      stateRows.map((row) => updateRow(row.id, { main: hands[row.seat - 1] }))
    );

    await updateGameTimestamp(gameId);
    return getGameRows(gameId);
  }

  if (activeRow.resultat === 'fin des encheres' && chosenBid !== 'passe') {
    await updateAllRows(gameId, { resultat: '' });
  }

  await updateAllRows(gameId, { tour: '' });
  const nextSeat = getNextSeat(activeRow.seat);
  const nextRow = stateRows.find((row) => row.seat === nextSeat);
  if (nextRow) {
    await updateRow(nextRow.id, { tour: 'tour' });
  }

  await updateGameTimestamp(gameId);
  return getGameRows(gameId);
}

async function cancelBids({ gameId }) {
  await updateAllRows(gameId, { resultat: '', tour: '' });
  const { data: rows, error } = await getGameRows(gameId);
  if (error) {
    return { data: null, error };
  }
  const starter = rows.find((row) => row.tas === '%');
  if (starter) {
    await updateRow(starter.id, { tour: 'tour' });
  }
  await updateAllRows(gameId, { encheres: DEFAULT_BIDS });
  await updateGameTimestamp(gameId);
  return getGameRows(gameId);
}

async function playCard({ gameId, userId, cardName, timings }) {
  const { data: rows, error } = await getGameRows(gameId);
  if (timings) timings.getRows1Ms = Date.now() - timings.startTs;
  if (error) {
    return { data: null, error };
  }

  const activeRow = rows.find((row) => row.tour === 'tour');
  if (!activeRow) {
    return { data: null, error: { message: 'no_active_player' } };
  }

  if (activeRow.player_id !== userId && !activeRow.is_robot) {
    return { data: null, error: { message: 'not_your_turn' } };
  }

  const cardIndex = getCardIndexByName(cardName);
  if (cardIndex < 0) {
    return { data: null, error: { message: 'unknown_card' } };
  }

  if (!bitStringHasCard(activeRow.main, cardIndex)) {
    return { data: null, error: { message: 'card_not_in_hand' } };
  }

  const cardMask = buildCardMask(cardIndex);
  const nextHand = removeCardFromHand(activeRow.main, cardIndex);
  let updatePayload = { pli: cardMask, main: nextHand };

  const miseRow = rows.find((row) => row.mise);
  const atout = miseRow ? getBidParts(miseRow.mise).atout : '';
  const suit = getSuitFromIndex(cardIndex);
  const valueIndex = getValueIndex(cardIndex);
  const isBeloteCard =
    ['pique', 'carreau', 'trefle', 'coeur'].includes(atout) &&
    suit === atout &&
    (valueIndex === 5 || valueIndex === 6) &&
    (activeRow.belote || 0) > 0;

  if (isBeloteCard) {
    const belotePoints = activeRow.belote === 20 ? 20 : 0;
    updatePayload = {
      ...updatePayload,
      belote: 10,
      points: (activeRow.points || 0) + belotePoints
    };
  }

  await updateRow(activeRow.id, updatePayload);
  await updateStory(gameId, `${activeRow.player_name} joue ${cardName}.\n`);
  await clearPropositions(gameId, rows);
  if (timings) timings.updates1Ms = Date.now() - timings.startTs;

  await updateAllRows(gameId, { log: new Date().toISOString() });

  const maxDernier = rows.reduce((max, row) => {
    const value = Number(row.dernier || 0);
    return value > max ? value : max;
  }, 0);

  await updateRow(activeRow.id, { dernier: String(maxDernier + 1) });

  const nextSeat = getNextSeat(activeRow.seat);
  const nextRow = rows.find((row) => row.seat === nextSeat);
  await updateAllRows(gameId, { tour: '' });
  if (nextRow) {
    await updateRow(nextRow.id, { tour: 'tour' });
  }
  if (timings) timings.updates2Ms = Date.now() - timings.startTs;

  const refreshed = await getGameRows(gameId);
  if (timings) timings.getRows2Ms = Date.now() - timings.startTs;
  if (refreshed.error) {
    return refreshed;
  }

  const currentRows = refreshed.data;
  const plies = currentRows.filter((row) => row.pli && row.pli.includes('1'));
  if (plies.length === 4) {
    let atout = '';
    const miseRow = currentRows.find((row) => row.mise);
    if (miseRow?.mise) {
      const { atout: bidAtout } = getBidParts(miseRow.mise);
      atout = bidAtout;
    }

    const leaderRow = currentRows.find((row) => row.tour === 'tour') || currentRows[0];
    const cardsInOrder = [];
    for (let i = 0; i < 4; i += 1) {
      const seat = ((leaderRow.seat - 1 + i) % 4) + 1;
      const seatRow = currentRows.find((row) => row.seat === seat);
      if (!seatRow) continue;
      const cardIndexPlayed = seatRow.pli.indexOf('1');
      cardsInOrder.push({ seat, rowId: seatRow.id, cardIndex: cardIndexPlayed });
    }

    const { winner } = pickTrickWinner(cardsInOrder, atout);
    await updateAllRows(gameId, { resultat: '' });
    await updateAllRows(gameId, { tour: '' });
    const winnerRow = currentRows.find((row) => row.seat === winner.seat);
    if (winnerRow) {
      await updateRow(winnerRow.id, { resultat: 'gagnant', tour: 'tour' });
      await updateStory(gameId, `${winnerRow.player_name} remport le pli, c'est donc a lui de jouer.\n`);
    }

    const allHandsEmpty = currentRows.every((row) => row.main === DEFAULT_HAND);
    if (allHandsEmpty) {
      await collectTrick({ gameId });
    }
    if (timings) timings.trickMs = Date.now() - timings.startTs;
  }

  await updateGameTimestamp(gameId);
  if (timings) timings.totalMs = Date.now() - timings.startTs;
  return getGameRows(gameId);
}

async function undoLast({ gameId }) {
  const { data: rows, error } = await getGameRows(gameId);
  if (error) {
    return { data: null, error };
  }

  let lastRow = null;
  let lastValue = 0;
  rows.forEach((row) => {
    const value = Number(row.dernier || 0);
    if (value > lastValue) {
      lastValue = value;
      lastRow = row;
    }
  });

  if (!lastRow || !lastRow.pli) {
    return { data: rows, error: null };
  }

  const cardIndex = lastRow.pli.indexOf('1');
  if (cardIndex >= 0) {
    const restored = addCardToHand(lastRow.main, cardIndex);
    await updateAllRows(gameId, { tour: '', resultat: '' });
    await updateRow(lastRow.id, {
      tour: 'tour',
      pli: '',
      main: restored,
      dernier: ''
    });
  }

  await updateGameTimestamp(gameId);
  return getGameRows(gameId);
}

async function cancelTrick({ gameId }) {
  const { data: rows, error } = await getGameRows(gameId);
  if (error) {
    return { data: null, error };
  }

  await updateAllRows(gameId, { resultat: '', tour: '' });
  const firstRow = rows.find((row) => String(row.dernier) === '1');
  if (firstRow) {
    await updateRow(firstRow.id, { tour: 'tour' });
  }
  await updateAllRows(gameId, { dernier: '' });

  for (const row of rows) {
    let main = row.main;
    if (row.pli) {
      for (let i = 0; i < row.pli.length; i += 1) {
        if (row.pli[i] === '1') {
          main = addCardToHand(main, i);
        }
      }
    }
    await updateRow(row.id, { pli: '', main });
  }

  await updateGameTimestamp(gameId);
  return getGameRows(gameId);
}

async function collectTrick({ gameId }) {
  const { data: rows, error } = await getGameRows(gameId);
  if (error) {
    return { data: null, error };
  }

  const cardsOnTable = rows.filter((row) => row.pli && row.pli.includes('1'));
  if (cardsOnTable.length < 4) {
    return { data: rows, error: null };
  }

  const winnerRow = rows.find((row) => row.resultat === 'gagnant');
  if (!winnerRow) {
    return { data: null, error: { message: 'no_trick_winner' } };
  }

  const miseRow = rows.find((row) => row.mise);
  const atout = miseRow ? getBidParts(miseRow.mise).atout : '';

  let trickPoints = 0;
  cardsOnTable.forEach((row) => {
    const cardIndex = row.pli.indexOf('1');
    trickPoints += scoreCard(cardIndex, atout);
  });
  const isLastTrick = rows.every((row) => row.main === DEFAULT_HAND);
  if (isLastTrick) {
    trickPoints += 10;
  }

  const winnerRowPoints = (winnerRow.points || 0) + trickPoints;
  await updateRow(winnerRow.id, { points: winnerRowPoints });

  if (isLastTrick) {
    const miseRow = rows.find((row) => row.mise);
    const contractValue = miseRow ? parseBidValue(miseRow.mise.split(' ')[0] || '') : 0;
    if (contractValue > 0 && miseRow) {
      const team1Seats = [1, 3];
      const team2Seats = [2, 4];
      const team1Points = rows.reduce((sum, row) => {
        if (!team1Seats.includes(row.seat)) return sum;
        if (row.id === winnerRow.id) return sum + winnerRowPoints;
        return sum + (row.points || 0);
      }, 0);
      const team2Points = rows.reduce((sum, row) => {
        if (!team2Seats.includes(row.seat)) return sum;
        if (row.id === winnerRow.id) return sum + winnerRowPoints;
        return sum + (row.points || 0);
      }, 0);

      const attackTeamIsTeam1 = miseRow.seat % 2 === 1;
      const attackPoints = attackTeamIsTeam1 ? team1Points : team2Points;
      const attackBelote = rows.some(
        (row) => (row.belote || 0) > 0 && (attackTeamIsTeam1 ? team1Seats : team2Seats).includes(row.seat)
      );
      const attackPointsSansBelote = attackPoints - (attackBelote ? 20 : 0);
      const attackWins =
        attackPointsSansBelote >= 82 &&
        attackPoints >= contractValue;

      const targetSeats = attackWins ? (attackTeamIsTeam1 ? team1Seats : team2Seats) : attackTeamIsTeam1 ? team2Seats : team1Seats;
      const targetSeat = targetSeats[0];
      const targetRow = rows.find((row) => row.seat === targetSeat);
      if (targetRow) {
        const gain = attackWins ? contractValue : 160;
        await updateRow(targetRow.id, { partie: (targetRow.partie || 0) + gain });
      }
    }
  }

  await updateAllRows(gameId, { pli: '', resultat: '', dernier: '' });
  await updateAllRows(gameId, { tour: '' });
  await updateRow(winnerRow.id, { tour: 'tour' });

  const refreshed = await getGameRows(gameId);
  if (refreshed.error) {
    return refreshed;
  }

  await autoPlayLastTrick(gameId, refreshed.data);
  return getGameRows(gameId);
}

async function finishDebrief({ gameId }) {
  const { data: rows, error } = await getGameRows(gameId);
  if (error) {
    return { data: null, error };
  }

  const team1 = rows.filter((row) => row.seat === 1 || row.seat === 3);
  const team2 = rows.filter((row) => row.seat === 2 || row.seat === 4);
  const total1 = team1.reduce((sum, row) => sum + (row.debrief || 0), 0);
  const total2 = team2.reduce((sum, row) => sum + (row.debrief || 0), 0);

  const resetPayload = {
    points: 0,
    mise: '',
    pli: '',
    debrief: 0,
    belote: 0,
    atout_restant: '',
    entames: '',
    dernier_pli_rang: null,
    dernier_pli_carte: ''
  };

  await Promise.all(rows.map((row) => updateRow(row.id, resetPayload)));
  await updateGameTimestamp(gameId);

  return { data: { team1: total1, team2: total2 }, error: null };
}

async function toggleHints({ gameId, userId, enabled }) {
  const { data: rows, error } = await getGameRows(gameId);
  if (error) {
    return { data: null, error };
  }

  const row = rows.find((item) => item.player_id === userId);
  if (!row) {
    return { data: null, error: { message: 'not_in_game' } };
  }

  const value = enabled ? '' : 'desactive';
  await updateRow(row.id, { proposition: value });
  await updateGameTimestamp(gameId);
  return getGameRows(gameId);
}

function notImplemented() {
  return { data: null, error: { message: 'not_implemented' } };
}

module.exports = {
  createGame,
  listGames,
  getGameRows,
  getGameState,
  joinSeat,
  addRobot,
  leaveGame,
  deleteGame,
  bid,
  cancelBids,
  playCard,
  undoLast,
  collectTrick,
  cancelTrick,
  finishDebrief,
  toggleHints,
  dealNewHand,
  aiDecision: notImplemented
};
