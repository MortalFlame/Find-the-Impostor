let ws = null;
alert(`Your lobby code is: ${data.lobbyId}\nShare this code with friends to join.`);
lobbyInput.value = data.lobbyId;
}


if (data.type === 'lobbyUpdate') {
playersList.innerHTML = '';
data.players.forEach(p => {
const div = document.createElement('div');
div.textContent = p;
playersList.appendChild(div);
});
startBtn.disabled = data.players.length < 3;
}


if (data.type === 'gameStart') {
lobbyScreen.style.display = 'none';
gameScreen.style.display = 'block';
roleInfo.textContent = `Role: ${data.role}`;
wordPrompt.textContent = `Word: ${data.word}`;
roundSubmissions.innerHTML = '';
votingDiv.style.display = 'none';
resultsDiv.style.display = 'none';
}


if (data.type === 'roundResult') {
roundSubmissions.innerHTML = `<h3>Round ${data.round} Submissions:</h3>`;
data.submissions.forEach(s => {
const div = document.createElement('div');
div.textContent = `${s.name}: ${s.word}`;
roundSubmissions.appendChild(div);
});
}


if (data.type === 'startVoting') {
votingDiv.style.display = 'block';
voteButtonsDiv.innerHTML = '';
data.players.forEach(name => {
if (name !== playerName) {
const btn = document.createElement('button');
btn.textContent = name;
btn.onclick = () => {
ws.send(JSON.stringify({ type: 'vote', vote: name }));
Array.from(voteButtonsDiv.children).forEach(b => b.disabled = true);
};
voteButtonsDiv.appendChild(btn);
}
});
}


if (data.type === 'gameEnd') {
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
