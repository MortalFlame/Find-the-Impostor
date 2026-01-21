const wordDatabase = require('./wordDatabase.json');

const GAME_PHASES = {
  LOBBY: 'lobby',
  ROLE_REVEAL: 'role_reveal',
  ROUND_1: 'round_1',
  ROUND_1_REVEAL: 'round_1_reveal',
  ROUND_2: 'round_2',
  ROUND_2_REVEAL: 'round_2_reveal',
  VOTING: 'voting',
  RESULTS: 'results'
};

class GameManager {
  constructor() {
    this.games = new Map();
    this.playerToLobby = new Map();
    this.usedWords = new Map();
  }

  generateLobbyCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  joinLobby(playerId, playerName, lobbyCode = null, isSpectator = false) {
    // Create new lobby if no code provided
    if (!lobbyCode) {
      lobbyCode = this.generateLobbyCode();
      while (this.games.has(lobbyCode)) {
        lobbyCode = this.generateLobbyCode();
      }
      
      this.games.set(lobbyCode, {
        lobbyCode,
        players: [],
        spectators: [],
        phase: GAME_PHASES.LOBBY,
        host: playerId,
        secretWord: null,
        hint: null,
        impostor: null,
        currentRound: 0,
        submissions: {},
        votes: {},
        winner: null,
        votedOutPlayer: null
      });
    }

    const game = this.games.get(lobbyCode);
    if (!game) {
      throw new Error('Lobby not found');
    }

    // Check if player already exists
    const existingPlayer = game.players.find(p => p.id === playerId);
    const existingSpectator = game.spectators.find(s => s.id === playerId);
    
    if (existingPlayer || existingSpectator) {
      return { lobbyCode, playerId, playerName, isSpectator };
    }

    if (isSpectator) {
      // Add as spectator
      game.spectators.push({
        id: playerId,
        name: playerName
      });
    } else {
      // Check player limit
      if (game.players.length >= 15) {
        throw new Error('Lobby is full (max 15 players)');
      }

      // Can't join as player if game already started
      if (game.phase !== GAME_PHASES.LOBBY) {
        throw new Error('Game already in progress. Join as spectator instead.');
      }

      // Add as player
      game.players.push({
        id: playerId,
        name: playerName,
        isHost: game.players.length === 0
      });

      // Set first player as host if no host exists
      if (!game.host) {
        game.host = playerId;
      }
    }

    this.playerToLobby.set(playerId, lobbyCode);
    return { lobbyCode, playerId, playerName, isSpectator };
  }

  startGame(lobbyCode, requesterId) {
    const game = this.games.get(lobbyCode);
    if (!game) throw new Error('Game not found');
    if (game.host !== requesterId) throw new Error('Only host can start game');
    if (game.players.length < 3) throw new Error('Need at least 3 players');

    // Select random word (avoid recent words)
    const usedWords = this.usedWords.get(lobbyCode) || [];
    const availableWords = wordDatabase.filter(w => !usedWords.includes(w.word));
    const wordPool = availableWords.length > 0 ? availableWords : wordDatabase;
    
    const wordData = wordPool[Math.floor(Math.random() * wordPool.length)];
    
    // Track used word
    usedWords.push(wordData.word);
    if (usedWords.length > 5) usedWords.shift(); // Keep last 5
    this.usedWords.set(lobbyCode, usedWords);

    // Select random impostor
    const impostorIndex = Math.floor(Math.random() * game.players.length);
    
    game.secretWord = wordData.word;
    game.hint = wordData.hint;
    game.impostor = game.players[impostorIndex].id;
    game.phase = GAME_PHASES.ROLE_REVEAL;
    game.currentRound = 1;
    game.submissions = {};
    game.votes = {};
    game.winner = null;
    game.votedOutPlayer = null;

    // Auto-advance to round 1 after role reveal
    setTimeout(() => {
      game.phase = GAME_PHASES.ROUND_1;
    }, 4000);
  }

  submitWord(lobbyCode, playerId, word) {
    const game = this.games.get(lobbyCode);
    if (!game) throw new Error('Game not found');
    if (game.phase !== GAME_PHASES.ROUND_1 && game.phase !== GAME_PHASES.ROUND_2) {
      throw new Error('Not in submission phase');
    }

    const player = game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not in game');

    game.submissions[playerId] = word.trim();
  }

