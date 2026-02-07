const express = require('express');
const { supabase, getUserFromRequest } = require('../db');
const service = require('../services/coincheService');

const router = express.Router();

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

router.get('/', async (_req, res) => {
  const { data, error } = await service.listGames();
  if (error) {
    return res.status(500).json({ error: error.message || 'list_failed' });
  }
  return res.json({ data });
});

router.get('/:gameId', async (req, res) => {
  const { data, error } = await service.getGameState(req.params.gameId);
  if (error) {
    return res.status(500).json({ error: error.message || 'fetch_failed' });
  }
  return res.json({ data });
});

async function applyAi(gameId) {
  const { data, error } = await service.applyAiForGame({ gameId });
  if (error) {
    return { data: null, error };
  }
  return { data, error: null };
}

router.post('/', async (req, res) => {
  const { user, error: authError } = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: authError });
  }

  const username = await getProfileUsername(user.id);
  if (!username) {
    return res.status(400).json({ error: 'missing_profile' });
  }

  const { data, error } = await service.createGame({
    userId: user.id,
    username
  });

  if (error) {
    return res.status(500).json({ error: error.message || 'create_failed' });
  }

  const aiResult = await applyAi(data.id);
  const payload = aiResult.data || data;
  req.app.locals.broadcast?.(data.id, { type: 'game.created', data: payload });
  req.app.locals.broadcast?.(null, { type: 'games.changed', data: payload });
  return res.status(201).json({ data: payload });
});

router.post('/:gameId/join', async (req, res) => {
  const { user, error: authError } = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: authError });
  }

  const username = await getProfileUsername(user.id);
  if (!username) {
    return res.status(400).json({ error: 'missing_profile' });
  }

  const seat = Number(req.body?.seat);
  if (!seat || seat < 1 || seat > 4) {
    return res.status(400).json({ error: 'invalid_seat' });
  }

  const { data, error } = await service.joinSeat({
    gameId: req.params.gameId,
    seat,
    userId: user.id,
    username
  });

  if (error) {
    return res.status(500).json({ error: error.message || 'join_failed' });
  }

  const aiResult = await applyAi(req.params.gameId);
  const payload = aiResult.data || data;
  req.app.locals.broadcast?.(req.params.gameId, { type: 'game.joined', data: payload });
  return res.json({ data: payload });
});

router.post('/:gameId/robot', async (req, res) => {
  const { user, error: authError } = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: authError });
  }

  const seat = Number(req.body?.seat);
  if (!seat || seat < 1 || seat > 4) {
    return res.status(400).json({ error: 'invalid_seat' });
  }

  const { data, error } = await service.addRobot({
    gameId: req.params.gameId,
    seat
  });

  if (error) {
    return res.status(500).json({ error: error.message || 'robot_failed' });
  }

  const aiResult = await applyAi(req.params.gameId);
  const payload = aiResult.data || data;
  req.app.locals.broadcast?.(req.params.gameId, { type: 'game.robot_added', data: payload });
  return res.json({ data: payload });
});

router.post('/:gameId/leave', async (req, res) => {
  const { user, error: authError } = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: authError });
  }

  const { data, error } = await service.leaveGame({
    gameId: req.params.gameId,
    userId: user.id
  });

  if (error) {
    return res.status(400).json({ error: error.message || 'leave_failed' });
  }

  const aiResult = await applyAi(req.params.gameId);
  const payload = aiResult.data || data;
  req.app.locals.broadcast?.(req.params.gameId, { type: 'game.left', data: payload });
  return res.json({ data: payload });
});

router.post('/:gameId/bids', async (req, res) => {
  const { user, error: authError } = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: authError });
  }

  const { contrat, atout, coinche } = req.body || {};
  if (!contrat) {
    return res.status(400).json({ error: 'missing_bid' });
  }

  const { data, error } = await service.bid({
    gameId: req.params.gameId,
    userId: user.id,
    contrat,
    atout,
    coinche
  });

  if (error) {
    return res.status(400).json({ error: error.message || 'bid_failed' });
  }

  const aiResult = await applyAi(req.params.gameId);
  const payload = aiResult.data || data;
  req.app.locals.broadcast?.(req.params.gameId, { type: 'bid.placed', data: payload });
  return res.json({ data: payload });
});

router.post('/:gameId/bids/cancel', async (req, res) => {
  const { user, error: authError } = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: authError });
  }

  const { data, error } = await service.cancelBids({ gameId: req.params.gameId });
  if (error) {
    return res.status(500).json({ error: error.message || 'cancel_failed' });
  }

  const aiResult = await applyAi(req.params.gameId);
  const payload = aiResult.data || data;
  req.app.locals.broadcast?.(req.params.gameId, { type: 'bid.cancelled', data: payload });
  return res.json({ data: payload });
});

