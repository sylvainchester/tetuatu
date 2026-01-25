const { WebSocketServer } = require('ws');

function attachWebSocket(server) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.gameId = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type === 'subscribe' && msg?.gameId) {
          ws.gameId = msg.gameId;
        }
      } catch (_err) {
        // Ignore bad payloads
      }
    });

    ws.on('pong', () => {
      ws.isAlive = true;
    });
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  function broadcast(gameId, payload) {
    const message = JSON.stringify(payload);
    wss.clients.forEach((ws) => {
      if (ws.readyState === ws.OPEN && (!gameId || ws.gameId === gameId)) {
        ws.send(message);
      }
    });
  }

  return { wss, broadcast };
}

module.exports = {
  attachWebSocket
};
