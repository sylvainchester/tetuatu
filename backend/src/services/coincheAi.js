const { CARD_NAMES } = require('./coincheRules');

const DEFAULT_BIDS = ',,';

const valeur_encheres = {
  1: 80,
  2: 90,
  3: 100,
  4: 110,
  5: 120,
  6: 130,
  7: 140,
  8: 150,
  9: 250
};

const couleur = {
  1: 'pique',
  2: 'carreau',
  3: 'trefle',
  4: 'coeur',
  5: 'toutate',
  6: 'sanzate'
};

const couleur_inverse = {
  pique: 1,
  carreau: 2,
  trefle: 3,
  coeur: 4,
  toutate: 5,
  sanzate: 6
};

const as_couleur = {
  1: { 1: 15, 2: 23, 3: 31 },
  2: { 1: 7, 2: 23, 3: 31 },
  3: { 1: 7, 2: 15, 3: 31 },
  4: { 1: 7, 2: 15, 3: 23 }
};

const longe = {
  5: { 1: 4, 2: 2, 3: 7, 4: 3, 5: 6, 6: 5, 7: 1, 8: 0 },
  6: { 1: 7, 2: 3, 3: 6, 4: 5, 5: 4, 6: 2, 7: 1, 8: 0 }
};

const force_couleur = [1, 2, 3, 7, 4, 5, 6, 8];
const force_atout = [1, 2, 7, 5, 8, 3, 4, 6];

function bitAt(bitstring, index) {
  return bitstring && bitstring[index] === '1';
}

function getRowBySeat(rows, seat) {
  return rows.find((row) => row.seat === seat);
}

