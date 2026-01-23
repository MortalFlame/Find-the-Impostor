const wsUrl = location.origin.replace(/^http/, 'ws');
let ws;

const nickname = document.getElementById('nickname');
const join = document.getElementById('join');
const exitLobby = document.getElementById('exit');
const start = document.getElementById('start');
const players = document.getElementById('players');
const lobbyList = document.getElementById('lobbyList');

const lobbyCard = document.querySelector('.lobby-card');
const gameCard = document.querySelector('.game-card');

let lobbyId;
let isHost = false;

let playerId = localStorage.getItem('playerId') || crypto.randomUUID();
localStorage.setItem('playerId', playerId);

function connect() {
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'getLobbies' }));
  };

  ws.onmessage = e => {
    const d = JSON.parse(e.data);

    if (d.type === 'lobbyList') {
      lobbyList.innerHTML = d.lobbies
        .map(l => `<button onclick="joinLobby('${l.id}')">Lobby ${l.id} (${l.count})</button>`)
        .join('');
    }

    if (d.type === 'lobbyAssigned') {
      lobbyId = d.lobbyId;
      ws.send(JSON.stringify({
        type: 'joinLobby',
        lobbyId,
        name: nickname.value,
        playerId
      }));
    }

    if (d.type === 'lobbyUpdate') {
      players.innerHTML = d.players
        .map(p => `${p.connected ? '🟢' : '🔴'} ${p.name}`)
        .join('<br>');
      isHost = d.hostId === playerId;
      start.disabled = !isHost || d.players.length < 3;
    }
  };

  ws.onclose = () => setTimeout(connect, 2000);
}

function joinLobby(id) {
  ws.send(JSON.stringify({
    type: 'joinLobby',
    lobbyId: id,
    name: nickname.value,
    playerId
  }));
}

join.onclick = connect;
exitLobby.onclick = () => location.reload();
start.onclick = () => ws.send(JSON.stringify({ type: 'startGame' }));

connect();