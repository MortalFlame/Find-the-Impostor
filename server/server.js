const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { GameManager } = require('./gameManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const manager = new GameManager();

io.on('connection', socket => {
  socket.on('create', name => {
    const code = manager.createLobby(socket.id, name);
    socket.join(code);
    io.to(code).emit('state', manager.getState(code, socket.id));
  });

  socket.on('join', ({ code, name }) => {
    manager.joinLobby(code, socket.id, name);
    socket.join(code);
    io.to(code).emit('state', manager.getState(code, socket.id));
  });

  socket.on('start', code => {
    manager.startGame(code);
    io.to(code).emit('state', manager.getState(code, socket.id));
  });

  socket.on('word', ({ code, word }) => {
    manager.submitWord(code, socket.id, word);
    io.to(code).emit('state', manager.getState(code, socket.id));
  });

  socket.on('vote', ({ code, target }) => {
    manager.vote(code, socket.id, target);
    io.to(code).emit('state', manager.getState(code, socket.id));
  });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  app.get('*', (_, res) =>
    res.sendFile(path.join(__dirname, '../client/build/index.html'))
  );
}

server.listen(process.env.PORT || 3001);
