import { io } from 'socket.io-client';

const PORT = process.env.PORT || 3000;
const URL = `http://localhost:${PORT}`;

async function createClient(userId: string, roomId: string) {
  return new Promise((resolve, reject) => {
    const socket = io(URL, {
      query: { correlationId: `test-${userId}`, roomId, userId }
    });

    socket.on('connect', () => {
      console.log(`[${userId}] Connected with ID: ${socket.id}`);
      resolve(socket);
    });

    socket.on('STATE_SYNC', (data) => {
      console.log(`[${userId}] Sync: isPlaying=${data.payload.isPlaying}, playhead=${data.payload.currentPlayhead}`);
    });

    socket.on('HOST_CHANGED', (data) => {
      console.log(`[${userId}] Host changed to: ${data.hostId}`);
    });
  });
}

async function runTest() {
  const roomId = 'phase3-room-' + Date.now();
  console.log(`Starting Phase 3 test in room: ${roomId}`);

  try {
    const client1 = await createClient('host', roomId) as any;
    const client2 = await createClient('peer', roomId) as any;

    console.log('--- Test 1: Host PLAY mutation ---');
    client1.emit('ROOM_MUTATION', {
      action: 'ROOM_MUTATION',
      version: 1,
      correlationId: 'tx-play',
      payload: { roomId, type: 'PLAY', playhead: 10, timestamp: Date.now() }
    });

    setTimeout(() => {
      console.log('--- Test 2: Peer (unauthorized) mutation attempt ---');
      client2.emit('ROOM_MUTATION', {
        action: 'ROOM_MUTATION',
        version: 1,
        correlationId: 'tx-unauth',
        payload: { roomId, type: 'PAUSE', timestamp: Date.now() }
      });
    }, 1000);

    setTimeout(() => {
      console.log('--- Test 3: Rate Limiting (Flood SEEK) ---');
      for (let i = 0; i < 10; i++) {
        client1.emit('ROOM_MUTATION', {
          action: 'ROOM_MUTATION',
          version: 1,
          correlationId: `tx-flood-${i}`,
          payload: { roomId, type: 'SEEK', playhead: i * 5, timestamp: Date.now() }
        });
      }
    }, 2000);

    setTimeout(() => {
      console.log('--- Finalizing test ---');
      client1.disconnect();
      client2.disconnect();
      process.exit(0);
    }, 5000);

  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}

runTest();
