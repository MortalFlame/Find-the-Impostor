const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = process.env.FRONTEND_DIR || '../frontend';
app.use(express.static(FRONTEND_DIR));

const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

const wss = new WebSocketServer({ server });

// Load words
const WORDS_FILE = process.env.WORDS_FILE || __dirname + '/words.json';
const words = JSON.parse(fs.readFileSync(WORDS_FILE, 'utf-8'));

// Lobby structure: lobbyId -> { players: [], phase, secretWord, hint }
let lobbies = {};

// Helper
function getRandomWord() {
    const index = Math.floor(Math.random() * words.length);
    return words[index];
}

function broadcast(lobbyId, data) {
    lobbies[lobbyId].players.forEach(p => {
        if (p.ws.readyState === p.ws.OPEN) p.ws.send(JSON.stringify(data));
    });
}

// WebSocket connection
wss.on('connection', (ws) => {
    let currentLobby = null;
    let playerName = null;

    ws.on('message', (message) => {
        const msg = JSON.parse(message);

        switch (msg.type) {
            case 'joinLobby':
                playerName = msg.name;
                let lobbyId = msg.lobbyId;

                // Assign random 4-digit lobby code if none provided
                if (!lobbyId) {
                    lobbyId = Math.floor(1000 + Math.random() * 9000).toString();
                    ws.send(JSON.stringify({ type: 'lobbyAssigned', lobbyId }));
                }

                if (!lobbies[lobbyId]) {
                    lobbies[lobbyId] = { players: [], phase: 'lobby' };
                }
                currentLobby = lobbyId;
                lobbies[lobbyId].players.push({ name: playerName, ws, role: '', submission: '', vote: '' });

                broadcast(currentLobby, { type: 'lobbyUpdate', players: lobbies[currentLobby].players.map(p => p.name) });
                break;

            case 'startGame':
                if (!currentLobby) return;
                const lobby = lobbies[currentLobby];
                if (lobby.players.length < 3) return;

                // Assign roles
                const impostorIndex = Math.floor(Math.random() * lobby.players.length);
                lobby.players.forEach((p, i) => p.role = (i === impostorIndex) ? 'impostor' : 'civilian');

                // Assign secret word
                const wordPair = getRandomWord();
                lobby.secretWord = wordPair.word;
                lobby.hint = wordPair.hint;

                lobby.phase = 'round1';
                lobby.players.forEach(p => {
                    p.ws.send(JSON.stringify({
                        type: 'gameStart',
                        role: p.role,
                        word: p.role === 'civilian' ? lobby.secretWord : lobby.hint
                    }));
                });
                break;

            case 'submitWord':
                if (!currentLobby) return;
                const lobby1 = lobbies[currentLobby];
                const player1 = lobby1.players.find(p => p.ws === ws);
                if (!player1) return;
                player1.submission = msg.word;

                if (lobby1.players.every(p => p.submission)) {
                    broadcast(currentLobby, {
                        type: 'roundResult',
                        round: lobby1.phase,
                        submissions: lobby1.players.map(p => ({ name: p.name, word: p.submission }))
                    });

                    if (lobby1.phase === 'round1') {
                        lobby1.phase = 'round2';
                        lobby1.players.forEach(p => p.submission = '');
                    } else if (lobby1.phase === 'round2') {
                        lobby1.phase = 'voting';
                        lobby1.players.forEach(p => p.submission = '');
                        broadcast(currentLobby, { type: 'startVoting', players: lobby1.players.map(p => p.name) });
                    }
                }
                break;

            case 'vote':
                if (!currentLobby) return;
                const lobby2 = lobbies[currentLobby];
                const player2 = lobby2.players.find(p => p.ws === ws);
                player2.vote = msg.vote;

                if (lobby2.players.every(p => p.vote)) {
                    const votesCount = {};
                    lobby2.players.forEach(p => votesCount[p.vote] = (votesCount[p.vote] || 0) + 1);

                    let maxVotes = 0;
                    let selected = '';
                    for (const name in votesCount) {
                        if (votesCount[name] > maxVotes) {
                            maxVotes = votesCount[name];
                            selected = name;
                        }
                    }

                    const impostor = lobby2.players.find(p => p.role === 'impostor').name;
                    const civiliansWin = selected === impostor;

                    broadcast(currentLobby, {
                        type: 'gameEnd',
                        impostor,
                        secretWord: lobby2.secretWord,
                        selected,
                        civiliansWin
                    });

                    // Reset for next game
                    lobby2.phase = 'lobby';
                    lobby2.players.forEach(p => { p.role = ''; p.submission = ''; p.vote = ''; });
                }
                break;
        }
    });

    ws.on('close', () => {
        if (!currentLobby) return;
        const lobby = lobbies[currentLobby];
        lobby.players = lobby.players.filter(p => p.ws !== ws);
        broadcast(currentLobby, { type: 'lobbyUpdate', players: lobby.players.map(p => p.name) });
    });
});
