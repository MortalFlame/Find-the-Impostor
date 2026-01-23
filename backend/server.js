const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, '../frontend')));

const PORT = process.env.PORT || 10000;
const server = app.listen(PORT, () => console.log('Server running', PORT));
const wss = new WebSocketServer({ server });

const words = JSON.parse(fs.readFileSync(path.join(__dirname, 'words.json'), 'utf8'));

const PHASES = {
  LOBBY: 'lobby',
  ROUND1: 'round1',
  ROUND2: 'round2',
  VOTING: 'voting',
  RESULTS: 'results'
};

const TURN_TIMEOUT = 30000; // 30s per turn
const RECONNECT_TIMEOUT = 30000; // 30s grace to reconnect

let usedIndexes = [];
let lobbies = {};

function getRandomWord() {
  if (usedIndexes.length === words.length) usedIndexes = [];
  let i;
  do { i = crypto.randomInt(words.length); } while (usedIndexes.includes(i));
  usedIndexes.push(i);
  return words[i];
}

function broadcast(lobby, data) {
  lobby.players.forEach(p => {
    if (p.ws?.readyState === 1) p.ws.send(JSON.stringify(data));
  });
}

function getState(lobby) {
  return {
    type: 'state',
    phase: lobby.phase,
    hostId: lobby.hostId,
    players: lobby.players.map(p => ({
      name: p.name,
      connected: p.connected,
      spectator: p.spectator
    })),
    round1: lobby.round1,
    round2: lobby.round2,
    currentPlayer: lobby.players[lobby.turn]?.name || null
  };
}

function migrateHost(lobby) {
  const nextHost = lobby.players.find(p => p.connected && !p.spectator);
  if (nextHost) lobby.hostId = nextHost.id;
}

function startGame(lobby) {
  lobby.phase = PHASES.ROUND1;
  lobby.turn = 0;
  lobby.round1 = [];
  lobby.round2 = [];
  lobby.turnStartedAt = Date.now();

  const { word, hint } = getRandomWord();
  lobby.word = word;
  lobby.hint = hint;

  const activePlayers = lobby.players.filter(p => !p.spectator);
  const impostorIndex = crypto.randomInt(activePlayers.length);

  activePlayers.forEach((p, i) => {
    p.role = i === impostorIndex ? 'impostor' : 'civilian';
    p.vote = null;
    p.ws?.send(JSON.stringify({
      type: 'gameStart',
      role: p.role,
      word: p.role === 'civilian' ? word : hint
    }));
  });

  broadcast(lobby, getState(lobby));
}

/* ================= WEBSOCKET ================= */

wss.on('connection', ws => {
  let lobby, player;

  ws.on('message', raw => {
    const msg = JSON.parse(raw);

    // JOIN LOBBY
    if (msg.type === 'joinLobby') {
      const id = msg.lobbyId || Math.floor(1000 + Math.random() * 9000).toString();
      lobby = lobbies[id] ||= { id, hostId: msg.playerId, phase: PHASES.LOBBY, players: [] };

      player = lobby.players.find(p => p.id === msg.playerId);
      if (!player) {
        player = { id: msg.playerId, name: msg.name, ws, connected: true, spectator: lobby.phase !== PHASES.LOBBY };
        lobby.players.push(player);
      } else {
        player.ws = ws;
        player.connected = true;
      }

      ws.send(JSON.stringify({ type: 'lobbyAssigned', lobbyId: id, hostId: lobby.hostId }));
      broadcast(lobby, getState(lobby));
    }

    if (!player || !lobby) return;
    player.lastActionAt = Date.now();

    // START GAME (only host)
    if (msg.type === 'startGame' && player.id === lobby.hostId && lobby.phase === PHASES.LOBBY) {
      if (lobby.players.filter(p => !p.spectator).length >= 3) startGame(lobby);
    }

    // SUBMIT WORD
    if (msg.type === 'submitWord') {
      if (lobby.players[lobby.turn]?.id !== player.id) return;

      const entry = { name: player.name, word: msg.word };
      (lobby.phase === PHASES.ROUND1 ? lobby.round1 : lobby.round2).push(entry);

      lobby.turn++;
      lobby.turnStartedAt = Date.now();

      if (lobby.turn >= lobby.players.filter(p => !p.spectator).length) {
        lobby.turn = 0;
        lobby.phase = lobby.phase === PHASES.ROUND1 ? PHASES.ROUND2 : PHASES.VOTING;
      }

      if (lobby.phase === PHASES.VOTING) {
        broadcast(lobby, { type: 'startVoting', players: lobby.players.filter(p => !p.spectator).map(p => p.name) });
      } else {
        broadcast(lobby, getState(lobby));
      }
    }

    // VOTE
    if (msg.type === 'vote') {
      if (msg.vote === player.name) return;
      player.vote = msg.vote;

      if (lobby.players.filter(p => !p.spectator).every(p => p.vote)) {
        lobby.phase = PHASES.RESULTS;
        broadcast(lobby, {
          type: 'gameEnd',
          roles: lobby.players.map(p => ({ name: p.name, role: p.role })),
          votes: Object.fromEntries(lobby.players.map(p => [p.name, p.vote])),
          secretWord: lobby.word,
          hint: lobby.hint
        });
      }
    }

    // RESTART
    if (msg.type === 'restart') {
      lobby.players.forEach(p => p.vote = null);
      lobby.players.forEach(p => p.spectator = false);
      startGame(lobby);
    }

    // EXIT LOBBY
    if (msg.type === 'exit') {
      lobby.players = lobby.players.filter(p => p.id !== player.id);
      if (player.id === lobby.hostId) migrateHost(lobby);
      ws.send(JSON.stringify({ type: 'exited' }));
      broadcast(lobby, getState(lobby));
    }
  });

  ws.on('close', () => {
    if (!player || !lobby) return;
    player.connected = false;
    player.disconnectedAt = Date.now();
    if (player.id === lobby.hostId) migrateHost(lobby);
    broadcast(lobby, getState(lobby));
  });
});

/* ================= AFK HANDLER ================= */
setInterval(() => {
  Object.values(lobbies).forEach(lobby => {
    if (![PHASES.ROUND1, PHASES.ROUND2, PHASES.VOTING].includes(lobby.phase)) return;
    const activePlayers = lobby.players.filter(p => !p.spectator);
    const current = activePlayers[lobby.turn];
    if (!current) return;

    if (Date.now() - lobby.turnStartedAt < TURN_TIMEOUT) return;

    // Auto action
    if (lobby.phase === PHASES.VOTING) {
      current.vote = null;
    } else {
      (lobby.phase === PHASES.ROUND1 ? lobby.round1 : lobby.round2).push({ name: current.name, word: '...' });
    }

    lobby.turn++;
    lobby.turnStartedAt = Date.now();

    if (lobby.turn >= activePlayers.length) {
      lobby.turn = 0;
      lobby.phase = lobby.phase === PHASES.ROUND1 ? PHASES.ROUND2 : PHASES.VOTING;
    }

    broadcast(lobby, getState(lobby));
  });
}, 1000);

/* ================= RECONNECT CLEANUP ================= */
setInterval(() => {
  const now = Date.now();
  Object.values(lobbies).forEach(lobby => {
    lobby.players = lobby.players.filter(p => p.connected || now - (p.disconnectedAt||0) < RECONNECT_TIMEOUT);
  });
}, 5000);