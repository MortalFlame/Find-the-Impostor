const wsUrl = location.origin.replace(/^http/, 'ws');
let ws;

const nickname = document.getElementById('nickname');
const lobbyId = document.getElementById('lobbyId');
const join = document.getElementById('join');
const exitBtn = document.getElementById('exit');
const start = document.getElementById('start');
const playersEl = document.getElementById('players');
const statusEl = document.getElementById('status');

let playerId = localStorage.getItem('pid') || crypto.randomUUID();
localStorage.setItem('pid', playerId);

function connect() {
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'join',
      name: nickname.value,
      lobbyId: lobbyId.value,
      playerId
    }));
  };

  ws.onmessage = e => {
    const d = JSON.parse(e.data);

    if (d.type === 'joined') lobbyId.value = d.lobbyId;

    if (d.type === 'players') {
      playersEl.innerHTML = d.players.map(p =>
        `${p.name} <span class="dot ${p.connected ? 'green':'red'}"></span>`
      ).join('<br>');
    }

    if (d.type === 'state') {
      start.disabled = d.lobby.hostId !== playerId;
    }

    if (d.type === 'exited') location.reload();
  };
}

join.onclick = connect;
exitBtn.onclick = () => ws.send(JSON.stringify({ type: 'exit' }));
start.onclick = () => ws.send(JSON.stringify({ type: 'start' }));