  checkAllSubmitted(lobbyCode) {
    const game = this.games.get(lobbyCode);
    return game.players.every(p => game.submissions[p.id]);
  }

  advancePhase(lobbyCode) {
    const game = this.games.get(lobbyCode);
    
    if (game.phase === GAME_PHASES.ROUND_1) {
      game.phase = GAME_PHASES.ROUND_1_REVEAL;
      setTimeout(() => {
        game.phase = GAME_PHASES.ROUND_2;
        game.currentRound = 2;
        game.submissions = {};
      }, 3000);
    } else if (game.phase === GAME_PHASES.ROUND_2) {
      game.phase = GAME_PHASES.ROUND_2_REVEAL;
      setTimeout(() => {
        game.phase = GAME_PHASES.VOTING;
      }, 3000);
    }
  }

  submitVote(lobbyCode, playerId, votedPlayerId) {
    const game = this.games.get(lobbyCode);
    if (!game) throw new Error('Game not found');
    if (game.phase !== GAME_PHASES.VOTING) throw new Error('Not in voting phase');

    const player = game.players.find(p => p.id === playerId);
    if (!player) throw new Error('Player not in game');

    game.votes[playerId] = votedPlayerId;
  }

  checkAllVoted(lobbyCode) {
    const game = this.games.get(lobbyCode);
    return game.players.every(p => game.votes[p.id]);
  }

  calculateResults(lobbyCode) {
    const game = this.games.get(lobbyCode);
    
    // Count votes
    const voteCounts = {};
    Object.values(game.votes).forEach(vote => {
      voteCounts[vote] = (voteCounts[vote] || 0) + 1;
    });

    // Find player with most votes
    const votedOutId = Object.entries(voteCounts)
      .sort((a, b) => b[1] - a[1])[0][0];

    game.votedOutPlayer = votedOutId;
    game.winner = votedOutId === game.impostor ? 'civilians' : 'impostor';
    game.phase = GAME_PHASES.RESULTS;
  }

  resetGame(lobbyCode, requesterId) {
    const game = this.games.get(lobbyCode);
    if (!game) throw new Error('Game not found');
    if (game.host !== requesterId) throw new Error('Only host can reset game');

    game.phase = GAME_PHASES.LOBBY;
    game.secretWord = null;
    game.hint = null;
    game.impostor = null;
    game.currentRound = 0;
    game.submissions = {};
    game.votes = {};
    game.winner = null;
    game.votedOutPlayer = null;
  }

  handleDisconnect(playerId) {
    const lobbyCode = this.playerToLobby.get(playerId);
    if (!lobbyCode) return;

    const game = this.games.get(lobbyCode);
    if (!game) return;

    // Remove from players or spectators
    game.players = game.players.filter(p => p.id !== playerId);
    game.spectators = game.spectators.filter(s => s.id !== playerId);

    // Assign new host if needed
    if (game.host === playerId && game.players.length > 0) {
      game.host = game.players[0].id;
      game.players[0].isHost = true;
    }

    // Delete empty lobbies
    if (game.players.length === 0 && game.spectators.length === 0) {
      this.games.delete(lobbyCode);
      this.usedWords.delete(lobbyCode);
    }

    this.playerToLobby.delete(playerId);
  }

  getPersonalizedState(lobbyCode, playerId) {
    const game = this.games.get(lobbyCode);
    if (!game) return null;

    const isImpostor = game.impostor === playerId;
    
    return {
      ...game,
      // Only reveal secret word/hint based on role
      secretWord: isImpostor ? null : game.secretWord,
      hint: isImpostor ? game.hint : null,
      isImpostor,
      playerId,
      // Hide impostor identity until results
      impostor: game.phase === GAME_PHASES.RESULTS ? game.impostor : null
    };
  }

  getSpectatorState(lobbyCode) {
    const game = this.games.get(lobbyCode);
    if (!game) return null;

    return {
      ...game,
      isSpectator: true,
      playerId: null
      // Spectators see everything including impostor
    };
  }

  getGameState(lobbyCode) {
    const game = this.games.get(lobbyCode);
    return game;
  }
}

module.exports = GameManager;
