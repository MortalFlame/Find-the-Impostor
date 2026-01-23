const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.static('frontend'));

const PORT = process.env.PORT || 10000;
const server = app.listen(PORT, () => console.log('Server running on', PORT));
const wss = new WebSocketServer({ server });

const words = JSON.parse(fs.readFileSync(__dirname + '/words.json', 'utf8'));

const STATES = {
  LOBBY: 'lobby',
  ROUND1: 'round1',
  ROUND2: 'round2',
  VOTING: 'voting',
  RESULTS: 'results'
};

const RECONNECT_TIMEOUT = 30000;

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
    if (p.ws?.readyState === 1) {
      p.ws.send(JSON.stringify(data));
    }
  });
}

function assignHost(lobby) {
  const next = lobby.players.find(p => p.connected && !p.spectator);
  lobby.hostId = next?.id || null;
}

function sendLobbyState(lobby) {
  broadcast(lobby, {
    type: 'lobbyUpdate',
    players: lobby.players.map(p => ({
      name: p.name,
      connected: p.connected
    })),
    hostId: lobby.hostId,
    phase: lobby.phase
  });
}

function startGame(lobby) {
  if (lobby.players.filter(p => !p.spectator).length < 3) return;

  lobby.phase = STATES.ROUND1;
  lobby.turn = 0;
  lobby.round1 = [];
  lobby.round2 = [];
  lobby.restartReady = [];

  const impostorIndex = crypto.randomInt(lobby.players.length);
  const { word, hint } = getRandomWord();

  lobby.word = word;
  lobby.hint = hint;

  lobby.players.forEach((p, i) => {
    p.role = i === impostorIndex ? 'impostor' : 'civilian';
    p.vote = '';
    p.spectator = false;

    p.ws?.send(JSON.stringify({
      type: 'gameStart',
      role: p.role,
      word: p.role === 'civilian' ? word : hint
    }));
  });

  broadcast(lobby, {
    type: 'turnUpdate',
    phase: lobby.phase,
    round1: [],
    round2: [],
    currentPlayer: lobby.players[0].name
  });
}

function advanceTurn(lobby) {
  do {
    lobby.turn++;
    if (lobby.turn >= lobby.players.length) {
      lobby.turn = 0;
      if (lobby.phase === STATES.ROUND1) lobby.phase = STATES.ROUND2;
      else if (lobby.phase === STATES.ROUND2) lobby.phase = STATES.VOTING;
    }
  } while (!lobby.players[lobby.turn].connected);

  if (lobby.phase === STATES.VOTING) {
    broadcast(lobby, {
      type: 'startVoting',
      players: lobby.players.filter(p => !p.spectator).map(p => p.name)
    });
    return;
  }

  broadcast(lobby, {
    type: 'turnUpdate',
    phase: lobby.phase,
    round1: lobby.round1,
    round2: lobby.round2,
    currentPlayer: lobby.players[lobby.turn].name
  });
}

wss.on('connection', ws => {
  let lobby, player;

  ws.on('message', raw => {
    const msg = JSON.parse(raw);

    if (msg.type === 'getLobbies') {
      ws.send(JSON.stringify({
        type: 'lobbyList',
        lobbies: Object.values(lobbies)
          .filter(l => l.phase === STATES.LOBBY)
          .map(l => ({
            id: l.id,
            count: l.players.length
          }))
      }));
      return;
    }

    if (msg.type === 'joinLobby') {
      const id = msg.lobbyId || crypto.randomInt(1000, 9999).toString();
      if (!lobbies[id]) {
        lobbies[id] = {
          id,
          players: [],
          phase: STATES.LOBBY,
          hostId: null
        };
      }

      lobby = lobbies[id];
      player = lobby.players.find(p => p.id === msg.playerId);

      if (!player) {
        player = {
          id: msg.playerId,
          name: msg.name,
          ws,
          connected: true,
          spectator: lobby.phase !== STATES.LOBBY
        };
        lobby.players.push(player);
        if (!lobby.hostId) lobby.hostId = player.id;
      } else {
        player.ws = ws;
        player.connected = true;
        clearTimeout(player.timer);
      }

      ws.send(JSON.stringify({ type: 'lobbyAssigned', lobbyId: id }));
      sendLobbyState(lobby);
      return;
    }

    if (!player || !lobby) return;

    if (msg.type === 'startGame' && player.id === lobby.hostId) {
      startGame(lobby);
    }

    if (msg.type === 'submitWord') {
      if (lobby.players[lobby.turn].id !== player.id) return;
      const entry = { name: player.name, word: msg.word };
      lobby.phase === STATES.ROUND1
        ? lobby.round1.push(entry)
        : lobby.round2.push(entry);
      advanceTurn(lobby);
    }

    if (msg.type === 'vote') {
      if (msg.vote === player.name) return;
      player.vote = msg.vote;

      if (lobby.players.filter(p => !p.spectator).every(p => p.vote)) {
        lobby.phase = STATES.RESULTS;
        broadcast(lobby, {
          type: 'gameEnd',
          roles: lobby.players.map(p => ({ name: p.name, role: p.role })),
          votes: Object.fromEntries(lobby.players.map(p => [p.name, p.vote])),
          secretWord: lobby.word,
          hint: lobby.hint
        });
      }
    }

    if (msg.type === 'restart') {
      lobby.restartReady.push(player.id);
      if (lobby.restartReady.length === lobby.players.length) {
        startGame(lobby);
      }
    }
  });

  ws.on('close', () => {
    if (!player || !lobby) return;
    player.connected = false;

    player.timer = setTimeout(() => {
      if (!player.connected && player.id === lobby.hostId) {
        assignHost(lobby);
        sendLobbyState(lobby);
      }
      if (lobby.players[lobby.turn]?.id === player.id) {
        advanceTurn(lobby);
      }
    }, RECONNECT_TIMEOUT);

    sendLobbyState(lobby);
  });
});