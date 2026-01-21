let ws = null;
let lobbyId = '';
let playerName = '';

const joinBtn = document.getElementById('joinBtn');
const startBtn = document.getElementById('startBtn');
const nicknameInput = document.getElementById('nickname');
const lobbyInput = document.getElementById('lobbyId');
const playersList = document.getElementById('playersList');

const lobbyScreen = document.getElementById('lobbyScreen');
const gameScreen = document.getElementById('gameScreen');
const roleInfo = document.getElementById('roleInfo');
const wordPrompt = document.getElementById('wordPrompt');
const wordInput = document.getElementById('wordInput');
const submitWordBtn = document.getElementById('submitWordBtn');
const roundSubmissions = document.getElementById('roundSubmissions');
const votingDiv = document.getElementById('voting');
const voteButtonsDiv = document.getElementById('voteButtons');
const resultsDiv = document.getElementById('results');

joinBtn.onclick = () => {
    playerName = nicknameInput.value.trim();
    lobbyId = lobbyInput.value.trim();
    if (!playerName || !lobbyId) return;

    ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}`);
    ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'joinLobby', name: playerName, lobbyId }));
    };
    ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.type === 'lobbyUpdate') {
            playersList.innerHTML = '';
            data.players.forEach(p => {
                const div = document.createElement('div');
                div.textContent = p;
                playersList.appendChild(div);
            });
            startBtn.disabled = data.players.length < 3;
        } else if (data.type === 'gameStart') {
            lobbyScreen.style.display = 'none';
            gameScreen.style.display = 'block';
            roleInfo.textContent = `Role: ${data.role}`;
            wordPrompt.textContent = `Word: ${data.word}`;
        } else if (data.type === 'roundResult') {
            roundSubmissions.innerHTML = '<h3>Submissions:</h3>';
            data.submissions.forEach(s => {
                const div = document.createElement('div');
                div.textContent = `${s.name}: ${s.word}`;
                roundSubmissions.appendChild(div);
            });
            if (data.submissions[0].name === playerName) {
                votingDiv.style.display = 'block';
                voteButtonsDiv.innerHTML = '';
                data.submissions.forEach(s => {
                    if (s.name !== playerName) {
                        const btn = document.createElement('button');
                        btn.textContent = s.name;
                        btn.onclick = () => {
                            ws.send(JSON.stringify({ type: 'vote', vote: s.name }));
                        };
                        voteButtonsDiv.appendChild(btn);
                    }
                });
            }
        } else if (data.type === 'gameEnd') {
            resultsDiv.style.display = 'block';
            resultsDiv.innerHTML = `
                <h3>Game Over</h3>
                <p>Impostor: ${data.impostor}</p>
                <p>Secret Word: ${data.secretWord}</p>
                <p>${data.civiliansWin ? 'Civilians Win!' : 'Impostor Wins!'}</p>
            `;
        }
    };
};

startBtn.onclick = () => {
    ws.send(JSON.stringify({ type: 'startGame' }));
};

submitWordBtn.onclick = () => {
    const word = wordInput.value.trim();
    if (!word) return;
    ws.send(JSON.stringify({ type: 'submitWord', word }));
    wordInput.value = '';
};
