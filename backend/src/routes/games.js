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

  req.app.locals.broadcast?.(data.id, { type: 'game.created', data });
  req.app.locals.broadcast?.(null, { type: 'games.changed', data });
  return res.status(201).json({ data });
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

  req.app.locals.broadcast?.(req.params.gameId, { type: 'game.joined', data });
  return res.json({ data });
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

  req.app.locals.broadcast?.(req.params.gameId, { type: 'game.robot_added', data });
  return res.json({ data });
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

  req.app.locals.broadcast?.(req.params.gameId, { type: 'game.left', data });
  return res.json({ data });
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

  req.app.locals.broadcast?.(req.params.gameId, { type: 'bid.placed', data });
  return res.json({ data });
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

  req.app.locals.broadcast?.(req.params.gameId, { type: 'bid.cancelled', data });
  return res.json({ data });
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

  req.app.locals.broadcast?.(req.params.gameId, { type: 'card.played', data });
  return res.json({ data });
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

  req.app.locals.broadcast?.(req.params.gameId, { type: 'card.undone', data });
  return res.json({ data });
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

  req.app.locals.broadcast?.(req.params.gameId, { type: 'trick.collected', data });
  return res.json({ data });
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

  req.app.locals.broadcast?.(req.params.gameId, { type: 'trick.cancelled', data });
  return res.json({ data });
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

  req.app.locals.broadcast?.(req.params.gameId, { type: 'debrief.finished', data });
  return res.json({ data });
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
  req.app.locals.broadcast?.(req.params.gameId, { type: 'hints.disabled', data });
  return res.json({ data });
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
  req.app.locals.broadcast?.(req.params.gameId, { type: 'hints.enabled', data });
  return res.json({ data });
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

  req.app.locals.broadcast?.(req.params.gameId, { type: 'game.dealt', data });
  return res.json({ data });
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
