import { io } from 'socket.io-client';

const PORT = process.env.PORT || 3000;
const URL = `http://localhost:${PORT}`;

console.log(`Connecting to ${URL}...`);

const socket = io(URL, {
  query: { correlationId: 'test-harness-' + Date.now() }
});

socket.on('connect', () => {
  console.log('Connected to server with ID:', socket.id);
  
  // Basic handshake test
  setTimeout(() => {
    console.log('Test successful, disconnecting...');
    socket.disconnect();
    process.exit(0);
  }, 1000);
});

socket.on('connect_error', (err) => {
  console.error('Connection error:', err.message);
  process.exit(1);
});

// Safety timeout
setTimeout(() => {
  console.error('Test timed out');
  process.exit(1);
}, 5000);
