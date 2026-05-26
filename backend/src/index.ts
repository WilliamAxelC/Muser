import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import { z } from 'zod';
import logger from './logger';
import { RoomManager } from './room-manager';
import { RateLimiter } from './rate-limiter';
import { 
  ClientToServerEvents, 
  ServerToClientEvents, 
  InterServerEvents, 
  SocketData,
  RoomMutation
} from './types';

dotenv.config();

const app = express();
const httpServer = createServer(app);

const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  cors: { 
    origin: true, // Dynamically allow exact request origin to bypass strict tunnel CORS mismatch
    methods: ["GET", "POST"],
    credentials: true
  },
  maxHttpBufferSize: 4096 // 4KB limit
});

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);
const roomManager = new RoomManager(redis);
const rateLimiter = new RateLimiter();

const RoomMutationSchema = z.object({
  action: z.literal('ROOM_MUTATION'),
  version: z.number(),
  correlationId: z.string().max(100),
  payload: z.object({
    roomId: z.string().min(1).max(50).regex(/^[a-zA-Z0-9_-]+$/),
    type: z.enum(['PLAY', 'PAUSE', 'SEEK', 'SKIP', 'QUEUE_REORDER', 'ROOM_RESYNC']),
    playhead: z.number().min(0).optional(),
    currentTrackId: z.string().length(11).regex(/^[a-zA-Z0-9_-]{11}$/).optional(),
    timestamp: z.number()
  })
});

redis.on('connect', () => logger.info({ message: 'Connected to Redis' }));
redis.on('error', (err) => logger.error({ message: 'Redis connection error', error: err }));

app.get('/health', (req, res) => res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() }));

io.use((socket, next) => {
  const origin = socket.handshake.headers.origin || socket.handshake.headers.referer || 'unknown';
  logger.info({ 
    message: '[Diagnostic] Incoming connection attempt', 
    origin,
    socket_id: socket.id,
    query: socket.handshake.query
  });
  next();
});

