const ws = new WebSocket(location.origin.replace(/^http/, 'ws'));

const $ = id => document.getElementById(id);

const playerId = crypto.randomUUID();
let myName = '';

$('joinBtn').onclick = () => {
  myName = $('name').value;
  ws.send(JSON.stringify({
    type: 'joinLobby',
    name: myName,
    lobbyId: $('lobby').value,
    playerId
  }));
};

$('startBtn').onclick = () => ws.send(JSON.stringify({ type: 'startGame' }));

$('submitBtn').onclick = () => {
  if (!$('wordInput').value) return;
  ws.send(JSON.stringify({ type: 'submitWord', word: $('wordInput').value }));
  $('wordInput').value = '';
};

$('restartBtn').onclick = () => ws.send(JSON.stringify({ type: 'restart' }));

ws.onmessage = e => {
  const d = JSON.parse(e.data);

  if (d.type === 'lobbyAssigned') $('lobby').value = d.lobbyId;

  if (d.type === 'lobbyUpdate') {
    $('players').innerHTML = d.players.map(p => `<div>${p}</div>`).join('');
  }

  if (d.type === 'gameStart') {
    $('lobbyScreen').classList.add('hidden');
    $('gameScreen').classList.remove('hidden');

    $('roleLabel').innerText = d.role.toUpperCase();
    $('roleLabel').className = d.role;

    $('roleBg').style.backgroundImage =
      d.role === 'civilian'
        ? "url('https://images.unsplash.com/photo-1500530855697-b586d89ba3ee')"
        : "url('https://images.unsplash.com/photo-1502082553048-f009c37129b9')";

    $('secret').innerText = d.word;
  }

  if (d.type === 'turnUpdate') {
    $('turnIndicator').innerText = `Turn: ${d.currentPlayer}`;
    $('round1').innerHTML = d.round1.map(r => `<div>${r.name}: ${r.word}</div>`).join('');
    $('round2').innerHTML = d.round2.map(r => `<div>${r.name}: ${r.word}</div>`).join('');
  }

  if (d.type === 'startVoting') {
    $('voting').innerHTML = d.players
      .filter(p => p !== myName)
      .map(p => `<button onclick="vote('${p}')" class="primary">${p}</button>`)
      .join('');
  }

  if (d.type === 'gameEnd') {
    $('results').innerHTML = `
      <h3>Game Over</h3>
      <div><b>Word:</b> ${d.secretWord}</div>
      <div><b>Hint:</b> ${d.hint}</div>
      <hr>
      ${Object.entries(d.votes).map(v => `${v[0]} voted ${v[1]}`).join('<br>')}
    `;
    $('voting').innerHTML = '';
    $('restartBtn').classList.remove('hidden');
  }
};

window.vote = name => {
  ws.send(JSON.stringify({ type: 'vote', vote: name }));
};