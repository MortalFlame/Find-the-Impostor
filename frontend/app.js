let ws=null, lobbyId='', playerName='', playerId=localStorage.getItem('playerId')||crypto.randomUUID();
if(!localStorage.getItem('playerId')) localStorage.setItem('playerId',playerId);

const joinBtn=document.getElementById('joinBtn');
const startBtn=document.getElementById('startBtn');
const nicknameInput=document.getElementById('nickname');
const lobbyInput=document.getElementById('lobbyId');
const playersList=document.getElementById('playersList');
const lobbyCodeDisplay=document.getElementById('lobbyCodeDisplay');

const lobbyScreen=document.getElementById('lobbyScreen');
const gameScreen=document.getElementById('gameScreen');
const roleInfo=document.getElementById('roleInfo');
const wordPrompt=document.getElementById('wordPrompt');
const wordInput=document.getElementById('wordInput');
const submitWordBtn=document.getElementById('submitWordBtn');
const roundSubmissions=document.getElementById('roundSubmissions');
const votingDiv=document.getElementById('voting');
const voteButtonsDiv=document.getElementById('voteButtons');
const resultsDiv=document.getElementById('results');
const currentTurnDiv=document.getElementById('currentTurn');
const restartBtn=document.getElementById('restartBtn');
const countdownDiv=document.getElementById('countdown');

// Join lobby
joinBtn.onclick = () => {
    playerName = nicknameInput.value.trim();
    lobbyId = lobbyInput.value.trim();
    if(!playerName) return;

    ws = new WebSocket(`${location.origin.replace(/^http/,'ws')}`);

    ws.onopen = () => {
        ws.send(JSON.stringify({ type:'joinLobby', name:playerName, lobbyId:lobbyId||undefined, playerId }));
    };

    ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);

        if(data.type==='lobbyAssigned'){
            lobbyCodeDisplay.textContent=`Your lobby code: ${data.lobbyId}`;
            lobbyInput.value = data.lobbyId;
            lobbyId=data.lobbyId;
        }

        if(data.type==='lobbyUpdate'){
            playersList.innerHTML='';
            data.players.forEach(p=>{ const div=document.createElement('div'); div.textContent=p; playersList.appendChild(div); });
            startBtn.disabled = data.players.length<3;
        }

        if(data.type==='gameStart'){
            lobbyScreen.style.display='none';
            gameScreen.style.display='flex';
            gameScreen.style.flexDirection='column';
            roleInfo.innerHTML=`Role: <span class="${data.role==='civilian'?'green':'red'}">${data.role.charAt(0).toUpperCase()+data.role.slice(1)}</span>`;
            wordPrompt.textContent=`Word: ${data.word}`;
            roundSubmissions.innerHTML='';
            votingDiv.style.display='none';
            resultsDiv.style.display='none';
            restartBtn.style.display='none';
            countdownDiv.textContent='';
        }

        if(data.type==='turnUpdate'){
            let html='';
            if(data.round1Submissions && data.round1Submissions.length>0){
                html+='<strong>Round 1:</strong><br>';
                data.round1Submissions.forEach(s=>html+=`${s.name}: ${s.word}<br>`);
            }
            if(data.phase==='round2' && data.submissions.length>0){
                html+='<strong>Round 2:</strong><br>';
                data.submissions.forEach(s=>html+=`${s.name}: ${s.word}<br>`);
            }
            roundSubmissions.innerHTML=html;
            currentTurnDiv.textContent=data.currentPlayer?`Current turn: ${data.currentPlayer}`:'';
            wordInput.disabled=(data.currentPlayer!==playerName);
            submitWordBtn.disabled=(data.currentPlayer!==playerName);
        }

        if(data.type==='roundsSummary'){
            let html='';
            if(data.round1){ html+='<strong>Round 1:</strong><br>'; data.round1.forEach(s=>html+=`${s.name}: ${s.word}<br>`);}
            if(data.round2){ html+='<strong>Round 2:</strong><br>'; data.round2.forEach(s=>html+=`${s.name}: ${s.word}<br>`);}
            roundSubmissions.innerHTML=html;
        }

        if(data.type==='startVoting'){
            votingDiv.style.display='block';
            voteButtonsDiv.innerHTML='';
            data.players.forEach(name=>{
                if(name!==playerName){
                    const btn=document.createElement('button');
                    btn.textContent=name;
                    btn.className='voteButton';
                    btn.onclick=()=>{
                        ws.send(JSON.stringify({type:'vote',vote:name}));
                        Array.from(voteButtonsDiv.children).forEach(b=>b.disabled=true);
                    };
                    voteButtonsDiv.appendChild(btn);
                }
            });
        }

        if(data.type==='gameEnd'){
            resultsDiv.style.display='block';
            resultsDiv.innerHTML='<h3>Game Over</h3>';
            data.roles.forEach(r=>{
                const color=r.role==='civilian'?'green':'red';
                resultsDiv.innerHTML+=`<p>${r.name}: <span class="${color}">${r.role.charAt(0).toUpperCase()+r.role.slice(1)}</span></p>`;
            });
            resultsDiv.innerHTML+=`<p>Secret Word: ${data.secretWord}</p>`;
            resultsDiv.innerHTML+=`<p>${data.civiliansWin?'Civilians Win!':'Impostor Wins!'}</p>`;
            if(data.votes){
                resultsDiv.innerHTML+='<h4>Votes:</h4>';
                for(const voter in data.votes){
                    resultsDiv.innerHTML+=`<p>${voter} voted for ${data.votes[voter]}</p>`;
                }
            }
            restartBtn.style.display='inline-block';
            votingDiv.style.display='none';
        }

        if(data.type==='restartUpdate'){
            // Optionally display: who is ready to restart
        }
    };
};

// Start game
startBtn.onclick=()=>ws.send(JSON.stringify({type:'startGame'}));

// Submit word
submitWordBtn.onclick=()=>{
    const word=wordInput.value.trim();
    if(!word) return;
    ws.send(JSON.stringify({type:'submitWord',word}));
    wordInput.value='';
};

// Restart
restartBtn.onclick=()=>{
    ws.send(JSON.stringify({type:'restart'}));
    restartBtn.disabled=true;
};