io.on('connection', (socket) => {
  const correlation_id = socket.handshake.query.correlationId as string || 'initial';
  const roomId = socket.handshake.query.roomId as string;
  const userId = socket.handshake.query.userId as string || `user-${socket.id}`;

  if (!roomId) {
    logger.warn({ message: '[Diagnostic] Connection attempt without roomId', socket_id: socket.id });
    socket.disconnect();
    return;
  }

  socket.data.roomId = roomId;
  socket.data.userId = userId;
  socket.join(roomId);

  roomManager.join(roomId, socket.id, userId).then(async (hostId) => {
    let currentHostId = hostId;
    
    // Self-Healing: Verify host is actually alive upon join
    const sockets = await io.in(roomId).fetchSockets();
    const hostAlive = sockets.some(s => s.id === currentHostId);
    
    if (!hostAlive && currentHostId !== socket.id) {
      logger.warn({ message: `[Self-Healing] Phantom host ${currentHostId} detected on join. Forcing migration.` });
      const migratedHost = await roomManager.leave(roomId, currentHostId);
      currentHostId = migratedHost || socket.id;
    }

    logger.info({ message: '[Diagnostic] User joined room', socket_id: socket.id, room_id: roomId, user_id: userId, host_id: currentHostId, correlation_id });

    // Initial sync
    const state = await roomManager.getState(roomId);
    if (state) {
      socket.emit('STATE_SYNC', {
        event: 'STATE_SYNC',
        version: 1,
        correlationId: correlation_id,
        payload: {
          roomId,
          isPlaying: state.isPlaying,
          currentPlayhead: state.currentPlayhead,
          currentTrackId: state.currentTrackId,
          updatedAt: state.updatedAt
        }
      });
    }
    
    io.to(roomId).emit('HOST_CHANGED', { hostId: currentHostId });
  }).catch(err => {
    logger.error({ message: '[Diagnostic] Error joining room', error: err, socket_id: socket.id });
    socket.disconnect();
  });

  socket.on('ROOM_MUTATION', async (data) => {
    logger.info({ message: '[Diagnostic] Raw Incoming ROOM_MUTATION', socket_id: socket.id, raw_data: data });
    const result = RoomMutationSchema.safeParse(data);
    if (!result.success) {
      logger.warn({ message: '[Diagnostic] Invalid mutation schema', socket_id: socket.id, error: result.error });
      return;
    }

    const mutation = result.data as RoomMutation;

    // Rate limiting for high-frequency events
    if (mutation.payload.type === 'SEEK' || mutation.payload.type === 'ROOM_RESYNC') {
      if (!rateLimiter.consume(socket.id)) {
        logger.warn({ message: 'Rate limit exceeded', socket_id: socket.id, type: mutation.payload.type });
        return;
      }
    }

    // Fetch state and perform Self-Healing Host Verification
    let state = await roomManager.getState(mutation.payload.roomId);
    if (state && state.hostId) {
      const sockets = await io.in(mutation.payload.roomId).fetchSockets();
      const hostAlive = sockets.some(s => s.id === state?.hostId);
      
      if (!hostAlive) {
        logger.warn({ message: `[Self-Healing] Phantom host ${state.hostId} dead during mutation. Forcing migration.` });
        const newHostId = await roomManager.leave(mutation.payload.roomId, state.hostId);
        if (newHostId) {
          io.to(mutation.payload.roomId).emit('HOST_CHANGED', { hostId: newHostId });
        }
        // Refresh state after healing
        state = await roomManager.getState(mutation.payload.roomId);
      }
    }

    // Authority Check: Playback controls require host authority. Anyone can add tracks (ROOM_RESYNC)
    const hostRequiredActions = ['PLAY', 'PAUSE', 'SEEK', 'SKIP', 'QUEUE_REORDER'];
    if (hostRequiredActions.includes(mutation.payload.type)) {
        if (!state || state.hostId !== socket.id) {
            logger.warn({ 
                message: `[Validation Error] Mutation rejected: Sender ${socket.id} is not the designated room host ${state?.hostId}`,
                action: mutation.payload.type
            });
            socket.emit('ERROR', { message: `Permission Denied: Only the room host can perform ${mutation.payload.type}` });
            return;
        }
    }

    // Update State in Redis
    let isPlaying = state?.isPlaying ?? false;
    let currentPlayhead = mutation.payload.playhead ?? state?.currentPlayhead ?? 0;
    let currentTrackId = mutation.payload.currentTrackId ?? state?.currentTrackId ?? '';

    if (mutation.payload.type === 'PLAY') isPlaying = true;
    if (mutation.payload.type === 'PAUSE') isPlaying = false;

    await roomManager.setState(mutation.payload.roomId, {
      isPlaying,
      currentPlayhead,
      currentTrackId
    });

    // Broadcast Sync
    io.to(mutation.payload.roomId).emit('STATE_SYNC', {
      event: 'STATE_SYNC',
      version: 1,
      correlationId: mutation.correlationId,
      payload: {
        roomId: mutation.payload.roomId,
        isPlaying,
        currentPlayhead,
        currentTrackId,
        updatedAt: Date.now()
      }
    });
  });

  socket.on('disconnect', async (reason) => {
    const rId = socket.data.roomId;
    logger.info({ message: 'Socket disconnected', socket_id: socket.id, room_id: rId, reason });
    rateLimiter.cleanup(socket.id);

    if (rId) {
      try {
        const sockets = await io.in(rId).fetchSockets();
        if (sockets.length === 0) {
          logger.info({ message: '[System] Room empty, performing garbage collection', room_id: rId });
          await redis.del(`room:${rId}:meta`, `room:${rId}:join_order`);
        } else {
          const newHostId = await roomManager.leave(rId, socket.id);
          if (newHostId && newHostId !== '') {
            logger.info({ message: 'Host migrated', room_id: rId, old_host_id: socket.id, new_host_id: newHostId });
            io.to(rId).emit('HOST_CHANGED', { hostId: newHostId });
          }
        }
      } catch (err) {
        logger.error({ message: 'Error leaving room', error: err, socket_id: socket.id });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

// System Cache Cleanup on Boot
redis.keys('room:*').then(keys => {
  if (keys.length > 0) {
    redis.del(...keys).then(() => {
      logger.info({ message: '[System] Flushed stale room cache on boot', keys_cleared: keys.length });
    });
  }
}).catch(err => logger.error({ message: '[System] Error flushing cache', error: err }));

httpServer.listen(PORT, () => logger.info({ message: `Server listening on port ${PORT}` }));

process.on('SIGTERM', () => {
  httpServer.close(() => {
    redis.quit();
    process.exit(0);
  });
});
