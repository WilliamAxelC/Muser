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

    socket.on('HOST_CHANGED', (data) => {
      console.log(`[${userId}] Host changed to: ${data.hostId}`);
    });

    socket.on('STATE_SYNC', (data) => {
      // Passive sync check
    });
  });
}

async function runTest() {
  const roomId = 'phase4-room-' + Date.now();
  console.log(`Starting Phase 4 Recovery test in room: ${roomId}`);

  try {
    const host = await createClient('host', roomId) as any;
    const peer1 = await createClient('peer1', roomId) as any;
    const peer2 = await createClient('peer2', roomId) as any;

    console.log('--- Step 1: Host drops. Expecting peer1 to become host. ---');
    host.disconnect();

    setTimeout(async () => {
      console.log('--- Step 2: Peer1 (new host) drops. Expecting peer2 to become host. ---');
      peer1.disconnect();

      setTimeout(() => {
        console.log('--- Step 3: All dropped. Test complete. ---');
        peer2.disconnect();
        process.exit(0);
      }, 2000);
    }, 2000);

  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}

runTest();
