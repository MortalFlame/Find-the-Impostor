const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = '../frontend';

// Serve frontend files
app.use(express.static(FRONTEND_DIR));

const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// WebSocket setup
const wss = new WebSocketServer({ server });

// Load word list
const words = JSON.parse(fs.readFileSync(__dirname + '/words.json', 'utf-8'));

let lobbies = {}; // { lobbyId: { players: [], phase: '', secretWord: '', impostor: '' } }

function getRandomWord() {
    const index = Math.floor(Math.random() * words.length);
    return words[index];
}

function broadcast(lobbyId, data) {
    lobbies[lobbyId].players.forEach(p => {
        if (p.ws.readyState === p.ws.OPEN) {
            p.ws.send(JSON.stringify(data));
        }
    });
}

wss.on('connection', (ws) => {
    let currentLobby = null;
    let playerName = null;

    ws.on('message', (message) => {
        const msg = JSON.parse(message);

        switch (msg.type) {
            case 'joinLobby':
                const { lobbyId, name } = msg;
                playerName = name;
                if (!lobbies[lobbyId]) {
                    lobbies[lobbyId] = { players: [], phase: 'lobby' };
                }
                currentLobby = lobbyId;
                lobbies[lobbyId].players.push({ name, ws, role: '', submission: '', vote: '' });
                broadcast(currentLobby, { type: 'lobbyUpdate', players: lobbies[lobbyId].players.map(p => p.name) });
                break;

            case 'startGame':
                if (!currentLobby) return;
                const lobby = lobbies[currentLobby];
                if (lobby.players.length < 3) return;

                // Assign roles
                const impostorIndex = Math.floor(Math.random() * lobby.players.length);
                lobby.players.forEach((p, i) => {
                    if (i === impostorIndex) p.role = 'impostor';
                    else p.role = 'civilian';
                });

                // Assign secret word
                const wordPair = getRandomWord();
                lobby.secretWord = wordPair.word;
                lobby.hint = wordPair.hint;

                lobby.phase = 'round1';
                lobby.players.forEach(p => {
                    const payload = {
                        type: 'gameStart',
                        role: p.role,
                        word: p.role === 'civilian' ? lobby.secretWord : lobby.hint
                    };
                    p.ws.send(JSON.stringify(payload));
                });
                break;

            case 'submitWord':
                if (!currentLobby) return;
                const lobby1 = lobbies[currentLobby];
                const player1 = lobby1.players.find(p => p.ws === ws);
                if (!player1) return;
                player1.submission = msg.word;

                // Check if all submitted
                if (lobby1.players.every(p => p.submission)) {
                    broadcast(currentLobby, {
                        type: 'roundResult',
                        submissions: lobby1.players.map(p => ({ name: p.name, word: p.submission }))
                    });

                    if (lobby1.phase === 'round1') lobby1.phase = 'round2';
                    else lobby1.phase = 'voting';

                    lobby1.players.forEach(p => p.submission = '');
                }
                break;

            case 'vote':
                if (!currentLobby) return;
                const lobby2 = lobbies[currentLobby];
                const player2 = lobby2.players.find(p => p.ws === ws);
                player2.vote = msg.vote;

                if (lobby2.players.every(p => p.vote)) {
                    const votesCount = {};
                    lobby2.players.forEach(p => {
                        votesCount[p.vote] = (votesCount[p.vote] || 0) + 1;
                    });

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

                    // Reset for new game
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
