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

const words = JSON.parse(fs.readFileSync(__dirname + '/words.json', 'utf8'));
let lobbies = {};
let usedIndexes = [];

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

// Clean state machine approach
function startGame(lobby) {
  if (lobby.players.filter(p => !p.spectator).length < 3) return;

  lobby.phase = 'round1';
  lobby.turn = 0;
  lobby.round1 = [];
  lobby.round2 = [];
  lobby.restartReady = [];

  const impostorIndex = crypto.randomInt(lobby.players.length);
  const { word, hint } = getRandomWord();
  lobby.word = word;
  lobby.hint = hint;

  lobby.players.forEach((p, i) => {
    if (!p.spectator) {
      p.role = i === impostorIndex ? 'impostor' : 'civilian';
      p.vote = '';
      p.ws.send(JSON.stringify({
        type: 'gameStart',
        role: p.role,
        word: p.role === 'civilian' ? word : hint
      }));
    }
  });

  broadcast(lobby, {
    type: 'turnUpdate',
    phase: lobby.phase,
    round1: [],
    round2: [],
    currentPlayer: lobby.players.find(p => !p.spectator).name
  });
}

// Reconnect timeout: 60s to rejoin
const RECONNECT_TIMEOUT = 60000;

wss.on('connection', ws => {
  let lobbyId, player;

  ws.on('message', raw => {
    const msg = JSON.parse(raw);

    if (msg.type === 'joinLobby') {
      lobbyId = msg.lobbyId || Math.floor(1000 + Math.random() * 9000).toString();
      if (!lobbies[lobbyId]) lobbies[lobbyId] = { players: [], phase: 'lobby', host: null };

      const lobby = lobbies[lobbyId];
      let existing = lobby.players.find(p => p.id === msg.playerId);

      if (!existing) {
        player = { id: msg.playerId, name: msg.name, ws, spectator: false, status: 'online' };
        lobby.players.push(player);
      } else {
        player = existing;
        player.ws = ws;
        player.status = 'online';
      }

      if (!lobby.host) lobby.host = player.id; // first person is host

      ws.send(JSON.stringify({ type: 'lobbyAssigned', lobbyId, host: lobby.host }));
      broadcastLobbyUpdate(lobby);
      return;
    }

    if (!player) return;
    const lobby = lobbies[lobbyId];

    if (msg.type === 'exitLobby') {
      lobby.players = lobby.players.filter(p => p.id !== player.id);
      if (lobby.host === player.id && lobby.players.length > 0) lobby.host = lobby.players[0].id;
      broadcastLobbyUpdate(lobby);
      return;
    }

    if (msg.type === 'startGame' && lobby.host === player.id && lobby.phase === 'lobby') {
      startGame(lobby);
    }

    if (msg.type === 'submitWord') {
      if (lobby.players.filter(p => !p.spectator)[lobby.turn].id !== player.id) return;
      const entry = { name: player.name, word: msg.word };
      lobby.phase === 'round1' ? lobby.round1.push(entry) : lobby.round2.push(entry);
      lobby.turn++;
      const activePlayers = lobby.players.filter(p => !p.spectator);
      if (lobby.turn >= activePlayers.length) {
        lobby.turn = 0;
        if (lobby.phase === 'round1') lobby.phase = 'round2';
        else lobby.phase = 'voting';
      }

      if (lobby.phase === 'voting') {
        broadcast(lobby, {
          type: 'startVoting',
          players: activePlayers.map(p => p.name)
        });
        return;
      }

      broadcast(lobby, {
        type: 'turnUpdate',
        phase: lobby.phase,
        round1: lobby.round1,
        round2: lobby.round2,
        currentPlayer: activePlayers[lobby.turn].name
      });
    }

    if (msg.type === 'vote') {
      if (msg.vote === player.name) return;
      player.vote = msg.vote;
      if (lobby.players.filter(p => !p.spectator).every(p => p.vote)) {
        broadcast(lobby, {
          type: 'gameEnd',
          roles: lobby.players.map(p => ({ name: p.name, role: p.role || 'spectator' })),
          votes: Object.fromEntries(lobby.players.map(p => [p.name, p.vote])),
          secretWord: lobby.word,
          hint: lobby.hint
        });
        lobby.phase = 'results';
      }
    }

    if (msg.type === 'restart') {
      lobby.restartReady.push(player.id);
      if (lobby.restartReady.length === lobby.players.length) startGame(lobby);
    }
  });

  ws.on('close', () => {
    if (!player) return;
    player.status = 'offline';
    const lobby = lobbies[lobbyId];
    broadcastLobbyUpdate(lobby);

    // host migration
    if (lobby.host === player.id) {
      const newHost = lobby.players.find(p => p.status === 'online');
      if (newHost) lobby.host = newHost.id;
      broadcastLobbyUpdate(lobby);
    }

    // auto remove if not reconnected in RECONNECT_TIMEOUT
    setTimeout(() => {
      if (player.status === 'offline') {
        lobby.players = lobby.players.filter(p => p.id !== player.id);
        broadcastLobbyUpdate(lobby);
      }
    }, RECONNECT_TIMEOUT);
  });
});

function broadcastLobbyUpdate(lobby) {
  broadcast(lobby, {
    type: 'lobbyUpdate',
    players: lobby.players.map(p => ({ name: p.name, status: p.status })),
    host: lobby.host,
    phase: lobby.phase
  });
}