router.post('/:gameId/play', async (req, res) => {
  const { user, error: authError } = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: authError });
  }

  const { card } = req.body || {};
  if (!card) {
    return res.status(400).json({ error: 'missing_card' });
  }

  const { data, error } = await service.playCard({
    gameId: req.params.gameId,
    userId: user.id,
    cardName: card
  });

  if (error) {
    return res.status(400).json({ error: error.message || 'play_failed' });
  }

  const aiResult = await applyAi(req.params.gameId);
  const payload = aiResult.data || data;
  req.app.locals.broadcast?.(req.params.gameId, {
    type: 'card.played',
    data: payload
  });
  return res.json({ data: payload });
});

router.post('/:gameId/undo-last', async (req, res) => {
  const { user, error: authError } = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: authError });
  }

  const { data, error } = await service.undoLast({ gameId: req.params.gameId });
  if (error) {
    return res.status(500).json({ error: error.message || 'undo_failed' });
  }

  const aiResult = await applyAi(req.params.gameId);
  const payload = aiResult.data || data;
  req.app.locals.broadcast?.(req.params.gameId, { type: 'card.undone', data: payload });
  return res.json({ data: payload });
});

router.post('/:gameId/trick/collect', async (req, res) => {
  const { user, error: authError } = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: authError });
  }

  const { data, error } = await service.collectTrick({ gameId: req.params.gameId });
  if (error) {
    return res.status(400).json({ error: error.message || 'collect_failed' });
  }

  const aiResult = await applyAi(req.params.gameId);
  const payload = aiResult.data || data;
  req.app.locals.broadcast?.(req.params.gameId, { type: 'trick.collected', data: payload });
  return res.json({ data: payload });
});

router.post('/:gameId/trick/cancel', async (req, res) => {
  const { user, error: authError } = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: authError });
  }

  const { data, error } = await service.cancelTrick({ gameId: req.params.gameId });
  if (error) {
    return res.status(500).json({ error: error.message || 'trick_cancel_failed' });
  }

  const aiResult = await applyAi(req.params.gameId);
  const payload = aiResult.data || data;
  req.app.locals.broadcast?.(req.params.gameId, { type: 'trick.cancelled', data: payload });
  return res.json({ data: payload });
});

router.post('/:gameId/debrief/finish', async (req, res) => {
  const { user, error: authError } = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: authError });
  }

  const { data, error } = await service.finishDebrief({ gameId: req.params.gameId });
  if (error) {
    return res.status(500).json({ error: error.message || 'debrief_failed' });
  }

  const aiResult = await applyAi(req.params.gameId);
  const payload = aiResult.data || data;
  req.app.locals.broadcast?.(req.params.gameId, { type: 'debrief.finished', data: payload });
  return res.json({ data: payload });
});

router.post('/:gameId/hints/disable', async (req, res) => {
  const { user, error: authError } = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: authError });
  }

  const { data, error } = await service.toggleHints({
    gameId: req.params.gameId,
    userId: user.id,
    enabled: false
  });
  if (error) {
    return res.status(400).json({ error: error.message || 'hints_failed' });
  }
  const aiResult = await applyAi(req.params.gameId);
  const payload = aiResult.data || data;
  req.app.locals.broadcast?.(req.params.gameId, { type: 'hints.disabled', data: payload });
  return res.json({ data: payload });
});

router.post('/:gameId/hints/enable', async (req, res) => {
  const { user, error: authError } = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: authError });
  }

  const { data, error } = await service.toggleHints({
    gameId: req.params.gameId,
    userId: user.id,
    enabled: true
  });
  if (error) {
    return res.status(400).json({ error: error.message || 'hints_failed' });
  }
  const aiResult = await applyAi(req.params.gameId);
  const payload = aiResult.data || data;
  req.app.locals.broadcast?.(req.params.gameId, { type: 'hints.enabled', data: payload });
  return res.json({ data: payload });
});

router.post('/:gameId/deal', async (req, res) => {
  const { user, error: authError } = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: authError });
  }

  const { data, error } = await service.dealNewHand({ gameId: req.params.gameId });
  if (error) {
    return res.status(500).json({ error: error.message || 'deal_failed' });
  }

  const aiResult = await applyAi(req.params.gameId);
  const payload = aiResult.data || data;
  req.app.locals.broadcast?.(req.params.gameId, { type: 'game.dealt', data: payload });
  return res.json({ data: payload });
});

router.delete('/:gameId', async (req, res) => {
  const { user, error: authError } = await getUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: authError });
  }

  const { data, error } = await service.deleteGame({
    gameId: req.params.gameId
  });

  if (error) {
    return res.status(500).json({ error: error.message || 'delete_failed' });
  }

  req.app.locals.broadcast?.(req.params.gameId, { type: 'game.deleted', data });
  req.app.locals.broadcast?.(null, { type: 'games.changed', data });
  return res.json({ data });
});

module.exports = router;
