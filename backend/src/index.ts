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
    origin: ["http://localhost:8080", "http://127.0.0.1:8080", "https://mrelay.012018.xyz"],
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

io.on('connection', (socket) => {
  const correlation_id = socket.handshake.query.correlationId as string || 'initial';
  const roomId = socket.handshake.query.roomId as string;
  const userId = socket.handshake.query.userId as string || `user-${socket.id}`;

  if (!roomId) {
    logger.warn({ message: 'Connection attempt without roomId', socket_id: socket.id });
    socket.disconnect();
    return;
  }

  socket.data.roomId = roomId;
  socket.data.userId = userId;
  socket.join(roomId);

  roomManager.join(roomId, socket.id, userId).then(async (hostId) => {
    logger.info({ message: 'User joined room', socket_id: socket.id, room_id: roomId, user_id: userId, host_id: hostId, correlation_id });

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
    
    io.to(roomId).emit('HOST_CHANGED', { hostId });
  }).catch(err => {
    logger.error({ message: 'Error joining room', error: err, socket_id: socket.id });
    socket.disconnect();
  });

  socket.on('ROOM_MUTATION', async (data) => {
    const result = RoomMutationSchema.safeParse(data);
    if (!result.success) {
      logger.warn({ message: 'Invalid mutation schema', socket_id: socket.id, error: result.error });
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

    // Authority Check: Only host can mutate (except ROOM_RESYNC which might be handled differently, but for now strict)
    const state = await roomManager.getState(mutation.payload.roomId);
    if (!state || state.hostId !== socket.id) {
        if (mutation.payload.type !== 'ROOM_RESYNC') {
            logger.warn({ message: 'Unauthorized mutation attempt', socket_id: socket.id, host_id: state?.hostId });
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
        const newHostId = await roomManager.leave(rId, socket.id);
        if (newHostId && newHostId !== '') {
          logger.info({ message: 'Host migrated', room_id: rId, old_host_id: socket.id, new_host_id: newHostId });
          io.to(rId).emit('HOST_CHANGED', { hostId: newHostId });
        }
      } catch (err) {
        logger.error({ message: 'Error leaving room', error: err, socket_id: socket.id });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => logger.info({ message: `Server listening on port ${PORT}` }));

process.on('SIGTERM', () => {
  httpServer.close(() => {
    redis.quit();
    process.exit(0);
  });
});
