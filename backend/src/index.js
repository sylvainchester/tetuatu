require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const gamesRouter = require('./routes/games');
const impostorRouter = require('./routes/impostor');
const { attachWebSocket } = require('./realtime');

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, _res, next) => {
  // Temp request log for debugging mobile connections.
  console.log(req.method, req.url);
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/games', gamesRouter);
app.use('/impostor', impostorRouter);

const server = http.createServer(app);
const { broadcast } = attachWebSocket(server);

app.locals.broadcast = broadcast;

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Coinche backend listening on ${port}`);
});
