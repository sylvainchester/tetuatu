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

const CARD_CODES = [
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'q',
  'r',
  's',
  't',
  'u',
  'v',
  'w',
  'x',
  'y',
  'z',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7'
];

const SUITS = ['pique', 'carreau', 'trefle', 'coeur'];

const ATTOUT_RANK = {
  0: 0,
  1: 1,
  2: 6,
  3: 4,
  4: 7,
  5: 2,
  6: 3,
  7: 5
};

const COLOR_RANK = {
  0: 0,
  1: 1,
  2: 2,
  3: 6,
  4: 3,
  5: 4,
  6: 5,
  7: 7
};

const ATTOUT_POINTS = [0, 0, 14, 10, 20, 3, 4, 11];
const COLOR_POINTS = [0, 0, 0, 10, 2, 3, 4, 11];
const SANZAT_POINTS = [0, 0, 0, 10, 2, 3, 4, 11];

function getCardIndexByName(name) {
  return CARD_NAMES.indexOf(name);
}

function buildCardMask(cardIndex) {
  if (cardIndex < 0) {
    return null;
  }
  return CARD_NAMES.map((_item, idx) => (idx === cardIndex ? '1' : '0')).join('');
}

function getSuitFromIndex(cardIndex) {
  if (cardIndex < 0) {
    return null;
  }
  const suitIndex = Math.floor(cardIndex / 8);
  return SUITS[suitIndex];
}

function getValueIndex(cardIndex) {
  return cardIndex % 8;
}

function normalizeAtout(atout, leaderSuit) {
  if (atout === 'sanzate') {
    return null;
  }
  if (atout === 'toutate') {
    return 'toutate';
  }
  return atout || leaderSuit;
}

function scoreCard(cardIndex, atout) {
  const value = getValueIndex(cardIndex);
  const suit = getSuitFromIndex(cardIndex);
  if (atout === 'sanzate') {
    return SANZAT_POINTS[value];
  }
  if (atout === 'toutate') {
    return ATTOUT_POINTS[value];
  }
  if (!atout) {
    return COLOR_POINTS[value];
  }
  if (suit === atout) {
    return ATTOUT_POINTS[value];
  }
  return COLOR_POINTS[value];
}

function compareCards(cardA, cardB, leaderSuit, atout) {
  const suitA = getSuitFromIndex(cardA.cardIndex);
  const suitB = getSuitFromIndex(cardB.cardIndex);
  const valueA = getValueIndex(cardA.cardIndex);
  const valueB = getValueIndex(cardB.cardIndex);

  if (atout) {
    const aIsAtout = suitA === atout;
    const bIsAtout = suitB === atout;
    if (aIsAtout && !bIsAtout) return 1;
    if (!aIsAtout && bIsAtout) return -1;
    if (aIsAtout && bIsAtout) {
      return ATTOUT_RANK[valueA] - ATTOUT_RANK[valueB];
    }
  }

  if (suitA === suitB) {
    return COLOR_RANK[valueA] - COLOR_RANK[valueB];
  }

  if (suitA === leaderSuit && suitB !== leaderSuit) return 1;
  if (suitB === leaderSuit && suitA !== leaderSuit) return -1;

  return 0;
}

function pickTrickWinner(cardsInOrder, atout) {
  const leaderSuit = getSuitFromIndex(cardsInOrder[0].cardIndex);
  const normalizedAtout = normalizeAtout(atout, leaderSuit);

  let winner = cardsInOrder[0];
  for (let i = 1; i < cardsInOrder.length; i += 1) {
    const candidate = cardsInOrder[i];
    const comparison = compareCards(candidate, winner, leaderSuit, normalizedAtout);
    if (comparison > 0) {
      winner = candidate;
    }
  }

  return { winner, leaderSuit, normalizedAtout };
}

function bitStringHasCard(bitString, cardIndex) {
  return bitString?.[cardIndex] === '1';
}

function removeCardFromHand(bitString, cardIndex) {
  if (!bitString) return bitString;
  return `${bitString.slice(0, cardIndex)}0${bitString.slice(cardIndex + 1)}`;
}

function addCardToHand(bitString, cardIndex) {
  if (!bitString) return bitString;
  return `${bitString.slice(0, cardIndex)}1${bitString.slice(cardIndex + 1)}`;
}

module.exports = {
  CARD_NAMES,
  CARD_CODES,
  getCardIndexByName,
  buildCardMask,
  getSuitFromIndex,
  getValueIndex,
  normalizeAtout,
  scoreCard,
  pickTrickWinner,
  bitStringHasCard,
  removeCardFromHand,
  addCardToHand
};
