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
    type: z.enum(['PLAY', 'PAUSE', 'SEEK', 'SKIP', 'BACK', 'QUEUE_REORDER', 'QUEUE_JUMP', 'ROOM_RESYNC', 'QUEUE_ADD', 'QUEUE_REMOVE', 'QUEUE_CLEAR', 'QUEUE_BATCH_APPEND', 'SET_PUBLIC', 'SET_REQUEST_ONLY', 'APPROVE_REQUEST', 'DENY_REQUEST', 'UPDATE_IDENTITY', 'TRANSFER_AUTHORITY', 'QUEUE_PLAYLIST_REQUEST', 'SET_TITLE', 'SET_PEER_STATUS']),
    playhead: z.number().min(0).optional(),
    currentTrackId: z.string().length(11).regex(/^[a-zA-Z0-9_-]{11}$/).optional().or(z.literal('')),
    timestamp: z.number(),
    item: z.string().optional(),
    items: z.array(z.string()).optional(),
    index: z.number().optional(),
    newIndex: z.number().optional(),
    isPublic: z.boolean().optional(),
    isRequestOnly: z.boolean().optional(),
    requestId: z.string().optional(),
    username: z.string().max(50).optional(),
    playlistId: z.string().optional(),
    title: z.string().max(100).optional(),
    isDetached: z.boolean().optional()
  })
});

const SendMessageSchema = z.object({
  roomId: z.string().min(1).max(50).regex(/^[a-zA-Z0-9_-]+$/),
  text: z.string().min(1).max(500)
});

redis.on('connect', () => logger.info({ message: 'Connected to Redis' }));
redis.on('error', (err) => logger.error({ message: 'Redis connection error', error: err }));

const resolveVideoTitle = async (videoId: string): Promise<string> => {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    if (!response.ok) return `YouTube Video (${videoId})`;
    const html = await response.text();
    const titleMatch = html.match(/<title>(.*?) - YouTube<\/title>/) || html.match(/<title>(.*?)<\/title>/);
    return titleMatch ? titleMatch[1] : `YouTube Video (${videoId})`;
  } catch (err) {
    return `YouTube Video (${videoId})`;
  }
};

app.get('/health', (req, res) => res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() }));

app.get('/api/rooms', async (req, res) => {
  try {
    const rooms = await roomManager.getActivePublicRooms();
    res.json({ rooms });
  } catch (err) {
    logger.error({ message: 'Failed to fetch public rooms', error: err });
    res.status(500).json({ error: 'Failed to fetch public rooms' });
  }
});

