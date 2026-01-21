const words = require('./words.json');

const PHASES = {
  LOBBY: 'lobby',
  ROLE: 'role',
  ROUND1: 'round1',
  ROUND2: 'round2',
  VOTING: 'voting',
  RESULTS: 'results'
};

class GameManager {
  constructor() {
    this.games = new Map();
  }

  createLobby(hostId, name) {
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();

    this.games.set(code, {
      code,
      hostId,
      phase: PHASES.LOBBY,
      players: [{ id: hostId, name }],
      impostorId: null,
      word: null,
      hint: null,
      round: 0,
      submissions: { 1: {}, 2: {} },
      votes: {},
      winner: null
    });

    return code;
  }

  joinLobby(code, id, name) {
    const game = this.games.get(code);
    if (!game) throw new Error('Lobby not found');
    if (game.phase !== PHASES.LOBBY) throw new Error('Game already started');
    if (game.players.length >= 15) throw new Error('Lobby full');

    game.players.push({ id, name });
  }

  startGame(code) {
    const game = this.games.get(code);
    if (game.players.length < 3) throw new Error('Need 3+ players');

    const pick = words[Math.floor(Math.random() * words.length)];
    game.word = pick.word;
    game.hint = pick.hint;

    const impostor = game.players[Math.floor(Math.random() * game.players.length)];
    game.impostorId = impostor.id;

    game.phase = PHASES.ROLE;

    setTimeout(() => {
      game.phase = PHASES.ROUND1;
      game.round = 1;
    }, 3000);
  }

  submitWord(code, playerId, word) {
    const game = this.games.get(code);
    game.submissions[game.round][playerId] = word;

    if (Object.keys(game.submissions[game.round]).length === game.players.length) {
      if (game.round === 1) {
        game.round = 2;
        game.phase = PHASES.ROUND2;
      } else {
        game.phase = PHASES.VOTING;
      }
    }
  }

  vote(code, voterId, targetId) {
    const game = this.games.get(code);
    game.votes[voterId] = targetId;

    if (Object.keys(game.votes).length === game.players.length) {
      this.finishGame(code);
    }
  }

  finishGame(code) {
    const game = this.games.get(code);
    const tally = {};

    Object.values(game.votes).forEach(id => {
      tally[id] = (tally[id] || 0) + 1;
    });

    const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);

    if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
      game.winner = 'impostor';
    } else {
      game.winner = sorted[0][0] === game.impostorId ? 'civilians' : 'impostor';
    }

    game.phase = PHASES.RESULTS;
  }

  getState(code, playerId) {
    const g = this.games.get(code);
    const isImpostor = g.impostorId === playerId;

    return {
      ...g,
      word: isImpostor ? null : g.word,
      hint: isImpostor ? g.hint : null,
      impostorId: g.phase === PHASES.RESULTS ? g.impostorId : null
    };
  }
}

module.exports = { GameManager, PHASES };