function parseBidValue(value) {
  if (!value || value === 'passe') return 0;
  if (value === 'capot') return 250;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseBidParts(value) {
  if (!value) return { contrat: '', atout: '' };
  const parts = value.trim().split(' ');
  return { contrat: parts[0], atout: parts[1] || '' };
}

function getBidHistoryFromStory(rows, storyText) {
  const totalBids = rows.reduce((sum, row) => {
    const bids = (row.encheres || DEFAULT_BIDS).split(',').filter(Boolean);
    return sum + bids.length;
  }, 0);
  if (!storyText || totalBids === 0) return [];

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

function buildState(rows) {
  const main = Array(5).fill('');
  const pli = Array(5).fill('');
  const encheres = Array(5).fill('');
  const joueur = Array(5).fill('');
  const atout_restant = Array(5).fill('');
  const sequence = Array(5).fill(0);
  const pli_sequence = {};
  const pli_sequence_joueur = {};

  let mise = '';
  let rang_mise = 0;
  let rang_premiere_prise = 0;
  let rang_belote = 0;
  let nb_pli = 0;
  let rang_robot = 0;
  let nom_robot = '';
  let rang_commence = 0;

  rows.forEach((row) => {
    const seat = row.seat;
    if (row.mise) {
      mise = row.mise;
      rang_mise = seat;
      rang_premiere_prise = seat;
    }
    if (row.belote) {
      rang_belote = seat;
    }
    main[seat] = row.main || '';
    pli[seat] = row.pli || '';
    if (row.pli) {
      nb_pli += 1;
      sequence[seat] = Number(row.dernier || 0);
      pli_sequence[sequence[seat]] = pli[seat];
      pli_sequence_joueur[sequence[seat]] = seat;
    }
    encheres[seat] = row.encheres || DEFAULT_BIDS;
    joueur[seat] = row.player_name || String(seat);
    atout_restant[seat] = row.atout_restant || '';
    if (row.tour === 'tour') {
      rang_robot = seat;
      nom_robot = row.player_name || String(seat);
    }
    if (row.tas) {
      rang_commence = seat;
    }
  });

  return {
    rows,
    main,
    pli,
    encheres,
    joueur,
    atout_restant,
    sequence,
    pli_sequence,
    pli_sequence_joueur,
    mise,
    rang_mise,
    rang_premiere_prise,
    rang_belote,
    nb_pli,
    rang_robot,
    nom_robot,
    rang_commence
  };
}

function decideBidding(state) {
  const {
    main,
    pli,
    encheres,
    joueur,
    atout_restant,
    mise,
    nb_pli,
    rang_robot,
    rang_commence,
    rang_belote,
    rang_mise,
    rang_premiere_prise
  } = state;

  const jeu = [];
  for (let j = 0; j <= 31; j += 1) {
    jeu[j] = bitAt(main[rang_robot], j) ? 1 : 0;
  }

  const enchere_par_couleur = Array.from({ length: 5 }, () => Array(7).fill(0));
  const sequence_enchere_joueur = {};
  const sequence_enchere_couleur = {};
  const encheres_joueur = Array.from({ length: 5 }, () => []);
  let contrat_mini = 0;

  for (let i = 1; i <= 4; i += 1) {
    const encheres_generique = (encheres[i] || DEFAULT_BIDS).split(',');
    for (let k = 0; k <= encheres_generique.length - 1; k += 1) {
      const value = encheres_generique[k];
      encheres_joueur[i][k] = value;
      if (value && value !== 'passe') {
        let contrat_intermediaire = value.split(' ')[0];
        if (contrat_intermediaire === 'capot') contrat_intermediaire = 250;
        const mise_reste = value.includes(' ') ? value.slice(value.indexOf(' ') + 1) : '';
        const atout = mise_reste.includes(' ') ? mise_reste.split(' ')[0] : mise_reste;
        let c = 1;
        while (couleur[c] !== atout && c <= 6) c += 1;
        enchere_par_couleur[i][c] = Number(contrat_intermediaire);
        if (Number(contrat_intermediaire) > contrat_mini) {
          contrat_mini = Number(contrat_intermediaire);
        }
        sequence_enchere_joueur[contrat_intermediaire] = i;
        sequence_enchere_couleur[contrat_intermediaire] = atout;
      }
    }
  }

  let mise_en_cours = 'non';
  if (contrat_mini === 0) {
    contrat_mini = 70;
  } else {
    const rang_adversaire_precedent = rang_robot === 1 ? 4 : rang_robot - 1;
    const rang_adversaire_suivant = rang_robot === 4 ? 1 : rang_robot + 1;
    if (sequence_enchere_joueur[contrat_mini] === rang_adversaire_precedent ||
        sequence_enchere_joueur[contrat_mini] === rang_adversaire_suivant) {
      mise_en_cours = 'adversaire';
    } else {
      mise_en_cours = 'moi';
    }
  }

  const nombre_as = {};
  const nombre_atout = {};
  const nombre_cartes_maitre = {};
  const nombre_cartes_longe = {};
  const nombre_cartes_longe_couleur = {};
  let nombre_impasse = 0;

  for (let c = 1; c <= 6; c += 1) {
    if (c <= 4) {
      nombre_as[c] = 0;
      for (let j = 1; j <= 3; j += 1) {
        if (jeu[as_couleur[c][j]] === 1) nombre_as[c] += 1;
      }
      nombre_atout[c] = 0;
      for (let a = 0; a <= 7; a += 1) {
        if (jeu[a + 8 * (c - 1)] === 1) nombre_atout[c] += 1;
      }
      if (nombre_atout[c] === 0) {
        nombre_impasse += 1;
      }
    } else {
      nombre_cartes_maitre[c] = 0;
      nombre_cartes_longe[c] = 0;
      nombre_cartes_longe_couleur[c] = {};
      for (let k = 1; k <= 4; k += 1) {
        nombre_cartes_longe_couleur[c][k] = 0;
        if (jeu[longe[c][1] + 8 * (k - 1)] === 1) {
          nombre_cartes_maitre[c] += 1;
          let longe_active = 'oui';
          nombre_cartes_longe_couleur[c][k] = 1;
          for (let l = 2; l <= 8; l += 1) {
            if (jeu[longe[c][l] + 8 * (k - 1)] === 1 && longe_active === 'oui') {
              nombre_cartes_longe_couleur[c][k] += 1;
            } else {
              longe_active = 'non';
            }
          }
        }
        nombre_cartes_longe[c] += nombre_cartes_longe_couleur[c][k];
      }
    }
  }

  const poids = {};
  let poids_maxi = 0;
  let rang_poids_maxi = 0;

  const rang_partenaire = rang_robot === 1 ? 3 : rang_robot === 2 ? 4 : rang_robot === 3 ? 1 : 2;
  const rang_adversaire_suivant = rang_robot === 4 ? 1 : rang_robot + 1;
  const rang_adversaire_precedent = rang_robot === 1 ? 4 : rang_robot - 1;

  for (let c = 1; c <= 6; c += 1) {
    poids[c] = 0;
    if (contrat_mini === 70) {
      if (c <= 4) {
        if (jeu[4 + 8 * (c - 1)] === 1 && jeu[2 + 8 * (c - 1)] === 0 && nombre_atout[c] === 3) {
          poids[c] = 10;
          poids[c] += nombre_as[c] > 0 ? nombre_as[c] : 0;
          if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 2;
        }
        if (jeu[4 + 8 * (c - 1)] === 1 && jeu[2 + 8 * (c - 1)] === 0 && nombre_atout[c] > 3) {
          poids[c] = 10;
          poids[c] += nombre_as[c] > 0 ? nombre_as[c] : 0;
          if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 2;
        }
        if (jeu[4 + 8 * (c - 1)] === 1 && jeu[2 + 8 * (c - 1)] === 0 && nombre_atout[c] > 4 && nombre_as[c] > 0) {
          poids[c] = 20;
          if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 10;
          poids[c] += nombre_as[c] > 0 ? nombre_as[c] : 0;
        }
        if (jeu[4 + 8 * (c - 1)] === 0 && jeu[2 + 8 * (c - 1)] === 1 && jeu[7 + 8 * (c - 1)] === 1 && nombre_atout[c] === 3) {
          if (nombre_as[c] > 0) {
            poids[c] = 10 + nombre_as[c];
            if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 2;
          }
        }
        if (jeu[4 + 8 * (c - 1)] === 0 && jeu[2 + 8 * (c - 1)] === 1 && nombre_atout[c] > 3) {
          if (nombre_as[c] > 0) {
            poids[c] = 10 + nombre_as[c];
            if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 2;
          }
        }
        if (jeu[4 + 8 * (c - 1)] === 1 && jeu[2 + 8 * (c - 1)] === 1 && nombre_atout[c] > 2) {
          poids[c] = 20;
          poids[c] += nombre_as[c] > 0 ? 10 * nombre_as[c] : 0;
          if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 10;
        }
        if (jeu[4 + 8 * (c - 1)] === 1 && jeu[2 + 8 * (c - 1)] === 1 && nombre_atout[c] === 2 && nombre_as[c] > 1) {
          poids[c] = 20;
        }
      } else {
        if (nombre_cartes_maitre[c] === 4) {
          if (nombre_cartes_longe[c] === 8) poids[c] = 80;
          if (nombre_cartes_longe[c] === 7) poids[c] = 50;
          if (nombre_cartes_longe[c] === 6) poids[c] = 40;
          if (nombre_cartes_longe[c] === 5) poids[c] = 30;
          if (nombre_cartes_longe[c] < 5) poids[c] = 20;
        }
        if (nombre_cartes_maitre[c] === 3 && rang_commence === rang_robot) {
          if (nombre_cartes_longe[c] === 8) poids[c] = 80;
          if (nombre_cartes_longe[c] === 7) poids[c] = 40;
          if (nombre_cartes_longe[c] === 6) poids[c] = 30;
          if (nombre_cartes_longe[c] === 5) poids[c] = 20;
          if (nombre_cartes_longe[c] < 5) poids[c] = 10;
        }
        if (nombre_cartes_maitre[c] === 2 && rang_commence === rang_robot) {
          if (nombre_cartes_longe[c] === 8) poids[c] = 80;
          if (nombre_cartes_longe[c] === 7) poids[c] = 40;
          if (nombre_cartes_longe[c] === 6) poids[c] = 20;
          if (nombre_cartes_longe[c] === 5) poids[c] = 10;
        }
      }
    }

    if (contrat_mini >= 80) {
      if (sequence_enchere_joueur[contrat_mini] === rang_partenaire) {
        const couleur_du_partenaire = Object.keys(enchere_par_couleur[rang_partenaire]).reduce((best, key) => {
          const value = enchere_par_couleur[rang_partenaire][key];
          if (value > enchere_par_couleur[rang_partenaire][best]) return Number(key);
          return Number(best);
        }, 1);
        if (Number(couleur_du_partenaire) === c) {
          if (c <= 4) {
            if (nombre_as[c] > 0) poids[c] += 10 * nombre_as[c];
            if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 10;
          } else if (nombre_cartes_maitre[c] > 0) {
            if (Math.max(...enchere_par_couleur[rang_robot].slice(1)) > 80) {
              if (c === 5) {
                poids[c] = 10 * (nombre_cartes_maitre[c] - 1);
              } else {
                poids[c] = 10 * nombre_cartes_maitre[c];
              }
            } else {
              poids[c] += 10 * nombre_cartes_maitre[c];
            }
          }
        } else if (c <= 4) {
          if (jeu[2 + 8 * (c - 1)] === 1 && jeu[4 + 8 * (c - 1)] === 1 && nombre_atout[c] > 3 && nombre_as[c] > 1) {
            poids[c] = 10;
            if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 10;
          }
          if (jeu[2 + 8 * (c - 1)] === 0 && jeu[4 + 8 * (c - 1)] === 1 && nombre_atout[c] > 4 && nombre_as[c] > 0) {
            poids[c] = 10;
            if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 10;
          }
        } else if (c === 5 && couleur_du_partenaire <= 4 && enchere_par_couleur[rang_robot][couleur_du_partenaire] === 0) {
          nombre_cartes_longe[c] += 2;
          if (nombre_cartes_maitre[c] === 3 && nombre_atout[couleur_du_partenaire] > 0) {
            poids[c] = 20;
          } else if (nombre_cartes_maitre[c] > 1 && nombre_cartes_longe[c] > 4 && (rang_commence === rang_partenaire || (rang_commence === rang_robot && nombre_atout[couleur_du_partenaire] > 0))) {
            poids[c] = 10;
          }
        }
      }
    }

    if (sequence_enchere_joueur[80] > 0) {
      if (sequence_enchere_joueur[80] === rang_partenaire && sequence_enchere_couleur[80] === couleur[c]) {
        if (enchere_par_couleur[rang_robot][c] > 80) {
          poids[c] = 0;
        } else if (c <= 4) {
          if (jeu[4 + 8 * (c - 1)] === 1) {
            poids[c] = 10;
            if (nombre_as[c] > 0) poids[c] += nombre_as[c] * 10;
            if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 10;
          }
          if (jeu[2 + 8 * (c - 1)] === 1 && nombre_atout[c] > 1) {
            poids[c] = 10;
            if (nombre_as[c] > 0) poids[c] += nombre_as[c] * 10;
            if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 10;
          }
        } else {
          poids[c] = 10 * nombre_cartes_maitre[c];
        }
      }

      if (sequence_enchere_joueur[80] === rang_robot && sequence_enchere_couleur[80] === couleur[c]) {
        if (enchere_par_couleur[rang_partenaire][c] > 80 && enchere_par_couleur[rang_robot][c] === 80) {
          if (c <= 4) {
            if (nombre_as[c] > 0 && (nombre_atout[c] > 3 || nombre_impasse > 0)) {
              poids[c] = 10 * nombre_as[c];
            }
            if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) {
              poids[c] += 10;
            }
          }
        }
      }

      if (sequence_enchere_joueur[80] === rang_robot && sequence_enchere_couleur[80] !== couleur[c]) {
        if (enchere_par_couleur[rang_partenaire][c] > 80) {
          if (enchere_par_couleur[rang_robot][c] > 80) {
            poids[c] = 0;
          } else if (c <= 4) {
            if (nombre_as[c] > 0) poids[c] += 10 * nombre_as[c];
            if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 10;
          } else {
            poids[c] = 10 * nombre_cartes_maitre[c];
          }
        }
      }

      if (sequence_enchere_joueur[80] === rang_robot && sequence_enchere_couleur[80] === couleur[c]) {
        if (Math.max(...enchere_par_couleur[rang_partenaire].slice(1)) > 0 && enchere_par_couleur[rang_partenaire][c] === 0) {
          if (enchere_par_couleur[rang_robot][c] > 80) {
            poids[c] = 0;
          } else if (c <= 4) {
            if (nombre_as[c] > 1 && nombre_atout[c] > 3) {
              poids[c] += 10 * nombre_as[c];
            }
            if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 10;
          } else {
            const lastBid = encheres_joueur[rang_partenaire][encheres_joueur[rang_partenaire].length - 2] || '';
            const parts = lastBid.split(' ');
            const couleur_partenaire = parts[1];
            if (c === 5 && nombre_atout[couleur_inverse[couleur_partenaire]] > 0 && couleur_inverse[couleur_partenaire] <= 4) {
              poids[c] = 10;
            }
          }
        }
      }

      for (let e = 0; e <= 7; e += 10) {
        const bidValue = 80 + 10 * e;
        if (
          sequence_enchere_couleur[bidValue] === couleur[c] &&
          (sequence_enchere_joueur[bidValue] === rang_adversaire_precedent ||
            sequence_enchere_joueur[bidValue] === rang_adversaire_suivant)
        ) {
          poids[c] = 0;
        }
      }

      if (
        sequence_enchere_couleur[80] !== couleur[c] &&
        (sequence_enchere_joueur[80] === rang_adversaire_precedent || sequence_enchere_joueur[80] === rang_adversaire_suivant)
      ) {
        if (sequence_enchere_joueur[90] > 0) {
          if (enchere_par_couleur[rang_partenaire][c] > 0) {
            if (enchere_par_couleur[rang_robot][c] > 80) {
              poids[c] = 0;
            } else if (c <= 4) {
              if (jeu[4 + 8 * (c - 1)] === 1) {
                poids[c] = 10;
                if (nombre_as[c] > 0) poids[c] += 10 * nombre_as[c];
                if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 10;
              }
              if (jeu[2 + 8 * (c - 1)] === 1 && nombre_atout[c] > 1) {
                poids[c] = 10;
                if (nombre_as[c] > 0) poids[c] += 10 * nombre_as[c];
                if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 10;
              }
              if (jeu[2 + 8 * (c - 1)] === 0 && jeu[4 + 8 * (c - 1)] === 0) {
                poids[c] = 0;
                if (nombre_as[c] > 0 && contrat_mini <= 100) poids[c] += 10 * nombre_as[c];
                if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 10;
              }
            } else {
              poids[c] = 10 * nombre_cartes_maitre[c];
            }
          }

          if (c <= 4 && sequence_enchere_joueur[90] === rang_robot && sequence_enchere_couleur[90] === couleur[c]) {
            if (enchere_par_couleur[rang_partenaire][c] > 90 && enchere_par_couleur[rang_robot][c] < enchere_par_couleur[rang_partenaire][c]) {
              if (jeu[2 + 8 * (c - 1)] === 0 || jeu[4 + 8 * (c - 1)] === 0) {
                if (nombre_as[c] > 2) poids[c] += 10;
                if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 10;
              }
            }
          }
        }
      }

      if (contrat_mini <= 80) {
        if (
          (sequence_enchere_joueur[80] === rang_adversaire_precedent || sequence_enchere_joueur[80] === rang_adversaire_suivant) &&
          sequence_enchere_couleur[80] !== couleur[c]
        ) {
          if (c <= 4) {
            if (jeu[4 + 8 * (c - 1)] === 1 && jeu[2 + 8 * (c - 1)] === 0 && nombre_atout[c] > 2 && contrat_mini <= 80) {
              if (nombre_as[c] > 0) poids[c] = 10;
            }
            if (jeu[4 + 8 * (c - 1)] === 0 && jeu[2 + 8 * (c - 1)] === 1 && nombre_atout[c] > 3) {
              if (nombre_as[c] > 0) poids[c] = 10;
            }
            if (jeu[4 + 8 * (c - 1)] === 1 && jeu[2 + 8 * (c - 1)] === 1 && nombre_atout[c] > 2) {
              poids[c] = 10;
              if (nombre_as[c] > 0) poids[c] += 10 * nombre_as[c];
              if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 10;
            }
          } else if (nombre_cartes_maitre[c] === 4) {
            if (nombre_cartes_longe[c] === 8) poids[c] = 70;
            if (nombre_cartes_longe[c] === 7) poids[c] = 40;
            if (nombre_cartes_longe[c] === 6) poids[c] = 30;
            if (nombre_cartes_longe[c] === 5) poids[c] = 20;
            if (nombre_cartes_longe[c] < 5) poids[c] = 10;
          }
        }
      }
    }

    if (contrat_mini > 80) {
      if (enchere_par_couleur[rang_robot][c] > 80) {
        poids[c] += 0;
      } else if (Math.max(...enchere_par_couleur[rang_partenaire].slice(1)) < 90) {
        if (c <= 4) {
          if (jeu[2 + 8 * (c - 1)] === 1 && jeu[4 + 8 * (c - 1)] === 1 && nombre_atout[c] > 3 && nombre_as[c] > 0) {
            poids[c] = 10;
            if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 10;
          }
          if (jeu[2 + 8 * (c - 1)] === 0 && jeu[4 + 8 * (c - 1)] === 1 && nombre_atout[c] > 4 && nombre_as[c] > 0) {
            poids[c] = 10;
            if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 10;
          }
          if (jeu[2 + 8 * (c - 1)] === 0 && jeu[4 + 8 * (c - 1)] === 1 && nombre_atout[c] > 3 && jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) {
            if (contrat_mini < 110) {
              poids[c] = 10;
            } else if (nombre_as[c] > 1) {
              poids[c] = 10;
            }
          }
        } else if (nombre_cartes_maitre[c] === 4) {
          if (nombre_cartes_longe[c] === 8) poids[c] = 60;
          if (nombre_cartes_longe[c] === 7) poids[c] = 40;
          if (nombre_cartes_longe[c] === 6) poids[c] = 30;
          if (nombre_cartes_longe[c] === 5) poids[c] = 20;
          if (nombre_cartes_longe[c] === 4) poids[c] = 10;
        }
      } else {
        const couleur_du_partenaire = Object.keys(enchere_par_couleur[rang_partenaire]).reduce((best, key) => {
          const value = enchere_par_couleur[rang_partenaire][key];
          if (value > enchere_par_couleur[rang_partenaire][best]) return Number(key);
          return Number(best);
        }, 1);
        if (Number(couleur_du_partenaire) === c) {
          poids[c] = 0;
          if (c <= 4) {
            if (nombre_as[c] > 0) poids[c] += 10 * nombre_as[c];
            if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 10;
            if (jeu[2 + 8 * (c - 1)] === 1 || jeu[4 + 8 * (c - 1)] === 1) poids[c] += 10;
          } else if (nombre_cartes_maitre[c] > 0) {
            if (Math.max(...enchere_par_couleur[rang_robot].slice(1)) > 80) {
              if (c === 5) poids[c] = 10 * (nombre_cartes_maitre[c] - 1);
              else poids[c] = 10 * nombre_cartes_maitre[c];
            } else {
              poids[c] += 10 * nombre_cartes_maitre[c];
            }
          }
        } else if (c <= 4) {
          if (jeu[2 + 8 * (c - 1)] === 1 && jeu[4 + 8 * (c - 1)] === 1 && nombre_atout[c] > 3 && nombre_as[c] > 1) {
            poids[c] = 10;
            if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 10;
          }
          if (jeu[2 + 8 * (c - 1)] === 0 && jeu[4 + 8 * (c - 1)] === 1 && nombre_atout[c] > 4 && nombre_as[c] > 0) {
            poids[c] = 10;
            if (jeu[5 + 8 * (c - 1)] === 1 && jeu[6 + 8 * (c - 1)] === 1) poids[c] += 10;
          }
        } else if (c === 5 && couleur_du_partenaire <= 4 && enchere_par_couleur[rang_robot][couleur_du_partenaire] === 0) {
          nombre_cartes_longe[c] += 2;
          if (nombre_cartes_maitre[c] === 3 && nombre_atout[couleur_du_partenaire] > 0) {
            poids[c] = 20;
          } else if (nombre_cartes_maitre[c] > 1 && nombre_cartes_longe[c] > 4 && (rang_commence === rang_partenaire || (rang_commence === rang_robot && nombre_atout[couleur_du_partenaire] > 0))) {
            poids[c] = 10;
          }
        }
      }
    }

    if (poids[c] >= poids_maxi) {
      poids_maxi = poids[c];
      rang_poids_maxi = c;
    }
  }

  if (poids_maxi > 0) {
    if (poids_maxi > 10 && poids_maxi < 20) poids_maxi = 10;
    if (poids_maxi > 20 && poids_maxi < 30) poids_maxi = 20;
    if (poids_maxi > 30 && poids_maxi < 40) poids_maxi = 30;
    if (poids_maxi > 40 && poids_maxi < 50) poids_maxi = 40;
  }

  let bidValue = 'passe';
  let bidColor = 'no';
  let bidReason = '';
  if (poids_maxi === 0 || contrat_mini > 140) {
    bidValue = 'passe';
    bidColor = 'no';
    bidReason = `Passe (contrat_mini=${contrat_mini}, poids=${poids_maxi})`;
  } else {
    bidValue = String(contrat_mini + poids_maxi);
    bidColor = couleur[rang_poids_maxi];
    if (rang_poids_maxi <= 4) {
      const atouts = nombre_atout[rang_poids_maxi] || 0;
      const asHors = nombre_as[rang_poids_maxi] || 0;
      const hasBelote = jeu[5 + 8 * (rang_poids_maxi - 1)] === 1 && jeu[6 + 8 * (rang_poids_maxi - 1)] === 1;
      bidReason = `Atout ${bidColor}: atouts=${atouts}, as=${asHors}, belote=${hasBelote ? 1 : 0}, poids=${poids_maxi}, contrat_mini=${contrat_mini}`;
    } else {
      const maitres = nombre_cartes_maitre[rang_poids_maxi] || 0;
      const longeCount = nombre_cartes_longe[rang_poids_maxi] || 0;
      bidReason = `Atout ${bidColor}: maitres=${maitres}, longe=${longeCount}, poids=${poids_maxi}, contrat_mini=${contrat_mini}`;
    }
  }

  if (bidValue === 'passe') {
    return { type: 'bid', bid: { contrat: 'passe' }, proposition: 'passe', reason: bidReason };
  }
  return {
    type: 'bid',
    bid: { contrat: bidValue, atout: bidColor },
    proposition: `${bidValue} ${bidColor}`,
    reason: bidReason
  };
}

function decidePlay(state) {
  const {
    rows,
    main,
    pli,
    encheres,
    joueur,
    atout_restant,
    pli_sequence,
    pli_sequence_joueur,
    mise,
    nb_pli,
    rang_robot,
    rang_commence,
    rang_belote,
    rang_mise,
    rang_premiere_prise
  } = state;

  const jeu = [];
  for (let j = 0; j <= 31; j += 1) {
    jeu[j] = bitAt(main[rang_robot], j) ? 1 : 0;
  }

  const contrat = parseBidValue(mise.split(' ')[0] || '');
  const mise_reste = mise.includes(' ') ? mise.slice(mise.indexOf(' ') + 1) : '';
  const atout = mise_reste.includes(' ') ? mise_reste.split(' ')[0] : mise_reste;
  let couleur_atout = 0;
  if (atout === 'pique') couleur_atout = 1;
  if (atout === 'carreau') couleur_atout = 2;
  if (atout === 'trefle') couleur_atout = 3;
  if (atout === 'coeur') couleur_atout = 4;
  if (atout === 'toutate') couleur_atout = 5;
  if (atout === 'sanzate') couleur_atout = 6;

  const nb_cartes = {};
  const force_forte = {};
  const force_faible = {};
  const carte_faible = {};
  const carte_forte = {};

  for (let k = 1; k <= 4; k += 1) {
    nb_cartes[k] = 0;
    force_forte[k] = 0;
    force_faible[k] = 21;
    carte_faible[k] = -1;
    carte_forte[k] = -1;
    for (let c = 0; c <= 7; c += 1) {
      if (jeu[c + 8 * (k - 1)] === 1) {
        nb_cartes[k] += 1;
        if (couleur_atout <= 4) {
          if (k !== couleur_atout) {
            if (force_couleur[c] < force_faible[k]) {
              force_faible[k] = force_couleur[c];
              carte_faible[k] = c;
            }
            if (force_couleur[c] > force_forte[k]) {
              force_forte[k] = force_couleur[c];
              carte_forte[k] = c;
            }
          } else {
            if (force_atout[c] < force_faible[k]) {
              force_faible[k] = force_atout[c];
              carte_faible[k] = c;
            }
            if (force_atout[c] > force_forte[k]) {
              force_forte[k] = force_atout[c];
              carte_forte[k] = c;
            }
          }
        }
        if (couleur_atout === 6) {
          if (force_couleur[c] < force_faible[k]) {
            force_faible[k] = force_couleur[c];
            carte_faible[k] = c;
          }
          if (force_couleur[c] > force_forte[k]) {
            force_forte[k] = force_couleur[c];
            carte_forte[k] = c;
          }
        }
        if (couleur_atout === 5) {
          if (force_atout[c] < force_faible[k]) {
            force_faible[k] = force_atout[c];
            carte_faible[k] = c;
          }
          if (force_atout[c] > force_forte[k]) {
            force_forte[k] = force_atout[c];
            carte_forte[k] = c;
          }
        }
      }
    }
  }

  const rang_partenaire = rang_robot === 1 ? 3 : rang_robot === 2 ? 4 : rang_robot === 3 ? 1 : 2;
  const rang_adversaire_suivant = rang_robot === 4 ? 1 : rang_robot + 1;
  const rang_adversaire_precedent = rang_robot === 1 ? 4 : rang_robot - 1;

  const force_carte_non_tombee = {};
  const jailas = {};
  const lasesttombe = {};
  const jaile10 = {};
  const le10esttombe = {};

  for (let k = 1; k <= 4; k += 1) {
    force_carte_non_tombee[k] = -1;
    for (let c = 0; c <= 7; c += 1) {
      if (
        bitAt(main[rang_partenaire], c + 8 * (k - 1)) ||
        bitAt(main[rang_adversaire_precedent], c + 8 * (k - 1)) ||
        bitAt(main[rang_adversaire_suivant], c + 8 * (k - 1))
      ) {
        if (couleur_atout <= 4) {
          if (k === couleur_atout) {
            if (force_atout[c] > force_carte_non_tombee[k]) force_carte_non_tombee[k] = force_atout[c];
          } else if (force_couleur[c] > force_carte_non_tombee[k]) {
            force_carte_non_tombee[k] = force_couleur[c];
          }
        }
        if (couleur_atout === 5) {
          if (force_atout[c] > force_carte_non_tombee[k]) force_carte_non_tombee[k] = force_atout[c];
        }
        if (couleur_atout === 6) {
          if (force_couleur[c] > force_carte_non_tombee[k]) force_carte_non_tombee[k] = force_couleur[c];
        }
      }
    }
    jailas[k] = bitAt(main[rang_robot], 7 + 8 * (k - 1)) ? 'oui' : 'non';
    lasesttombe[k] =
      bitAt(main[rang_partenaire], 7 + 8 * (k - 1)) ||
      bitAt(main[rang_adversaire_precedent], 7 + 8 * (k - 1)) ||
      bitAt(main[rang_adversaire_suivant], 7 + 8 * (k - 1))
        ? 'non'
        : 'oui';
    jaile10[k] = bitAt(main[rang_robot], 3 + 8 * (k - 1)) ? 'oui' : 'non';
    le10esttombe[k] =
      bitAt(main[rang_partenaire], 7 + 8 * (k - 1)) ||
      bitAt(main[rang_adversaire_precedent], 7 + 8 * (k - 1)) ||
      bitAt(main[rang_adversaire_suivant], 7 + 8 * (k - 1))
        ? 'non'
        : 'oui';
  }

  let nb_atout_restant = 0;
  if (couleur_atout <= 4) {
    for (let c = 0; c <= 7; c += 1) {
      if (
        bitAt(main[1], c + 8 * (couleur_atout - 1)) ||
        bitAt(main[2], c + 8 * (couleur_atout - 1)) ||
        bitAt(main[3], c + 8 * (couleur_atout - 1)) ||
        bitAt(main[4], c + 8 * (couleur_atout - 1))
      ) {
        nb_atout_restant += 1;
      }
    }
  }

  const couleur_non_atout = [];
  let nb_couleur_non_atout = 0;
  for (let k = 1; k <= 4; k += 1) {
    if (k !== couleur_atout) {
      nb_couleur_non_atout += 1;
      couleur_non_atout[nb_couleur_non_atout] = k;
    }
  }
  if (couleur_atout <= 4) {
    couleur_non_atout[4] = couleur_atout;
  } else {
    couleur_non_atout[4] = 4;
  }

  let jeu_entame_carte_decision = 0;
  let pisse_faible_carte_decision = 0;
  let pisse_forte_carte_decision = 0;
  let force_entame_decision = 0;

  if (
    couleur_atout <= 4 &&
    nb_cartes[couleur_non_atout[1]] === 0 &&
    nb_cartes[couleur_non_atout[2]] === 0 &&
    nb_cartes[couleur_non_atout[3]] === 0
  ) {
    jeu_entame_carte_decision = carte_faible[couleur_atout] + 8 * (couleur_atout - 1);
    pisse_faible_carte_decision = carte_faible[couleur_atout] + 8 * (couleur_atout - 1);
    pisse_forte_carte_decision = carte_forte[couleur_atout] + 8 * (couleur_atout - 1);
  } else {
    const jeu_entame = Array(32).fill(0);
    for (let c = 0; c <= 31; c += 1) jeu_entame[c] = jeu[c];
    const jeu_entame_carte = {};
    const jeu_entame_force = {};

    if (couleur_atout <= 4) {
      for (let k = 1; k <= 3; k += 1) {
        jeu_entame_carte[k] = {};
        jeu_entame_force[k] = {};
        for (let c = 0; c <= nb_cartes[couleur_non_atout[k]] - 1; c += 1) {
          let valeur_entame_forte = 0;
          for (let d = 0; d <= 7; d += 1) {
            if (jeu_entame[d + 8 * (couleur_non_atout[k] - 1)] === 1) {
              if (force_couleur[d] > valeur_entame_forte) {
                valeur_entame_forte = force_couleur[d];
                jeu_entame_carte[k][c] = d;
                jeu_entame_force[k][c] = force_couleur[d];
              }
            }
          }
        }
        for (let c = 0; c <= nb_cartes[couleur_non_atout[k]] - 1; c += 1) {
          if (jeu_entame_force[k][0] < force_carte_non_tombee[couleur_non_atout[k]]) {
            jeu_entame_force[k][c] = -1 * jeu_entame_force[k][c];
          }
        }
      }
      if (nb_cartes[couleur_non_atout[1]] === 0) jeu_entame_force[1][0] = -50;
      if (nb_cartes[couleur_non_atout[2]] === 0) jeu_entame_force[2][0] = -50;
      if (nb_cartes[couleur_non_atout[3]] === 0) jeu_entame_force[3][0] = -50;

      force_entame_decision = 0;
      if (jeu_entame_force[1][0] > jeu_entame_force[2][0]) {
        if (jeu_entame_force[1][0] > jeu_entame_force[3][0]) {
          jeu_entame_carte_decision = jeu_entame_carte[1][0] + 8 * (couleur_non_atout[1] - 1);
          force_entame_decision = jeu_entame_force[1][0];
        } else {
          jeu_entame_carte_decision = jeu_entame_carte[3][0] + 8 * (couleur_non_atout[3] - 1);
          force_entame_decision = jeu_entame_force[3][0];
        }
      } else {
        if (jeu_entame_force[2][0] > jeu_entame_force[3][0]) {
          jeu_entame_carte_decision = jeu_entame_carte[2][0] + 8 * (couleur_non_atout[2] - 1);
          force_entame_decision = jeu_entame_force[2][0];
        } else {
          jeu_entame_carte_decision = jeu_entame_carte[3][0] + 8 * (couleur_non_atout[3] - 1);
          force_entame_decision = jeu_entame_force[3][0];
        }
      }
    }

    if (couleur_atout === 6 || couleur_atout === 5) {
      const maxColors = couleur_atout === 6 ? 4 : 4;
      for (let k = 1; k <= maxColors; k += 1) {
        jeu_entame_carte[k] = {};
        jeu_entame_force[k] = {};
        for (let c = 0; c <= nb_cartes[couleur_non_atout[k]] - 1; c += 1) {
          let valeur_entame_forte = 0;
          for (let d = 0; d <= 7; d += 1) {
            if (jeu_entame[d + 8 * (couleur_non_atout[k] - 1)] === 1) {
              const force = couleur_atout === 5 ? force_atout[d] : force_couleur[d];
              if (force > valeur_entame_forte) {
                valeur_entame_forte = force;
                jeu_entame_carte[k][c] = d;
                jeu_entame_force[k][c] = force;
              }
            }
          }
        }
        for (let c = 0; c <= nb_cartes[couleur_non_atout[k]] - 1; c += 1) {
          if (jeu_entame_force[k][0] < force_carte_non_tombee[couleur_non_atout[k]]) {
            jeu_entame_force[k][c] = -1 * jeu_entame_force[k][c];
          }
        }
      }
      if (nb_cartes[couleur_non_atout[1]] === 0) jeu_entame_force[1][0] = -50;
      if (nb_cartes[couleur_non_atout[2]] === 0) jeu_entame_force[2][0] = -50;
      if (nb_cartes[couleur_non_atout[3]] === 0) jeu_entame_force[3][0] = -50;
      if (nb_cartes[couleur_non_atout[4]] === 0) jeu_entame_force[4][0] = -50;

      const ranking = [
        jeu_entame_force[1][0],
        jeu_entame_force[2][0],
        jeu_entame_force[3][0],
        jeu_entame_force[4][0]
      ];
      const maxValue = Math.max(...ranking);
      const rank = ranking.indexOf(maxValue) + 1;
      jeu_entame_carte_decision = jeu_entame_carte[rank][0] + 8 * (couleur_non_atout[rank] - 1);
      force_entame_decision = jeu_entame_force[rank][0];
    }

    const jeu_fort = Array(32).fill(0);
    const jeu_faible = Array(32).fill(0);
    for (let c = 0; c <= 31; c += 1) {
      jeu_fort[c] = jeu[c];
      jeu_faible[c] = jeu[c];
    }

    const pisse_faible_carte = {};
    const pisse_faible_force = {};
    const pisse_forte_carte = {};
    const pisse_forte_force = {};

    for (let k = 1; k <= nb_couleur_non_atout; k += 1) {
      pisse_faible_carte[k] = {};
      pisse_faible_force[k] = {};
      pisse_forte_carte[k] = {};
      pisse_forte_force[k] = {};
      for (let c = 0; c <= nb_cartes[couleur_non_atout[k]] - 1; c += 1) {
        let valeur_pisse_faible = 21;
        for (let d = 0; d <= 7; d += 1) {
          if (jeu_faible[d + 8 * (couleur_non_atout[k] - 1)] === 1) {
            const force_carte = couleur_atout === 5 ? force_atout[d] : force_couleur[d];
            if (force_carte < valeur_pisse_faible) {
              valeur_pisse_faible = force_carte;
              pisse_faible_carte[k][c] = d;
              pisse_faible_force[k][c] = force_carte;
            }
          }
        }
        jeu_faible[pisse_faible_carte[k][c] + 8 * (couleur_non_atout[k] - 1)] = 0;
      }
      for (let c = 0; c <= nb_cartes[couleur_non_atout[k]] - 1; c += 1) {
        let valeur_pisse_forte = 0;
        for (let d = 0; d <= 7; d += 1) {
          if (jeu_fort[d + 8 * (couleur_non_atout[k] - 1)] === 1) {
            const force_carte = couleur_atout === 5 ? force_atout[d] : force_couleur[d];
            if (force_carte > valeur_pisse_forte) {
              valeur_pisse_forte = force_carte;
              pisse_forte_carte[k][c] = d;
              pisse_forte_force[k][c] = force_carte;
            }
          }
        }
        jeu_fort[pisse_forte_carte[k][c] + 8 * (couleur_non_atout[k] - 1)] = 0;
      }
    }

    for (let k = 1; k <= nb_couleur_non_atout; k += 1) {
      if (nb_cartes[couleur_non_atout[k]] === 2) {
        if (
          bitAt(main[rang_adversaire_precedent], 7 + 8 * (couleur_non_atout[k] - 1)) ||
          bitAt(main[rang_adversaire_suivant], 7 + 8 * (couleur_non_atout[k] - 1)) ||
          bitAt(main[rang_partenaire], 7 + 8 * (couleur_non_atout[k] - 1))
        ) {
          pisse_faible_force[k][0] = pisse_faible_force[k][nb_cartes[couleur_non_atout[k]] - 1];
        }
      }
      if (nb_cartes[couleur_non_atout[k]] > 0) {
        if (pisse_forte_force[k][0] === 8) {
          pisse_forte_force[k][0] = 0;
          if (nb_cartes[couleur_non_atout[k]] > 1) {
            pisse_forte_force[k][0] = pisse_forte_force[k][1];
            pisse_forte_carte[k][0] = pisse_forte_carte[k][1];
          }
        }
      }
    }

    const ranking_fort = [];
    const ranking_faible = [];
    for (let k = 1; k <= nb_couleur_non_atout; k += 1) {
      if (nb_cartes[couleur_non_atout[k]] === 0) {
        pisse_forte_force[k][0] = -1;
        pisse_faible_force[k][0] = 21;
      }
      if (k <= 4 || couleur_atout > 4) {
        ranking_fort[k - 1] = pisse_forte_force[k][0];
        ranking_faible[k - 1] = pisse_faible_force[k][0];
      }
    }

    const max_value = Math.max(...ranking_fort);
    const rank_fort = ranking_fort.indexOf(max_value);
    pisse_forte_carte_decision = pisse_forte_carte[rank_fort + 1][0] + 8 * (couleur_non_atout[rank_fort + 1] - 1);

    const min_value = Math.min(...ranking_faible);
    const rank_faible = ranking_faible.indexOf(min_value);
    pisse_faible_carte_decision = pisse_faible_carte[rank_faible + 1][0] + 8 * (couleur_non_atout[rank_faible + 1] - 1);
  }

  if (force_entame_decision < 0) {
    jeu_entame_carte_decision = pisse_faible_carte_decision;
  }

  let carte_a_jouer = 0;
  let attaque = 'non';
  if (rang_mise === rang_robot || rang_mise === rang_partenaire) attaque = 'oui';

  const force_pli = {};
  const couleur_pli = {};
  for (let p = 1; p <= nb_pli; p += 1) {
    const pliValue = pli_sequence[p];
    for (let c = 0; c <= 31; c += 1) {
      if (pliValue && pliValue[c] === '1') {
        if (c < 8) {
          couleur_pli[p] = 1;
          force_pli[p] = couleur_pli[p] === couleur_atout || couleur_atout === 5 ? force_atout[c] : force_couleur[c];
        }
        if (c < 16 && c > 7) {
          couleur_pli[p] = 2;
          force_pli[p] = couleur_pli[p] === couleur_atout || couleur_atout === 5 ? force_atout[c - 8] : force_couleur[c - 8];
        }
        if (c < 24 && c > 15) {
          couleur_pli[p] = 3;
          force_pli[p] = couleur_pli[p] === couleur_atout || couleur_atout === 5 ? force_atout[c - 16] : force_couleur[c - 16];
        }
        if (c < 32 && c > 23) {
          couleur_pli[p] = 4;
          force_pli[p] = couleur_pli[p] === couleur_atout || couleur_atout === 5 ? force_atout[c - 24] : force_couleur[c - 24];
        }
      }
    }
  }

  if (nb_pli === 0) {
    if (couleur_atout <= 4) {
      if (rang_premiere_prise === rang_robot || rang_premiere_prise === rang_partenaire) {
        if (nb_cartes[couleur_atout] > 0 && nb_atout_restant > nb_cartes[couleur_atout]) {
          if (
            atout_restant[rang_adversaire_precedent].includes(String(couleur_atout)) ||
            atout_restant[rang_adversaire_suivant].includes(String(couleur_atout))
          ) {
            if (
              nb_atout_restant === nb_cartes[couleur_atout] + 1 &&
              rang_belote === rang_partenaire &&
              ((bitAt(main[rang_partenaire], 5 + 8 * (couleur_atout - 1)) &&
                !bitAt(main[rang_partenaire], 6 + 8 * (couleur_atout - 1))) ||
                (!bitAt(main[rang_partenaire], 5 + 8 * (couleur_atout - 1)) &&
                  bitAt(main[rang_partenaire], 6 + 8 * (couleur_atout - 1))))
            ) {
              carte_a_jouer = jeu_entame_carte_decision;
            } else if (force_carte_non_tombee[couleur_atout] > force_forte[couleur_atout]) {
              if (force_forte[couleur_atout] < 7 && force_carte_non_tombee[couleur_atout] === 8) {
                if (
                  bitAt(main[rang_adversaire_suivant], 2 + 8 * (couleur_atout - 1)) ||
                  bitAt(main[rang_adversaire_precedent], 2 + 8 * (couleur_atout - 1)) ||
                  bitAt(main[rang_partenaire], 2 + 8 * (couleur_atout - 1))
                ) {
                  carte_a_jouer = carte_forte[couleur_atout] + 8 * (couleur_atout - 1);
                } else {
                  carte_a_jouer = carte_faible[couleur_atout] + 8 * (couleur_atout - 1);
                }
              } else {
                carte_a_jouer = carte_faible[couleur_atout] + 8 * (couleur_atout - 1);
              }
            } else {
              carte_a_jouer = carte_forte[couleur_atout] + 8 * (couleur_atout - 1);
            }
          } else {
            carte_a_jouer = jeu_entame_carte_decision;
          }
        } else {
          carte_a_jouer = jeu_entame_carte_decision;
        }
      } else {
        carte_a_jouer = jeu_entame_carte_decision;
      }
    } else {
      if (force_entame_decision > 0) {
        carte_a_jouer = jeu_entame_carte_decision;
      } else {
        carte_a_jouer = jeu_entame_carte_decision;
        const entames = getRowBySeat(rows, 1)?.entames || '';
        for (let k = 1; k <= 4; k += 1) {
          if (entames.includes(String(k))) {
            if (nb_cartes[k] > 0) {
              carte_a_jouer = carte_faible[k] + 8 * (k - 1);
            }
          }
        }
      }
    }
  }

  if (nb_pli > 0) {
    if (pli_sequence_joueur[1] === rang_partenaire) {
      if (couleur_atout <= 4) {
        if (couleur_pli[1] !== couleur_atout) {
          if (couleur_pli[2] === couleur_atout) {
            if (nb_cartes[couleur_pli[1]] > 0) {
              carte_a_jouer = carte_faible[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
            } else if (nb_cartes[couleur_atout] > 0) {
              if (force_forte[couleur_atout] < force_pli[2]) {
                carte_a_jouer = carte_faible[couleur_atout] + 8 * (couleur_atout - 1);
              } else if (attaque === 'non' || attaque === 'non') {
                if (force_carte_non_tombee[couleur_atout] > force_forte[couleur_atout]) {
                  if (atout_restant[rang_adversaire_suivant].includes(String(couleur_atout))) {
                    carte_a_jouer = carte_forte[couleur_atout] + 8 * (couleur_atout - 1);
                  } else {
                    let delta = 10;
                    for (let c = 0; c <= 7; c += 1) {
                      if (jeu[c + 8 * (couleur_atout - 1)] === 1) {
                        if ((force_atout[c] - force_pli[2]) < delta && (force_atout[c] - force_pli[2]) > 0) {
                          delta = force_atout[c] - force_pli[2];
                          carte_a_jouer = c + 8 * (couleur_atout - 1);
                        }
                      }
                    }
                  }
                } else {
                  carte_a_jouer = carte_forte[couleur_atout] + 8 * (couleur_atout - 1);
                }
              }
            } else {
              carte_a_jouer = pisse_faible_carte_decision;
            }
          } else {
            if (couleur_pli[2] !== couleur_pli[1]) force_pli[2] = -1;
            if (nb_cartes[couleur_pli[1]] > 0) {
              if (jeu[7 + 8 * (couleur_pli[1] - 1)] === 1) {
                carte_a_jouer = 7 + 8 * (couleur_pli[1] - 1);
              } else {
                if (force_pli[1] === 8) {
                  carte_a_jouer = carte_forte[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
                }
                if (force_pli[2] === 8) {
                  carte_a_jouer = carte_faible[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
                }
                if (
                  force_pli[2] !== 8 &&
                  force_pli[1] !== 8 &&
                  (bitAt(main[1], 7 + 8 * (couleur_pli[1] - 1)) ||
                    bitAt(main[2], 7 + 8 * (couleur_pli[1] - 1)) ||
                    bitAt(main[3], 7 + 8 * (couleur_pli[1] - 1)) ||
                    bitAt(main[4], 7 + 8 * (couleur_pli[1] - 1)))
                ) {
                  carte_a_jouer = carte_faible[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
                }
                if (
                  force_pli[2] !== 8 &&
                  force_pli[1] !== 8 &&
                  !bitAt(main[1], 7 + 8 * (couleur_pli[1] - 1)) &&
                  !bitAt(main[2], 7 + 8 * (couleur_pli[1] - 1)) &&
                  !bitAt(main[3], 7 + 8 * (couleur_pli[1] - 1)) &&
                  !bitAt(main[4], 7 + 8 * (couleur_pli[1] - 1))
                ) {
                  carte_a_jouer = carte_forte[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
                }
              }
            } else if (force_pli[1] > force_pli[2] && force_carte_non_tombee[couleur_pli[1]] < force_pli[1]) {
              if (force_carte_non_tombee[couleur_atout] > 0 && atout_restant[rang_adversaire_suivant].includes(String(couleur_atout))) {
                carte_a_jouer = pisse_faible_carte_decision;
              } else {
                carte_a_jouer = pisse_forte_carte_decision;
              }
            } else if (nb_cartes[couleur_atout] > 0) {
              if (attaque === 'oui') {
                carte_a_jouer = carte_faible[couleur_atout] + 8 * (couleur_atout - 1);
              } else {
                carte_a_jouer = carte_faible[couleur_atout] + 8 * (couleur_atout - 1);
              }
            } else {
              carte_a_jouer = pisse_faible_carte_decision;
            }
          }
        } else {
          if (nb_cartes[couleur_atout] > 0) {
            if (couleur_pli[2] !== couleur_atout) force_pli[2] = 0;
            if (force_forte[couleur_atout] > force_pli[1] && force_forte[couleur_atout] > force_pli[2]) {
              if (force_carte_non_tombee[couleur_atout] > force_forte[couleur_atout]) {
                const force_a_depasser = force_pli[1] > force_pli[2] ? force_pli[1] : force_pli[2];
                let delta = 10;
                for (let c = 0; c <= 7; c += 1) {
                  if (jeu[c + 8 * (couleur_atout - 1)] === 1) {
                    if ((force_atout[c] - force_a_depasser) < delta && (force_atout[c] - force_a_depasser) > 0) {
                      delta = force_atout[c] - force_a_depasser;
                      carte_a_jouer = c + 8 * (couleur_atout - 1);
                    }
                  }
                }
              } else {
                carte_a_jouer = carte_forte[couleur_atout] + 8 * (couleur_atout - 1);
              }
            } else {
              carte_a_jouer = carte_faible[couleur_atout] + 8 * (couleur_atout - 1);
            }
          } else if (force_pli[2] > force_pli[1] || force_carte_non_tombee[couleur_atout] > force_pli[1]) {
            carte_a_jouer = pisse_faible_carte_decision;
          } else {
            carte_a_jouer = pisse_forte_carte_decision;
          }
        }
      } else {
        if (nb_cartes[couleur_pli[1]] > 0) {
          if (force_forte[couleur_pli[1]] > force_pli[1] && force_forte[couleur_pli[1]] > force_pli[2]) {
            if (force_carte_non_tombee[couleur_pli[1]] < force_forte[couleur_pli[1]]) {
              carte_a_jouer = carte_forte[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
            } else if (couleur_atout === 6) {
              carte_a_jouer = carte_faible[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
            } else {
              const force_a_depasser = force_pli[1] > force_pli[2] ? force_pli[1] : force_pli[2];
              let delta = 10;
              for (let c = 0; c <= 7; c += 1) {
                if (jeu[c + 8 * (couleur_pli[1] - 1)] === 1) {
                  if ((force_atout[c] - force_a_depasser) < delta && (force_atout[c] - force_a_depasser) > 0) {
                    delta = force_atout[c] - force_a_depasser;
                    carte_a_jouer = c + 8 * (couleur_pli[1] - 1);
                  }
                }
              }
            }
          } else if (force_pli[1] > force_pli[2] && force_pli[1] > force_carte_non_tombee[couleur_pli[1]]) {
            carte_a_jouer = carte_faible[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
          } else {
            carte_a_jouer = carte_faible[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
          }
        } else if (force_pli[1] > force_pli[2] && force_pli[1] > force_carte_non_tombee[couleur_pli[1]]) {
          carte_a_jouer = pisse_forte_carte_decision;
        } else {
          carte_a_jouer = pisse_faible_carte_decision;
        }
      }
    }
    if (pli_sequence_joueur[1] === rang_adversaire_precedent) {
      if (couleur_atout <= 4) {
        if (couleur_pli[1] !== couleur_atout) {
          if (nb_cartes[couleur_pli[1]] > 0) {
            if (force_carte_non_tombee[couleur_pli[1]] > force_forte[couleur_pli[1]] || force_pli[1] > force_forte[couleur_pli[1]]) {
              carte_a_jouer = carte_faible[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
            } else {
              carte_a_jouer = carte_forte[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
            }
          } else if (nb_cartes[couleur_atout] > 0) {
            if (attaque === 'non') {
              carte_a_jouer = carte_forte[couleur_atout] + 8 * (couleur_atout - 1);
            } else {
              carte_a_jouer = carte_faible[couleur_atout] + 8 * (couleur_atout - 1);
            }
          } else {
            carte_a_jouer = pisse_faible_carte_decision;
          }
        } else if (nb_cartes[couleur_atout] > 0) {
          if (force_forte[couleur_atout] > force_pli[1]) {
            if (force_carte_non_tombee[couleur_atout] < force_forte[couleur_atout]) {
              carte_a_jouer = carte_forte[couleur_atout] + 8 * (couleur_atout - 1);
            } else {
              let delta = 10;
              for (let c = 0; c <= 7; c += 1) {
                if (jeu[c + 8 * (couleur_atout - 1)] === 1) {
                  if ((force_atout[c] - force_pli[1]) < delta && (force_atout[c] - force_pli[1]) > 0) {
                    delta = force_atout[c] - force_pli[1];
                    carte_a_jouer = c + 8 * (couleur_atout - 1);
                  }
                }
              }
            }
          } else {
            carte_a_jouer = carte_faible[couleur_atout] + 8 * (couleur_atout - 1);
          }
        } else if (attaque === 'non' && contrat === 80 && force_carte_non_tombee[couleur_atout] === 8) {
          carte_a_jouer = pisse_faible_carte_decision;
        } else {
          carte_a_jouer = pisse_faible_carte_decision;
        }
      } else {
        if (nb_cartes[couleur_pli[1]] > 0) {
          if (force_forte[couleur_pli[1]] > force_pli[1]) {
            if (force_forte[couleur_pli[1]] > force_carte_non_tombee[couleur_pli[1]]) {
              carte_a_jouer = carte_forte[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
            } else if (couleur_atout === 6) {
              carte_a_jouer = carte_faible[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
            } else {
              let delta = 10;
              for (let c = 0; c <= 7; c += 1) {
                if (jeu[c + 8 * (couleur_pli[1] - 1)] === 1) {
                  if ((force_atout[c] - force_pli[1]) < delta && (force_atout[c] - force_pli[1]) > 0) {
                    delta = force_atout[c] - force_pli[1];
                    carte_a_jouer = c + 8 * (couleur_pli[1] - 1);
                  }
                }
              }
            }
          } else {
            carte_a_jouer = carte_faible[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
          }
        } else {
          carte_a_jouer = pisse_faible_carte_decision;
        }
      }
    }

    if (pli_sequence_joueur[1] === rang_adversaire_suivant) {
      if (couleur_atout <= 4) {
        if (couleur_pli[1] !== couleur_atout) {
          if (nb_cartes[couleur_pli[1]] > 0) {
            if (couleur_pli[2] === couleur_atout && couleur_pli[3] === couleur_atout) {
              if (force_pli[2] > force_pli[3]) {
                carte_a_jouer = carte_forte[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
              } else {
                carte_a_jouer = carte_faible[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
              }
            }
            if (couleur_pli[2] === couleur_atout && couleur_pli[3] !== couleur_atout) {
              carte_a_jouer = carte_forte[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
            }
            if (couleur_pli[2] !== couleur_atout && couleur_pli[3] === couleur_atout) {
              carte_a_jouer = carte_faible[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
            }
            if (couleur_pli[2] !== couleur_atout && couleur_pli[3] !== couleur_atout) {
              if (couleur_pli[2] !== couleur_pli[1]) force_pli[2] = 0;
              if (couleur_pli[3] !== couleur_pli[1]) force_pli[3] = 0;
              if (
                force_forte[couleur_pli[1]] > force_pli[1] &&
                force_forte[couleur_pli[1]] > force_pli[2] &&
                force_forte[couleur_pli[1]] > force_pli[3]
              ) {
                carte_a_jouer = carte_forte[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
              } else if (force_pli[2] > force_pli[1] && force_pli[2] > force_pli[3]) {
                if (attaque === 'oui') {
                  if (force_pli[2] === 8 && force_forte[couleur_pli[1]] === 7) {
                    carte_a_jouer = carte_faible[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
                  } else {
                    carte_a_jouer = carte_forte[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
                  }
                } else {
                  carte_a_jouer = carte_forte[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
                }
              } else {
                carte_a_jouer = carte_faible[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
              }
            }
          } else {
            if (couleur_pli[2] === couleur_atout && couleur_pli[3] !== couleur_atout) {
              carte_a_jouer = pisse_forte_carte_decision;
            }
            if (couleur_pli[2] !== couleur_atout && couleur_pli[3] === couleur_atout) {
              if (nb_cartes[couleur_atout] > 0) {
                if (force_forte[couleur_atout] > force_pli[3]) {
                  if (attaque === 'non') {
                    carte_a_jouer = carte_forte[couleur_atout] + 8 * (couleur_atout - 1);
                  } else {
                    let delta = 10;
                    for (let c = 0; c <= 7; c += 1) {
                      if (jeu[c + 8 * (couleur_atout - 1)] === 1) {
                        if ((force_atout[c] - force_pli[3]) < delta && (force_atout[c] - force_pli[3]) > 0) {
                          delta = force_atout[c] - force_pli[3];
                          carte_a_jouer = c + 8 * (couleur_atout - 1);
                        }
                      }
                    }
                  }
                } else {
                  carte_a_jouer = carte_faible[couleur_atout] + 8 * (couleur_atout - 1);
                }
              } else {
                carte_a_jouer = pisse_faible_carte_decision;
              }
            }
            if (couleur_pli[2] === couleur_atout && couleur_pli[3] === couleur_atout) {
              if (force_pli[3] > force_pli[2]) {
                if (nb_cartes[couleur_atout] > 0) {
                  if (force_forte[couleur_atout] > force_pli[3]) {
                    if (attaque === 'oui') {
                      carte_a_jouer = carte_forte[couleur_atout] + 8 * (couleur_atout - 1);
                    } else {
                      let delta = 10;
                      for (let c = 0; c <= 7; c += 1) {
                        if (jeu[c + 8 * (couleur_atout - 1)] === 1) {
                          if ((force_atout[c] - force_pli[3]) < delta && (force_atout[c] - force_pli[3]) > 0) {
                            delta = force_atout[c] - force_pli[3];
                            carte_a_jouer = c + 8 * (couleur_atout - 1);
                          }
                        }
                      }
                    }
                  } else {
                    carte_a_jouer = carte_faible[couleur_atout] + 8 * (couleur_atout - 1);
                  }
                } else {
                  carte_a_jouer = pisse_faible_carte_decision;
                }
              } else {
                carte_a_jouer = pisse_forte_carte_decision;
              }
            }
            if (couleur_pli[2] !== couleur_atout && couleur_pli[3] !== couleur_atout) {
              if (couleur_pli[2] !== couleur_pli[1]) force_pli[2] = 0;
              if (couleur_pli[3] !== couleur_pli[1]) force_pli[3] = 0;
              if (force_pli[2] > force_pli[3] && force_pli[2] > force_pli[1]) {
                carte_a_jouer = pisse_forte_carte_decision;
              } else if (nb_cartes[couleur_atout] > 0) {
                if (attaque === 'non') {
                  if (force_forte[couleur_atout] < force_carte_non_tombee[couleur_atout]) {
                    if (force_forte[couleur_atout] < 7 || nb_cartes[couleur_atout] < 3) {
                      carte_a_jouer = carte_forte[couleur_atout] + 8 * (couleur_atout - 1);
                    } else {
                      carte_a_jouer = carte_faible[couleur_atout] + 8 * (couleur_atout - 1);
                    }
                  } else {
                    carte_a_jouer = carte_faible[couleur_atout] + 8 * (couleur_atout - 1);
                  }
                } else {
                  carte_a_jouer = carte_faible[couleur_atout] + 8 * (couleur_atout - 1);
                }
              } else {
                carte_a_jouer = pisse_faible_carte_decision;
              }
            }
          }
        } else {
          if (couleur_pli[2] !== couleur_atout) force_pli[2] = -1;
          if (couleur_pli[3] !== couleur_atout) force_pli[3] = -1;
          if (nb_cartes[couleur_atout] > 0) {
            if (
              force_forte[couleur_atout] > force_pli[1] &&
              force_forte[couleur_atout] > force_pli[2] &&
              force_forte[couleur_atout] > force_pli[3]
            ) {
              carte_a_jouer = carte_forte[couleur_atout] + 8 * (couleur_atout - 1);
            } else {
              carte_a_jouer = carte_faible[couleur_atout] + 8 * (couleur_atout - 1);
            }
          } else if (force_pli[2] > force_pli[1] && force_pli[2] > force_pli[3]) {
            carte_a_jouer = pisse_forte_carte_decision;
          } else {
            carte_a_jouer = pisse_faible_carte_decision;
          }
        }
      } else {
        if (nb_cartes[couleur_pli[1]] > 0) {
          if (force_pli[2] > force_pli[1] && force_pli[2] > force_pli[3]) {
            if (force_forte[couleur_pli[1]] > force_pli[2]) {
              carte_a_jouer = carte_forte[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
            } else if (force_forte[couleur_pli[1]] === 7) {
              carte_a_jouer = carte_faible[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
            } else {
              carte_a_jouer = carte_forte[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
            }
          } else if (
            force_forte[couleur_pli[1]] > force_pli[1] &&
            force_forte[couleur_pli[1]] > force_pli[3]
          ) {
            carte_a_jouer = carte_forte[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
          } else {
            carte_a_jouer = carte_faible[couleur_pli[1]] + 8 * (couleur_pli[1] - 1);
          }
        } else if (force_pli[2] > force_pli[1] && force_pli[2] > force_pli[3]) {
          carte_a_jouer = pisse_forte_carte_decision;
        } else {
          carte_a_jouer = pisse_faible_carte_decision;
        }
      }
    }
  }

  const nom_carte = CARD_NAMES[carte_a_jouer] || '';
  const couleur_carte = Math.floor(carte_a_jouer / 8) + 1;
  let playReason = '';
  if (nb_pli === 0) {
    playReason = `Entame ${couleur[couleur_carte]}`;
  } else if (couleur_pli[1] === couleur_carte) {
    playReason = `Suit ${couleur[couleur_carte]}`;
  } else if (couleur_atout <= 4 && couleur_carte === couleur_atout) {
    playReason = `Coupe ${couleur[couleur_carte]}`;
  } else {
    playReason = `Pisse ${couleur[couleur_carte]}`;
  }
  return { type: 'play', card: nom_carte, proposition: nom_carte, reason: playReason };
}

function decideAction(rows) {
  const state = buildState(rows);
  if (state.nb_pli === 4) {
    return { type: 'collect' };
  }
  if (!state.mise && state.nb_pli < 4) {
    return decideBidding(state);
  }
  if (state.mise && state.nb_pli < 4) {
    return decidePlay(state);
  }
  return { type: 'none' };
}

module.exports = {
  decideAction
};