app.get('/api/playlist', async (req, res) => {
  const rawId = req.query.id as string;
  if (!rawId) {
    return res.status(400).json({ error: 'Missing id parameter' });
  }

  // Sanitize: Isolate alphanumeric ID and handle trailing tracking args
  const playlistIdMatch = rawId.trim().match(/^([a-zA-Z0-9_-]+)/);
  const playlistId = playlistIdMatch ? playlistIdMatch[1] : rawId.trim();

  try {
    logger.info({ message: '[Playlist] Native unroll request', playlistId });
    
    // Explicitly hardcode Desktop User-Agent and strip any incoming client headers
    const response = await fetch(`https://www.youtube.com/playlist?list=${playlistId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      }
    });

    if (!response.ok) {
      throw new Error(`YouTube returned status ${response.status}`);
    }

    const html = await response.text();
    
    // Attempt to parse JSON block for titles
    const jsonMatch = html.match(/var ytInitialData = ({.*?});<\/script>/);
    if (jsonMatch) {
        try {
            const data = JSON.parse(jsonMatch[1]);
            const contents = data.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents;
            if (contents) {
                const items = contents
                    .filter((i: any) => i.playlistVideoRenderer)
                    .map((i: any) => ({
                        videoId: i.playlistVideoRenderer.videoId,
                        title: i.playlistVideoRenderer.title?.runs?.[0]?.text || 'Unknown Title'
                    }));
                if (items.length > 0) {
                    logger.info({ message: '[Playlist] Unrolled with titles', playlistId, count: items.length });
                    return res.json({ items });
                }
            }
        } catch (e) {
            logger.warn({ message: '[Playlist] JSON extraction failed, checking regex fallback', error: e });
        }
    }

    // Fallback: Just IDs with dummy titles
    const videoIdRegex = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
    const matches = Array.from(html.matchAll(videoIdRegex));
    const videoIds = Array.from(new Set(matches.map(m => m[1])));
    const items = videoIds.map(id => ({ videoId: id, title: `YouTube Track (${id})` }));

    if (items.length === 0) {
      console.warn(`[Playlist Diagnostic] No IDs extracted. HTML snippet: ${html.substring(0, 500)}`);
      return res.status(404).json({ error: 'No videos found in this playlist' });
    }

    logger.info({ message: '[Playlist] Unrolled with fallback', playlistId, count: items.length });
    res.json({ items });
  } catch (err) {
    logger.error({ message: 'Failed to unroll playlist', error: err, playlistId });
    res.status(500).json({ error: 'Failed to resolve YouTube playlist metadata' });
  }
});

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

const disconnectTimeouts = new Map<string, { timeout: NodeJS.Timeout, oldSocketId: string }>();

io.on('connection', async (socket) => {
  const correlation_id = socket.handshake.query.correlationId as string || 'initial';
  const roomId = socket.handshake.query.roomId as string;
  const userId = socket.handshake.query.userId as string || `user-${socket.id}`;
  let username = socket.handshake.query.username as string || `Guest_${socket.id.substring(0,4)}`;
  const password = socket.handshake.query.password as string;
  const roomTitle = socket.handshake.query.title as string;

  if (!roomId) {
    logger.warn({ message: '[Diagnostic] Connection attempt without roomId', socket_id: socket.id });
    socket.disconnect();
    return;
  }

  // Deduplication & Stale Socket Eviction
  const existingSockets = await io.in(roomId).fetchSockets();
  for (const existingSocket of existingSockets) {
    if (existingSocket.data.userId === userId) {
      logger.info({ message: '[System] Evicting stale socket for user', userId, stale_socket: existingSocket.id, new_socket: socket.id });
      existingSocket.disconnect(true);
    }
  }

  // Handle username collision for different users
  let baseName = username.replace(/\s\(\d+\)$/, '');
  let suffix = 1;
  while (existingSockets.some(s => s.data.username === username && s.data.userId !== userId)) {
    username = `${baseName} (${suffix})`;
    suffix++;
  }

  socket.data.roomId = roomId;
  socket.data.userId = userId;
  socket.data.username = username;
  socket.join(roomId);

  const broadcastHostChange = async (rId: string, hId: string) => {
    const sockets = await io.in(rId).fetchSockets();
    const hostSocket = sockets.find(s => s.data.userId === hId);
    const hostName = hostSocket?.data.username || hId;
    io.to(rId).emit('HOST_CHANGED', { hostId: hId, hostName });
  };

  const buildActivePeers = (sockets: any[]) => {
    const peersMap: Record<string, any> = {};
    for (const s of sockets) {
      const uid = s.data.userId || 'unknown';
      peersMap[uid] = {
        socketId: s.id,
        userId: uid,
        username: s.data.username,
        isDetached: s.data.isDetached || false
      };
    }
    return Object.values(peersMap);
  };

  const broadcastRosterUpdate = async (rId: string) => {
    const sockets = await io.in(rId).fetchSockets();
    io.to(rId).emit('ROSTER_UPDATE', { peers: buildActivePeers(sockets) });
  };

  let isReconnect = false;
  if (disconnectTimeouts.has(userId)) {
    const { timeout, oldSocketId } = disconnectTimeouts.get(userId)!;
    clearTimeout(timeout);
    disconnectTimeouts.delete(userId);
    isReconnect = true;
    logger.info({ message: '[System] Graceful reconnection intercepted', userId, new_socket: socket.id, old_socket: oldSocketId });
    await roomManager.updateSocketId(roomId, userId, userId); // Safe no-op
  }

  if (isReconnect) {
    // Just sync state without broadasting join
    const state = await roomManager.getState(roomId);
    if (state) {
      const sockets = await io.in(roomId).fetchSockets();
      const activePeers = buildActivePeers(sockets);
      socket.emit('STATE_SYNC', {
        event: 'STATE_SYNC',
        version: 1,
        correlationId: correlation_id,
        payload: {
          roomId,
          title: state.title,
          isPlaying: state.isPlaying,
          currentPlayhead: state.currentPlayhead,
          currentTrackId: state.currentTrackId,
          updatedAt: state.updatedAt,
          queue: state.queue,
          history: state.history,
          isPublic: state.isPublic,
          isRequestOnly: state.isRequestOnly,
          pendingRequests: state.pendingRequests,
          peers: activePeers,
          hostUserId: state.hostId
        }
      });
      io.to(roomId).emit('HOST_CHANGED', { hostId: state.hostId, hostName: state.hostId === userId ? username : undefined });
    }
  } else {
    roomManager.join(roomId, socket.id, userId, password, roomTitle).then(async (hostId) => {
    let currentHostId = hostId;
    
    // Announce Join
    io.to(roomId).emit('ROOM_MESSAGE', {
      id: `sys-${Date.now()}`,
      userId: 'system',
      username: 'System',
      text: `${username} joined the room`,
      timestamp: Date.now()
    });
    
    // Self-Healing: Verify host is actually alive upon join
    const sockets = await io.in(roomId).fetchSockets();
    const hostAlive = sockets.some(s => s.data.userId === currentHostId);
    
    if (!hostAlive && currentHostId !== userId) {
      logger.warn({ message: `[Self-Healing] Phantom host ${currentHostId} detected on join. Forcing migration.` });
      const migratedHost = await roomManager.leave(roomId, currentHostId);
      currentHostId = migratedHost || userId;
    }

    logger.info({ message: '[Diagnostic] User joined room', socket_id: socket.id, room_id: roomId, user_id: userId, username, host_id: currentHostId, correlation_id });

    // Initial sync
    const state = await roomManager.getState(roomId);
    if (state) {
      const activePeers = buildActivePeers(sockets);

      socket.emit('STATE_SYNC', {
        event: 'STATE_SYNC',
        version: 1,
        correlationId: correlation_id,
        payload: {
          roomId,
          title: state.title,
          isPlaying: state.isPlaying,
          currentPlayhead: state.currentPlayhead,
          currentTrackId: state.currentTrackId,
          updatedAt: state.updatedAt,
          queue: state.queue || [],
          history: state.history || [],
          isPublic: state.isPublic || false,
          isRequestOnly: state.isRequestOnly || false,
          pendingRequests: state.pendingRequests || [],
          peers: activePeers,
          hostUserId: state.hostId
        }
      });
      // Broadcast lightweight roster update to everyone
      await broadcastRosterUpdate(roomId);
    }
    
    await broadcastHostChange(roomId, currentHostId);
  }).catch(err => {
    if (err.message === 'INVALID_PASSWORD') {
      socket.emit('ERROR', { message: 'Incorrect room password. Access denied.' });
    } else {
      logger.error({ message: '[Diagnostic] Error joining room', error: err, socket_id: socket.id });
    }
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
      const hostAlive = sockets.some(s => s.data.userId === state?.hostId);
      
      if (!hostAlive) {
        logger.warn({ message: `[Self-Healing] Phantom host ${state.hostId} dead during mutation. Forcing migration.` });
        const newHostId = await roomManager.leave(mutation.payload.roomId, state.hostId);
        if (newHostId) {
          await broadcastHostChange(mutation.payload.roomId, newHostId);
        }
        // Refresh state after healing
        state = await roomManager.getState(mutation.payload.roomId);
      }
    }

    // Authority Check: Playback controls require host authority. Anyone can add tracks (ROOM_RESYNC)
    const hostRequiredActions = ['PLAY', 'PAUSE', 'SEEK', 'SKIP', 'BACK', 'QUEUE_REORDER', 'QUEUE_JUMP'];
    if (hostRequiredActions.includes(mutation.payload.type)) {
        if (!state || state.hostId !== socket.data.userId) {
            logger.warn({ 
                message: `[Validation Error] Mutation rejected: Sender ${socket.data.userId} is not the designated room host ${state?.hostId}`,
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
    let currentTitle = state?.currentTitle ?? '';
    let title = mutation.payload.title ?? state?.title ?? mutation.payload.roomId;
    let queue = state?.queue || [];
    let history = state?.history || [];
    let isPublic = state?.isPublic ?? false;
    let isRequestOnly = state?.isRequestOnly ?? false;
    let pendingRequests = state?.pendingRequests || [];

    if (mutation.payload.type === 'PLAY') isPlaying = true;
    if (mutation.payload.type === 'PAUSE') isPlaying = false;
    
    if (mutation.payload.type === 'SET_PUBLIC' && mutation.payload.isPublic !== undefined) {
        isPublic = mutation.payload.isPublic;
    }
    
    if (mutation.payload.type === 'SET_REQUEST_ONLY' && mutation.payload.isRequestOnly !== undefined) {
        isRequestOnly = mutation.payload.isRequestOnly;
    }

    if (mutation.payload.type === 'SET_TITLE' && mutation.payload.title) {
        title = mutation.payload.title;
    }

    if (mutation.payload.type === 'SET_PEER_STATUS' && mutation.payload.isDetached !== undefined) {
        socket.data.isDetached = mutation.payload.isDetached;
    }

    if (mutation.payload.type === 'QUEUE_ADD' && mutation.payload.item) {
        const videoId = mutation.payload.item;
        const videoTitle = await resolveVideoTitle(videoId);
        const item = { videoId, title: videoTitle };

        if (isRequestOnly && socket.data.userId !== state?.hostId) {
            // Route to pending requests
            pendingRequests.push({
                id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
                trackId: videoId,
                title: videoTitle,
                username: socket.data.username
            });
            // Emit a notification back to the sender
            socket.emit('ERROR', { message: 'Track submitted for host approval.' });
        } else {
            if (!currentTrackId || currentTrackId === '') {
                currentTrackId = videoId;
                currentTitle = videoTitle;
                currentPlayhead = 0;
                isPlaying = true;
                logger.info({ message: '[System] Auto-promoted single track add to idle room', roomId: mutation.payload.roomId, trackId: currentTrackId });
            } else {
                queue.push(item);
            }
        }
    }
    
    if (mutation.payload.type === 'APPROVE_REQUEST' && mutation.payload.requestId) {
        if (socket.data.userId === state?.hostId) {
            const reqIndex = pendingRequests.findIndex((r: any) => r.id === mutation.payload.requestId);
            if (reqIndex !== -1) {
                const req = pendingRequests.splice(reqIndex, 1)[0];
                if (!currentTrackId || currentTrackId === '') {
                    currentTrackId = req.trackId;
                    currentTitle = req.title;
                    currentPlayhead = 0;
                    isPlaying = true;
                    logger.info({ message: '[System] Auto-promoted approved request to idle room', roomId: mutation.payload.roomId, trackId: currentTrackId });
                } else {
                    queue.push({ videoId: req.trackId, title: req.title });
                }
            }
        }
    }
    
    if (mutation.payload.type === 'DENY_REQUEST' && mutation.payload.requestId) {
        if (socket.data.userId === state?.hostId) {
            const reqIndex = pendingRequests.findIndex((r: any) => r.id === mutation.payload.requestId);
            if (reqIndex !== -1) {
                pendingRequests.splice(reqIndex, 1);
            }
        }
    }
    if (mutation.payload.type === 'QUEUE_REMOVE' && mutation.payload.index !== undefined) {
        queue.splice(mutation.payload.index, 1);
    }
    if (mutation.payload.type === 'QUEUE_CLEAR') {
        queue = [];
    }
    if (mutation.payload.type === 'QUEUE_REORDER' && mutation.payload.index !== undefined && mutation.payload.newIndex !== undefined) {
        const item = queue.splice(mutation.payload.index, 1)[0];
        if (item) {
            queue.splice(mutation.payload.newIndex, 0, item);
        }
    }
    if (mutation.payload.type === 'QUEUE_BATCH_APPEND' && mutation.payload.items) {
        const normalized: { videoId: string; title: string }[] = (mutation.payload.items as any[]).map(i => {
            if (typeof i === 'string') return { videoId: i, title: `YouTube Track (${i})` };
            return i;
        });

        if (!currentTrackId || currentTrackId === '') {
            const batch = [...normalized];
            const first = batch.shift();
            currentTrackId = first?.videoId || '';
            currentTitle = first?.title || '';
            currentPlayhead = 0;
            isPlaying = true;
            queue = queue.concat(batch);
            logger.info({ message: '[System] Auto-promoted first track from batch to idle room', roomId: mutation.payload.roomId, trackId: currentTrackId });
        } else {
            queue = queue.concat(normalized);
        }
    }
    
    if (mutation.payload.type === 'UPDATE_IDENTITY' && mutation.payload.username) {
        socket.data.username = mutation.payload.username;
        logger.info({ message: `[Identity] User ${socket.id} updated name to ${mutation.payload.username}` });
    }

    if (mutation.payload.type === 'TRANSFER_AUTHORITY' && mutation.payload.targetUserId) {
        if (socket.id === state?.hostId) {
            const targetId = mutation.payload.targetUserId;
            // Verify target exists in room
            const sockets = await io.in(mutation.payload.roomId).fetchSockets();
            const targetSocket = sockets.find(s => s.id === targetId || s.data.userId === targetId);
            
            if (targetSocket) {
                const actualSocketId = targetSocket.id;
                await roomManager.setHost(mutation.payload.roomId, actualSocketId);
                await broadcastHostChange(mutation.payload.roomId, actualSocketId);
                logger.info({ message: `[Authority] Master transferred from ${socket.id} to ${actualSocketId}` });
            }
        }
    }

    if (mutation.payload.type === 'SKIP') {
        if (currentTrackId) {
            history.push({ 
                videoId: currentTrackId, 
                title: currentTitle || `YouTube Video (${currentTrackId})`, 
                status: 'played', 
                timestamp: Date.now() 
            });
            if (history.length > 20) history = history.slice(-20);
        }
        if (queue.length > 0) {
            const next = queue.shift();
            currentTrackId = next?.videoId || '';
            currentTitle = next?.title || '';
            currentPlayhead = 0;
            isPlaying = true;
        } else {
            currentTrackId = '';
            currentTitle = '';
            currentPlayhead = 0;
            isPlaying = false;
        }
    }

    if (mutation.payload.type === 'QUEUE_JUMP' && mutation.payload.index !== undefined) {
        if (currentTrackId) {
            history.push({ 
                videoId: currentTrackId, 
                title: currentTitle || `YouTube Video (${currentTrackId})`, 
                status: 'skipped', 
                timestamp: Date.now() 
            });
        }
        
        const preceding = queue.splice(0, mutation.payload.index + 1);
        const target = preceding.pop();
        
        preceding.forEach(item => {
            history.push({ videoId: item.videoId, title: item.title, status: 'skipped', timestamp: Date.now() });
        });

        currentTrackId = target?.videoId || '';
        currentTitle = target?.title || '';
        currentPlayhead = 0;
        isPlaying = true;
        
        if (history.length > 20) history = history.slice(-20);
    }

    if (mutation.payload.type === 'BACK') {
        if (history.length > 0) {
            if (currentTrackId) {
                queue.unshift({ videoId: currentTrackId, title: currentTitle || `YouTube Video (${currentTrackId})` });
            }
            const prev = history.pop();
            currentTrackId = prev?.videoId || '';
            currentTitle = prev?.title || '';
            currentPlayhead = 0;
            isPlaying = true;
        }
    }

    if (mutation.payload.type === 'QUEUE_PLAYLIST_REQUEST' && mutation.payload.playlistId) {
        const playlistId = mutation.payload.playlistId;
        try {
            const ytResponse = await fetch(`https://www.youtube.com/playlist?list=${playlistId}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            });
            if (ytResponse.ok) {
                const html = await ytResponse.text();
                let items: { videoId: string; title: string }[] = [];
                const jsonMatch = html.match(/var ytInitialData = ({.*?});<\/script>/);
                if (jsonMatch) {
                    try {
                        const data = JSON.parse(jsonMatch[1]);
                        const contents = data.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents;
                        if (contents) {
                            items = contents
                                .filter((i: any) => i.playlistVideoRenderer)
                                .map((i: any) => ({
                                    videoId: i.playlistVideoRenderer.videoId,
                                    title: i.playlistVideoRenderer.title?.runs?.[0]?.text || 'Unknown Title'
                                }));
                        }
                    } catch (e) {}
                }
                if (items.length === 0) {
                    const videoIdRegex = /"videoId":"([a-zA-Z0-9_-]{11})"/g;
                    const matches = Array.from(html.matchAll(videoIdRegex));
                    const videoIds = Array.from(new Set(matches.map(m => m[1])));
                    items = videoIds.map(id => ({ videoId: id, title: `Track ${id}` }));
                }

                if (items.length > 0) {
                    // Shuffle
                    for (let i = items.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [items[i], items[j]] = [items[j], items[i]];
                    }

                    if (!currentTrackId || currentTrackId === '') {
                        const batch = [...items];
                        const first = batch.shift();
                        currentTrackId = first?.videoId || '';
                        currentTitle = first?.title || '';
                        currentPlayhead = 0;
                        isPlaying = true;
                        queue = queue.concat(batch);
                    } else {
                        queue = queue.concat(items);
                    }
                }
            }
        } catch (err) {
            logger.error({ message: '[Playlist] Backend unroll failed', error: err, playlistId });
        }
    }

    await roomManager.setState(mutation.payload.roomId, {
      isPlaying,
      currentPlayhead,
      currentTrackId,
      currentTitle,
      title,
      queue,
      history,
      isPublic,
      isRequestOnly,
      pendingRequests
    });

    if (mutation.payload.type === 'SET_PEER_STATUS') {
      await broadcastRosterUpdate(mutation.payload.roomId);
      return; // Do not broadcast a full STATE_SYNC for simple roster updates
    }

    // Broadcast Sync
    const socketsInRoom = await io.in(mutation.payload.roomId).fetchSockets();
    const activePeers = buildActivePeers(socketsInRoom);

    io.to(mutation.payload.roomId).emit('STATE_SYNC', {
      event: 'STATE_SYNC',
      version: 1,
      correlationId: mutation.correlationId,
      payload: {
        roomId: mutation.payload.roomId,
        title,
        isPlaying,
        currentPlayhead,
        currentTrackId,
        updatedAt: Date.now(),
        queue,
        history,
        isPublic,
        isRequestOnly,
        pendingRequests,
        peers: activePeers,
        hostUserId: state?.hostId
      }
    });
    });
  }

  socket.on('SEND_MESSAGE', (data) => {
    const result = SendMessageSchema.safeParse(data);
    if (!result.success) {
      logger.warn({ message: 'Invalid SEND_MESSAGE schema', socket_id: socket.id, error: result.error });
      return;
    }

    const payload = result.data;
    const message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userId: socket.data.userId,
      username: socket.data.username,
      text: payload.text,
      timestamp: Date.now()
    };

    io.to(payload.roomId).emit('ROOM_MESSAGE', message);
  });

  socket.on('disconnect', async (reason) => {
    const rId = socket.data.roomId;
    const uId = socket.data.userId;
    logger.info({ message: 'Socket disconnected (initiating grace period)', socket_id: socket.id, room_id: rId, reason });
    rateLimiter.cleanup(socket.id);

    if (rId && uId) {
      // Immediate Eviction Logic (No Grace Window)
      (async () => {
        try {
          const stateStr = await redis.hget(`room:${rId}:meta`, 'state');
          if (!stateStr) return; // Room already gone
          
          const state = JSON.parse(stateStr);
          const isHost = state.hostId === uId;

          if (isHost) {
            logger.info({ message: '[System] Host disconnected, destroying room', room_id: rId, host_id: uId });
            // Announce closure to everyone before kicking
            io.to(rId).emit('ROOM_CLOSED', { message: 'Host has left the room' });
            
            // Delete room from Redis
            await redis.del(`room:${rId}:meta`, `room:${rId}:join_order`);
            
            // Force disconnect all sockets in room
            const sockets = await io.in(rId).fetchSockets();
            sockets.forEach(s => s.leave(rId));
          } else {
            // Normal member leave
            await roomManager.leave(rId, uId);
            
            io.to(rId).emit('ROOM_MESSAGE', {
              id: `sys-${Date.now()}`,
              userId: 'system',
              username: 'System',
              text: `${socket.data.username} left the room`,
              timestamp: Date.now()
            });
            
            await broadcastRosterUpdate(rId);
          }
        } catch (err) {
          logger.error({ message: 'Error handling disconnect', error: err, socket_id: socket.id });
        }
      })();
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
