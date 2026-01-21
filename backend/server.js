const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT;
app.use(express.static('frontend'));

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const wss = new WebSocketServer({ server });

let words = JSON.parse(fs.readFileSync(__dirname + '/words.json', 'utf-8'))
  .map(w => ({
    word: w.word[0].toUpperCase() + w.word.slice(1),
    hint: w.hint[0].toUpperCase() + w.hint.slice(1)
  }));

let lobbies = {};
let usedWordIndexes = [];

function getRandomWord() {
  if (usedWordIndexes.length >= words.length) usedWordIndexes = [];
  const available = words.map((_, i) => i).filter(i => !usedWordIndexes.includes(i));
  const index = available[crypto.randomInt(available.length)];
  usedWordIndexes.push(index);
  return words[index];
}

function broadcast(lobby, data) {
  lobby.players.forEach(p => {
    if (p.ws?.readyState === p.ws.OPEN) {
      p.ws.send(JSON.stringify(data));
    }
  });
}

function startGame(lobby) {
  if (lobby.players.filter(p => !p.disconnected).length < 3) return;

  lobby.phase = 'round1';
  lobby.turnIndex = 0;
  lobby.round1 = [];
  lobby.round2 = [];
  lobby.restartReady = [];

  const impostorIndex = crypto.randomInt(lobby.players.length);
  const { word, hint } = getRandomWord();

  lobby.secretWord = word;
  lobby.hint = hint;

  lobby.players.forEach((p, i) => {
    p.role = i === impostorIndex ? 'impostor' : 'civilian';
    p.vote = '';
    if (p.ws?.readyState === p.ws.OPEN) {
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
    currentPlayer: lobby.players[lobby.turnIndex].name
  });
}

function advanceTurn(lobby) {
  let safety = 0;
  do {
    lobby.turnIndex = (lobby.turnIndex + 1) % lobby.players.length;
    safety++;
    if (safety > lobby.players.length) return false;
  } while (lobby.players[lobby.turnIndex].disconnected);
  return true;
}

wss.on('connection', ws => {
  let lobbyId, playerId, player;

  ws.on('message', msg => {
    const data = JSON.parse(msg);

    if (data.type === 'joinLobby') {
      playerId = data.playerId;
      lobbyId = data.lobbyId || Math.floor(1000 + Math.random() * 9000).toString();

      if (!lobbies[lobbyId]) {
        lobbies[lobbyId] = {
          id: lobbyId,
          phase: 'lobby',
          players: [],
          round1: [],
          round2: [],
          restartReady: []
        };
      }

      const lobby = lobbies[lobbyId];
      player = lobby.players.find(p => p.id === playerId);

      if (player) {
        player.ws = ws;
        player.disconnected = false;

        ws.send(JSON.stringify({
          type: 'turnUpdate',
          phase: lobby.phase,
          round1: lobby.round1,
          round2: lobby.round2,
          currentPlayer: lobby.players[lobby.turnIndex]?.name || null
        }));
      } else {
        player = { id: playerId, name: data.name, ws, disconnected: false };
        lobby.players.push(player);
      }

      ws.send(JSON.stringify({ type: 'lobbyAssigned', lobbyId }));
      broadcast(lobby, { type: 'lobbyUpdate', players: lobby.players.map(p => p.name) });
    }

    if (!player || !lobbies[lobbyId]) return;
    const lobby = lobbies[lobbyId];

    if (data.type === 'startGame') {
      if (lobby.phase === 'lobby') startGame(lobby);
    }

    if (data.type === 'submitWord') {
      if (lobby.players[lobby.turnIndex]?.id !== playerId) return;

      const entry = { name: player.name, word: data.word };
      lobby.phase === 'round1' ? lobby.round1.push(entry) : lobby.round2.push(entry);

      if (!advanceTurn(lobby)) return;

      if (lobby.turnIndex === 0) {
        lobby.phase = lobby.phase === 'round1' ? 'round2' : 'voting';
        if (lobby.phase === 'voting') {
          broadcast(lobby, { type: 'startVoting', players: lobby.players.map(p => p.name) });
          return;
        }
      }

      broadcast(lobby, {
        type: 'turnUpdate',
        phase: lobby.phase,
        round1: lobby.round1,
        round2: lobby.round2,
        currentPlayer: lobby.players[lobby.turnIndex].name
      });
    }

    if (data.type === 'vote') {
      player.vote = data.vote;
      if (lobby.players.every(p => p.vote)) {
        const votes = {};
        lobby.players.forEach(p => votes[p.name] = p.vote);
        const impostor = lobby.players.find(p => p.role === 'impostor').name;

        broadcast(lobby, {
          type: 'gameEnd',
          roles: lobby.players.map(p => ({ name: p.name, role: p.role })),
          votes,
          secretWord: lobby.secretWord,
          civiliansWin: Object.values(votes).filter(v => v === impostor).length >
                        lobby.players.length / 2
        });

        lobby.phase = 'lobby';
      }
    }

    if (data.type === 'restart') {
      if (!lobby.restartReady.includes(playerId)) lobby.restartReady.push(playerId);
      const active = lobby.players.filter(p => !p.disconnected).length;
      if (lobby.restartReady.length === active) startGame(lobby);
    }
  });

  ws.on('close', () => {
    if (!player || !lobbies[lobbyId]) return;
    player.disconnected = true;

    setTimeout(() => {
      const lobby = lobbies[lobbyId];
      if (!lobby) return;
      lobby.players = lobby.players.filter(p => !p.disconnected);
      if (lobby.players.length === 0) delete lobbies[lobbyId];
    }, 15000);
  });
});