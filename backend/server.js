const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.static('frontend'));

const PORT = process.env.PORT || 10000;
const server = app.listen(PORT, () => console.log('Server running'));
const wss = new WebSocketServer({ server });

const words = JSON.parse(fs.readFileSync('./words.json', 'utf8'));

const RECONNECT_TIMEOUT = 30000;

const PHASES = {
  LOBBY: 'lobby',
  ROUND1: 'round1',
  ROUND2: 'round2',
  VOTING: 'voting',
  RESULTS: 'results'
};

let lobbies = {};

function randomWord() {
  return words[crypto.randomInt(words.length)];
}

function broadcast(lobby, data) {
  lobby.players.forEach(p => {
    if (p.ws?.readyState === 1) {
      p.ws.send(JSON.stringify(data));
    }
  });
}

function publicLobbyData(lobby) {
  return {
    id: lobby.id,
    count: lobby.players.length,
    phase: lobby.phase
  };
}

function broadcastLobbyList() {
  const list = Object.values(lobbies).map(publicLobbyData);
  wss.clients.forEach(ws => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'lobbyList', lobbies: list }));
    }
  });
}

function createLobby(host) {
  const id = Math.floor(1000 + Math.random() * 9000).toString();
  lobbies[id] = {
    id,
    hostId: host.id,
    phase: PHASES.LOBBY,
    players: [],
    spectators: [],
    word: null,
    hint: null,
    turn: 0,
    round1: [],
    round2: [],
    lastProgress: Date.now()
  };
  return lobbies[id];
}

function assignRoles(lobby) {
  const idx = crypto.randomInt(lobby.players.length);
  const { word, hint } = randomWord();
  lobby.word = word;
  lobby.hint = hint;

  lobby.players.forEach((p, i) => {
    p.role = i === idx ? 'impostor' : 'civilian';
    p.vote = null;
    p.ws.send(JSON.stringify({
      type: 'gameStart',
      word: p.role === 'civilian' ? word : hint
    }));
  });
}

function startGame(lobby) {
  lobby.phase = PHASES.ROUND1;
  lobby.turn = 0;
  lobby.round1 = [];
  lobby.round2 = [];
  lobby.lastProgress = Date.now();
  assignRoles(lobby);

  broadcast(lobby, {
    type: 'state',
    lobby
  });
}

function advancePhase(lobby) {
  lobby.lastProgress = Date.now();
  if (lobby.phase === PHASES.ROUND1) lobby.phase = PHASES.ROUND2;
  else if (lobby.phase === PHASES.ROUND2) lobby.phase = PHASES.VOTING;
  else if (lobby.phase === PHASES.VOTING) lobby.phase = PHASES.RESULTS;
}

function migrateHost(lobby) {
  const next = lobby.players.find(p => p.connected);
  if (next) lobby.hostId = next.id;
}

setInterval(() => {
  const now = Date.now();
  Object.values(lobbies).forEach(lobby => {
    lobby.players = lobby.players.filter(p => {
      if (!p.connected && now - p.disconnectedAt > RECONNECT_TIMEOUT) {
        return false;
      }
      return true;
    });

    if (!lobby.players.find(p => p.id === lobby.hostId)) {
      migrateHost(lobby);
    }
  });
  broadcastLobbyList();
}, 5000);

wss.on('connection', ws => {
  let player, lobby;

  ws.on('message', raw => {
    const msg = JSON.parse(raw);

    if (msg.type === 'join') {
      const id = msg.lobbyId || null;
      player = {
        id: msg.playerId,
        name: msg.name,
        ws,
        connected: true
      };

      if (id && lobbies[id]) lobby = lobbies[id];
      else lobby = createLobby(player);

      const existing = lobby.players.find(p => p.id === player.id);
      if (existing) {
        existing.ws = ws;
        existing.connected = true;
        ws.send(JSON.stringify({ type: 'state', lobby }));
        return;
      }

      if (lobby.phase !== PHASES.LOBBY) {
        lobby.spectators.push(player);
        ws.send(JSON.stringify({ type: 'spectator' }));
      } else {
        lobby.players.push(player);
      }

      ws.send(JSON.stringify({ type: 'joined', lobbyId: lobby.id }));
      broadcast(lobby, { type: 'players', players: lobby.players });
      broadcastLobbyList();
    }

    if (!player || !lobby) return;

    if (msg.type === 'exit') {
      lobby.players = lobby.players.filter(p => p.id !== player.id);
      ws.send(JSON.stringify({ type: 'exited' }));
      broadcast(lobby, { type: 'players', players: lobby.players });
    }

    if (msg.type === 'start' && player.id === lobby.hostId) {
      if (lobby.players.length >= 3) startGame(lobby);
    }

    if (msg.type === 'word') {
      if (lobby.players[lobby.turn]?.id !== player.id) return;

      const entry = { name: player.name, word: msg.word };
      (lobby.phase === PHASES.ROUND1 ? lobby.round1 : lobby.round2).push(entry);

      lobby.turn++;
      if (lobby.turn >= lobby.players.length) {
        lobby.turn = 0;
        advancePhase(lobby);
      }

      broadcast(lobby, { type: 'state', lobby });
    }

    if (msg.type === 'vote') {
      player.vote = msg.vote;
      if (lobby.players.every(p => p.vote)) {
        advancePhase(lobby);
        broadcast(lobby, {
          type: 'results',
          word: lobby.word,
          hint: lobby.hint,
          players: lobby.players
        });
      }
    }

    if (msg.type === 'restart') {
      lobby.players.push(...lobby.spectators);
      lobby.spectators = [];
      startGame(lobby);
    }
  });

  ws.on('close', () => {
    if (player) {
      player.connected = false;
      player.disconnectedAt = Date.now();
      broadcast(lobby, { type: 'players', players: lobby.players });
    }
  });
});