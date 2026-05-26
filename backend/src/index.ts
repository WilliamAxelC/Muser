import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import Redis from 'ioredis';
import dotenv from 'dotenv';
import logger from './logger';
import { 
  ClientToServerEvents, 
  ServerToClientEvents, 
  InterServerEvents, 
  SocketData 
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
    origin: "*",
  }
});

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);

redis.on('connect', () => {
  logger.info({ message: 'Connected to Redis' });
});

redis.on('error', (err) => {
  logger.error({ message: 'Redis connection error', error: err });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

io.on('connection', (socket) => {
  const correlation_id = socket.handshake.query.correlationId as string || 'initial';
  logger.info({ 
    message: 'New socket connection', 
    socket_id: socket.id, 
    correlation_id 
  });

  socket.on('disconnect', (reason) => {
    logger.info({ 
      message: 'Socket disconnected', 
      socket_id: socket.id, 
      reason 
    });
  });
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  logger.info({ message: `Server listening on port ${PORT}` });
});

process.on('SIGTERM', () => {
  logger.info({ message: 'SIGTERM received, shutting down' });
  httpServer.close(() => {
    redis.quit();
    process.exit(0);
  });
});
