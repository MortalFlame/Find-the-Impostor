import { useEffect, useState } from 'react';
import io from 'socket.io-client';

const socket = io();

export default function App() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [state, setState] = useState(null);
  const [input, setInput] = useState('');

  useEffect(() => {
    socket.on('state', setState);
  }, []);

  if (!state) {
    return (
      <div>
        <input placeholder="Name" onChange={e => setName(e.target.value)} />
        <input placeholder="Code" onChange={e => setCode(e.target.value)} />
        <button onClick={() => socket.emit('create', name)}>Create</button>
        <button onClick={() => socket.emit('join', { code, name })}>Join</button>
      </div>
    );
  }

  if (state.phase === 'lobby') {
    return <button onClick={() => socket.emit('start', state.code)}>Start</button>;
  }

  if (state.phase === 'round1' || state.phase === 'round2') {
    return (
      <>
        <p>{state.word || state.hint}</p>
        <input onChange={e => setInput(e.target.value)} />
        <button onClick={() => socket.emit('word', { code: state.code, word: input })}>
          Submit
        </button>
      </>
    );
  }

  if (state.phase === 'voting') {
    return state.players.map(p => (
      <button key={p.id} onClick={() => socket.emit('vote', { code: state.code, target: p.id })}>
        {p.name}
      </button>
    ));
  }

  if (state.phase === 'results') {
    return <h1>{state.winner.toUpperCase()} WIN</h1>;
  }
}
