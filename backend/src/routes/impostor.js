require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const Pusher = require('pusher');
const webPush = require('web-push');

const { supabase, getUserFromRequest } = require('../db');

const router = express.Router();

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || '2096013',
  key: process.env.PUSHER_KEY || '74c987d1696a0d660d3d',
  secret: process.env.PUSHER_SECRET || 'a733e79455655430088b',
  cluster: process.env.PUSHER_CLUSTER || 'eu',
  useTLS: true
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false }
});

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn('[WEB PUSH] Missing VAPID keys. Web push will be disabled.');
}

function notifyLobby() {
  pusher.trigger('lobby', 'lobby-updated', { timestamp: Date.now() }).catch((err) => {
    console.error('Pusher lobby error:', err);
  });
}

function notifyGame(gameId) {
  pusher.trigger(`game-${gameId}`, 'game-updated', { timestamp: Date.now() }).catch((err) => {
    console.error(`Pusher game ${gameId} error:`, err);
  });
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_CHUNK_SIZE = 100;

function isValidExpoToken(token) {
  return typeof token === 'string' &&
    (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken['));
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function sendExpoPushNotifications(tokens, title, body, data = {}, channelId = null) {
  if (!tokens || tokens.length === 0) return;

  const validTokens = tokens.filter(isValidExpoToken);
  if (validTokens.length === 0) return;

  const chunks = chunkArray(validTokens, EXPO_CHUNK_SIZE);

  for (const chunk of chunks) {
    const messages = chunk.map((token) => {
      const message = {
        to: token,
        title,
        body
      };

      if (channelId) {
        message.channelId = channelId;
      } else {
        message.sound = 'default';
      }

      if (data && Object.keys(data).length > 0) {
        message.data = data;
      }

      return message;
    });

    try {
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(messages)
      });
    } catch (err) {
      console.error('[PUSH] Error sending notifications:', err);
    }
  }
}

async function upsertWebPushSubscription(userId, subscription) {
  if (!subscription || !subscription.endpoint) return;

  await pool.query(
    `INSERT INTO web_push_subscriptions (user_id, endpoint, subscription)
     VALUES ($1, $2, $3)
     ON CONFLICT (endpoint)
     DO UPDATE SET user_id = EXCLUDED.user_id, subscription = EXCLUDED.subscription`,
    [userId || null, subscription.endpoint, subscription]
  );
}

async function deleteWebPushSubscription(endpoint) {
  if (!endpoint) return;
  await pool.query('DELETE FROM web_push_subscriptions WHERE endpoint = $1', [endpoint]);
}

async function getWebPushSubscriptions(userIds = []) {
  if (userIds.length === 0) {
    const result = await pool.query('SELECT subscription FROM web_push_subscriptions');
    return result.rows.map((row) => row.subscription);
  }

  const result = await pool.query(
    'SELECT subscription FROM web_push_subscriptions WHERE user_id = ANY($1)',
    [userIds]
  );
  return result.rows.map((row) => row.subscription);
}

async function sendWebPushNotifications(subscriptions, payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return;
  }
  if (!subscriptions || subscriptions.length === 0) {
    return;
  }

  const payloadStr = JSON.stringify(payload);

  for (const subscription of subscriptions) {
    try {
      await webPush.sendNotification(subscription, payloadStr);
    } catch (err) {
      const status = err?.statusCode;
      if (status === 404 || status === 410) {
        await deleteWebPushSubscription(subscription.endpoint);
      } else {
        console.error('[WEB PUSH] Error sending notification:', err);
      }
    }
  }
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS impostor_users (
      id uuid PRIMARY KEY,
      username TEXT UNIQUE,
      score INT DEFAULT 0,
      push_token TEXT,
      telegram_chat_id TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS impostor_games (
      id SERIAL PRIMARY KEY,
      status TEXT DEFAULT 'waiting',
      word TEXT,
      clue TEXT,
      impostor_id uuid,
      round INT DEFAULT 1,
      playing_order JSONB,
      current_turn_index INT DEFAULT 0,
      winner TEXT,
      result_details TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS impostor_players (
      game_id INT,
      user_id uuid,
      role TEXT DEFAULT 'cabronazo',
      PRIMARY KEY (game_id, user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS impostor_turns (
      id SERIAL PRIMARY KEY,
      game_id INT,
      user_id uuid,
      word_entered TEXT,
      round INT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS impostor_votes (
      id SERIAL PRIMARY KEY,
      game_id INT,
      voter_id uuid,
      suspect_id uuid
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS impostor_words (
      id SERIAL PRIMARY KEY,
      word TEXT UNIQUE,
      clue TEXT,
      times_used INT DEFAULT 0,
      last_used_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS web_push_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id uuid,
      endpoint TEXT UNIQUE,
      subscription JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const initialWords = [
    { word: 'Manzana', clue: 'Fruta roja' },
    { word: 'Elefante', clue: 'Animal grande' },
    { word: 'Madrid', clue: 'Capital europea' },
    { word: 'Guitarra', clue: 'Instrumento musical' },
    { word: 'Playa', clue: 'Lugar de vacaciones' },
    { word: 'Pizza', clue: 'Comida italiana' },
    { word: 'Fútbol', clue: 'Deporte popular' },
    { word: 'Montaña', clue: 'Formación natural alta' },
    { word: 'Libro', clue: 'Objeto para leer' },
    { word: 'Reloj', clue: 'Mide el tiempo' },
    { word: 'Avión', clue: 'Transporte aéreo' },
    { word: 'Café', clue: 'Bebida con cafeína' },
    { word: 'Luna', clue: 'Satélite natural' },
    { word: 'Teléfono', clue: 'Dispositivo de comunicación' },
    { word: 'Jardín', clue: 'Espacio con plantas' }
  ];

  for (const { word, clue } of initialWords) {
    await pool.query(
      'INSERT INTO impostor_words (word, clue) VALUES ($1, $2) ON CONFLICT (word) DO NOTHING',
      [word, clue]
    );
  }
}

initDb().catch((err) => console.error('DB Init Error:', err));

async function getProfileUsername(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('username')
    .eq('id', userId)
    .single();

  if (error || !data?.username) {
    return null;
  }

  return data.username;
}

async function ensureImpostorUser(userId) {
  const username = await getProfileUsername(userId);
  if (!username) {
    throw new Error('missing_profile');
  }

  const result = await pool.query(
    `INSERT INTO impostor_users (id, username)
     VALUES ($1, $2)
     ON CONFLICT (id)
     DO UPDATE SET username = EXCLUDED.username
     RETURNING id, username, score`,
    [userId, username]
  );

  return result.rows[0];
}

router.get('/push/vapid-public-key', (_req, res) => {
  if (!VAPID_PUBLIC_KEY) {
    return res.status(500).json({ error: 'VAPID public key not configured' });
  }
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

router.use(async (req, res, next) => {
  const { user, error } = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error });
  }
  req.user = user;
  return next();
});

router.get('/me', async (req, res) => {
  try {
    const impostorUser = await ensureImpostorUser(req.user.id);
    res.json(impostorUser);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/push/subscribe', async (req, res) => {
  const { subscription } = req.body;
  if (!subscription) {
    return res.status(400).json({ error: 'Missing subscription' });
  }

  try {
    await upsertWebPushSubscription(req.user.id, subscription);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users/push-token', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }

  try {
    await pool.query('UPDATE impostor_users SET push_token = $1 WHERE id = $2', [token, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/scoreboard', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT username, score FROM impostor_users ORDER BY score DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/games', async (_req, res) => {
  try {
    const gamesResult = await pool.query(
      'SELECT * FROM impostor_games WHERE status != $1 ORDER BY created_at DESC',
      ['finished']
    );

    const result = await Promise.all(
      gamesResult.rows.map(async (g) => {
        const playersResult = await pool.query(
          'SELECT user_id FROM impostor_players WHERE game_id = $1',
          [g.id]
        );
        return {
          ...g,
          player_count: playersResult.rows.length,
          player_ids: playersResult.rows.map((p) => p.user_id)
        };
      })
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/games', async (_req, res) => {
  try {
    const result = await pool.query(
      'INSERT INTO impostor_games (status) VALUES ($1) RETURNING id',
      ['waiting']
    );
    const id = result.rows[0].id;
    const newGame = { id, status: 'waiting', round: 1 };

    notifyLobby();

    const tokens = await getAllUserTokens();
    await sendExpoPushNotifications(tokens, 'Nueva Partida', `¡Se ha creado la partida #${id}! 🎮`, {}, 'channel_creation_v11');
    const webSubscriptions = await getWebPushSubscriptions();
    await sendWebPushNotifications(webSubscriptions, {
      title: 'Nueva Partida',
      body: `¡Se ha creado la partida #${id}! 🎮`,
      data: { url: '/impostor/lobby' }
    });

    res.json(newGame);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/games/:id/join', async (req, res) => {
  const gameId = Number(req.params.id);

  try {
    const existing = await pool.query(
      'SELECT * FROM impostor_players WHERE game_id = $1 AND user_id = $2',
      [gameId, req.user.id]
    );
    if (existing.rows.length > 0) {
      return res.json({ success: true, message: 'Already joined' });
    }

    await pool.query(
      'INSERT INTO impostor_players (game_id, user_id, role) VALUES ($1, $2, $3)',
      [gameId, req.user.id, 'cabronazo']
    );
    notifyGame(gameId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/games/:id/start', async (req, res) => {
  const gameId = Number(req.params.id);
  try {
    const playersResult = await pool.query(
      'SELECT user_id FROM impostor_players WHERE game_id = $1',
      [gameId]
    );
    const players = playersResult.rows.map((row) => row.user_id);
    if (players.length < 3) {
      return res.status(400).json({ error: 'Need more players (min 3)' });
    }

    const impostorIndex = Math.floor(Math.random() * players.length);
    const impostorId = players[impostorIndex];

    await pool.query(
      'UPDATE impostor_players SET role = $1 WHERE game_id = $2 AND user_id = $3',
      ['impostor', gameId, impostorId]
    );
    await pool.query(
      'UPDATE impostor_players SET role = $1 WHERE game_id = $2 AND user_id != $3',
      ['cabronazo', gameId, impostorId]
    );

    const playingOrder = players.sort(() => Math.random() - 0.5);
    const { word, clue } = await getRandomWordAndClue();

    await pool.query(
      'UPDATE impostor_games SET status = $1, impostor_id = $2, word = $3, clue = $4, playing_order = $5, current_turn_index = 0, winner = NULL, result_details = NULL WHERE id = $6',
      ['playing', impostorId, word, clue, JSON.stringify(playingOrder), gameId]
    );

    notifyGame(gameId);
    notifyLobby();

    const tokens = await getUserTokens(players);
    await sendExpoPushNotifications(tokens, `Partida #${gameId}`, `¡La partida #${gameId} ha comenzado! (1 Impostor)`, {}, 'channel_start_v11');
    const webSubscriptions = await getWebPushSubscriptions(players);
    await sendWebPushNotifications(webSubscriptions, {
      title: `Partida #${gameId}`,
      body: `¡La partida #${gameId} ha comenzado! (1 Impostor)`,
      data: { url: `/impostor/game/${gameId}` }
    });

    if (playingOrder[0]) {
      const firstTokens = await getUserTokens([playingOrder[0]]);
      await sendExpoPushNotifications(firstTokens, 'Tu Turno', '¡Es tu turno de jugar!', {}, 'channel_turn_event_v1');
      const firstWebSubscriptions = await getWebPushSubscriptions([playingOrder[0]]);
      await sendWebPushNotifications(firstWebSubscriptions, {
        title: 'Tu Turno',
        body: '¡Es tu turno de jugar!',
        data: { url: `/impostor/game/${gameId}` }
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/games/:id', async (req, res) => {
  const gameId = Number(req.params.id);
  try {
    const games = await pool.query('SELECT * FROM impostor_games WHERE id = $1', [gameId]);
    if (games.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }
    const game = games.rows[0];
    game.playing_order = game.playing_order || [];

    const playersResult = await pool.query(
      'SELECT p.*, u.username, u.score FROM impostor_players p JOIN impostor_users u ON p.user_id = u.id WHERE p.game_id = $1',
      [gameId]
    );

    const turnsResult = await pool.query(
      'SELECT * FROM impostor_turns WHERE game_id = $1',
      [gameId]
    );
    const votesResult = await pool.query(
      'SELECT * FROM impostor_votes WHERE game_id = $1',
      [gameId]
    );

    const myPlayer = playersResult.rows.find((p) => p.user_id === req.user.id);
    const isImpostor = myPlayer?.role === 'impostor';

    const responseGame = { ...game };
    if (game.status === 'playing' || game.status === 'voting') {
      if (isImpostor) {
        responseGame.word = '???';
      } else {
        responseGame.clue = '???';
      }
      delete responseGame.impostor_id;
    }

    let currentTurnUserId = null;
    if (game.status === 'playing' && game.playing_order.length > 0) {
      currentTurnUserId = game.playing_order[game.current_turn_index];
    }
    responseGame.current_turn_user_id = currentTurnUserId;

    const responsePlayers = playersResult.rows.map((p) => ({
      ...p,
      role: (game.status === 'finished' || p.user_id === req.user.id) ? p.role : 'unknown'
    }));

    res.json({
      game: responseGame,
      players: responsePlayers,
      turns: turnsResult.rows,
      votes: votesResult.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/games/:id/turn', async (req, res) => {
  const gameId = Number(req.params.id);
  const { word } = req.body;

  try {
    const games = await pool.query('SELECT * FROM impostor_games WHERE id = $1', [gameId]);
    if (games.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }
    const game = games.rows[0];

    const expectedUserId = game.playing_order?.[game.current_turn_index];
    if (req.user.id !== expectedUserId) {
      return res.status(403).json({ error: 'Not your turn' });
    }

    await pool.query(
      'INSERT INTO impostor_turns (game_id, user_id, word_entered, round) VALUES ($1, $2, $3, $4)',
      [gameId, req.user.id, word, game.round]
    );

    let newStatus = game.status;
    let newTurnIndex = game.current_turn_index + 1;

    if (newTurnIndex >= game.playing_order.length) {
      newStatus = 'voting';
    }

    await pool.query(
      'UPDATE impostor_games SET status = $1, current_turn_index = $2 WHERE id = $3',
      [newStatus, newTurnIndex, gameId]
    );

    if (newStatus === 'voting') {
      const playerIds = game.playing_order || [];
      const tokens = await getUserTokens(playerIds);
      await sendExpoPushNotifications(tokens, '¡A Votar!', 'La ronda ha terminado. ¿Quién es el impostor?', {}, 'channel_vote_event_v1');
      const webSubscriptions = await getWebPushSubscriptions(playerIds);
      await sendWebPushNotifications(webSubscriptions, {
        title: '¡A Votar!',
        body: 'La ronda ha terminado. ¿Quién es el impostor?',
        data: { url: `/impostor/game/${gameId}` }
      });
    } else {
      const nextUserId = game.playing_order?.[newTurnIndex];
      if (nextUserId) {
        const tokens = await getUserTokens([nextUserId]);
        await sendExpoPushNotifications(tokens, 'Tu Turno', '¡Es tu turno de jugar!', {}, 'channel_turn_event_v1');
        const webSubscriptions = await getWebPushSubscriptions([nextUserId]);
        await sendWebPushNotifications(webSubscriptions, {
          title: 'Tu Turno',
          body: '¡Es tu turno de jugar!',
          data: { url: `/impostor/game/${gameId}` }
        });
      }
    }

    notifyGame(gameId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/games/:id/vote', async (req, res) => {
  const gameId = Number(req.params.id);
  const { suspectId } = req.body;

  try {
    const games = await pool.query('SELECT * FROM impostor_games WHERE id = $1', [gameId]);
    if (games.rows.length === 0) {
      return res.status(404).json({ error: 'Game not found' });
    }
    const game = games.rows[0];

    await pool.query('DELETE FROM impostor_votes WHERE game_id = $1 AND voter_id = $2', [gameId, req.user.id]);
    await pool.query(
      'INSERT INTO impostor_votes (game_id, voter_id, suspect_id) VALUES ($1, $2, $3)',
      [gameId, req.user.id, suspectId]
    );

    const playersResult = await pool.query('SELECT user_id FROM impostor_players WHERE game_id = $1', [gameId]);
    const playerIds = playersResult.rows.map((row) => row.user_id);
    const votesResult = await pool.query('SELECT * FROM impostor_votes WHERE game_id = $1', [gameId]);

    if (votesResult.rows.length >= playerIds.length) {
      const voteStats = {};
      votesResult.rows.forEach((v) => {
        voteStats[v.suspect_id] = (voteStats[v.suspect_id] || 0) + 1;
      });

      let maxVotes = 0;
      let tiedUsers = [];
      for (const [uId, count] of Object.entries(voteStats)) {
        if (count > maxVotes) {
          maxVotes = count;
          tiedUsers = [uId];
        } else if (count === maxVotes) {
          tiedUsers.push(uId);
        }
      }

      const impostorId = game.impostor_id;
      const isImpostorCaught = tiedUsers.includes(impostorId);

      if (isImpostorCaught) {
        const details = tiedUsers.length > 1 ? 'Empate de votos: ¡El Impostor pierde!' : '¡El Impostor ha sido descubierto!';
        await pool.query(
          'UPDATE impostor_games SET status = $1, winner = $2, result_details = $3 WHERE id = $4',
          ['finished', 'cabronazo', details, gameId]
        );

        await pool.query(
          'UPDATE impostor_users SET score = score + 1 WHERE id != $1 AND id = ANY($2)',
          [impostorId, playerIds]
        );

        const tokens = await getUserTokens(playerIds);
        await sendExpoPushNotifications(tokens, `Partida #${gameId} Terminada`, `¡El Impostor ha sido descubierto! 🕵️‍♂️ (Partida #${gameId})`, {}, 'channel_result_v11');
        const webSubscriptions = await getWebPushSubscriptions(playerIds);
        await sendWebPushNotifications(webSubscriptions, {
          title: `Partida #${gameId} Terminada`,
          body: `¡El Impostor ha sido descubierto! 🕵️‍♂️ (Partida #${gameId})`,
          data: { url: `/impostor/game/${gameId}` }
        });
      } else {
        if (game.round === 1) {
          await pool.query('UPDATE impostor_users SET score = score + 2 WHERE id = $1', [impostorId]);
          await pool.query('DELETE FROM impostor_votes WHERE game_id = $1', [gameId]);
          await pool.query(
            'UPDATE impostor_games SET round = 2, current_turn_index = 0, status = $1, result_details = $2 WHERE id = $3',
            ['playing', '¡El Impostor ha escapado en la primera ronda! Seguimos...', gameId]
          );

          notifyGame(gameId);
          notifyLobby();

          const tokens = await getUserTokens(playerIds);
          await sendExpoPushNotifications(tokens, `Partida #${gameId}: Ronda 2`, `¡El Impostor escapó! Ronda final... (Partida #${gameId})`, {}, 'channel_result_v11');
          const webSubscriptions = await getWebPushSubscriptions(playerIds);
          await sendWebPushNotifications(webSubscriptions, {
            title: `Partida #${gameId}: Ronda 2`,
            body: `¡El Impostor escapó! Ronda final... (Partida #${gameId})`,
            data: { url: `/impostor/game/${gameId}` }
          });

          const refreshed = await pool.query('SELECT playing_order FROM impostor_games WHERE id = $1', [gameId]);
          const playingOrder = refreshed.rows[0]?.playing_order || [];
          if (playingOrder[0]) {
            const firstTokens = await getUserTokens([playingOrder[0]]);
            await sendExpoPushNotifications(firstTokens, 'Tu Turno', '¡Es tu turno de jugar! (Ronda 2)', {}, 'channel_turn_event_v1');
            const firstWebSubscriptions = await getWebPushSubscriptions([playingOrder[0]]);
            await sendWebPushNotifications(firstWebSubscriptions, {
              title: 'Tu Turno',
              body: '¡Es tu turno de jugar! (Ronda 2)',
              data: { url: `/impostor/game/${gameId}` }
            });
          }

          return res.json({ success: true });
        }

        const otherPlayersCount = playerIds.length - 1;
        await pool.query('UPDATE impostor_users SET score = score + $1 WHERE id = $2', [otherPlayersCount, impostorId]);
        await pool.query(
          'UPDATE impostor_games SET status = $1, winner = $2, result_details = $3 WHERE id = $4',
          ['finished', 'impostor', '¡El Impostor ha engañado a todos en ambas rondas!', gameId]
        );

        const tokens = await getUserTokens(playerIds);
        await sendExpoPushNotifications(tokens, `Partida #${gameId} Terminada`, `¡El Impostor ha ganado! 🎭 (Partida #${gameId})`, {}, 'channel_result_v11');
        const webSubscriptions = await getWebPushSubscriptions(playerIds);
        await sendWebPushNotifications(webSubscriptions, {
          title: `Partida #${gameId} Terminada`,
          body: `¡El Impostor ha ganado! 🎭 (Partida #${gameId})`,
          data: { url: `/impostor/game/${gameId}` }
        });
      }

      notifyLobby();
    }

    notifyGame(gameId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/games/:id/cancel', async (req, res) => {
  const gameId = Number(req.params.id);
  try {
    await pool.query(
      'UPDATE impostor_games SET status = $1, winner = $2, result_details = $3 WHERE id = $4',
      ['finished', 'none', 'Partida cancelada', gameId]
    );
    notifyGame(gameId);
    notifyLobby();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function getRandomWordAndClue() {
  try {
    const unusedWords = await pool.query(
      'SELECT id, word, clue FROM impostor_words WHERE times_used = 0 ORDER BY RANDOM() LIMIT 1'
    );

    let selectedWord;
    if (unusedWords.rows.length > 0) {
      selectedWord = unusedWords.rows[0];
    } else {
      const leastUsedWords = await pool.query(
        'SELECT id, word, clue FROM impostor_words ORDER BY last_used_at ASC NULLS FIRST LIMIT 1'
      );
      selectedWord = leastUsedWords.rows[0];
    }

    await pool.query(
      'UPDATE impostor_words SET times_used = times_used + 1, last_used_at = NOW() WHERE id = $1',
      [selectedWord.id]
    );

    return { word: selectedWord.word, clue: selectedWord.clue };
  } catch (err) {
    console.error('[ERROR] getRandomWordAndClue:', err);
    return { word: 'Manzana', clue: 'Fruta roja' };
  }
}

async function getUserTokens(userIds) {
  if (!userIds || userIds.length === 0) return [];

  const result = await pool.query(
    'SELECT push_token FROM impostor_users WHERE id = ANY($1) AND push_token IS NOT NULL AND push_token <> \'\'',
    [userIds]
  );

  return result.rows.map((row) => row.push_token).filter(Boolean);
}

async function getAllUserTokens() {
  const result = await pool.query(
    'SELECT push_token FROM impostor_users WHERE push_token IS NOT NULL AND push_token <> \'\''
  );

  return result.rows.map((row) => row.push_token).filter(Boolean);
}

module.exports = router;
