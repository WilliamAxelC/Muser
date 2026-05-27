import Redis from 'ioredis';
import logger from './logger';

export class RoomManager {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
    this.defineScripts();
  }

  private defineScripts() {
    // Lua script to join a room and return the current host
    // Keys: [meta_key, join_order_key]
    // Args: [socket_id, user_id, timestamp, ttl, password, title]
    this.redis.defineCommand('joinRoom', {
      numberOfKeys: 2,
      lua: `
        local meta_key = KEYS[1]
        local join_order_key = KEYS[2]
        local socket_id = ARGV[1]
        local user_id = ARGV[2]
        local timestamp = ARGV[3]
        local ttl = ARGV[4]
        local password = ARGV[5]
        local title = ARGV[6]

        -- Check password if room exists
        local existing_password = redis.call('HGET', meta_key, 'password')
        if existing_password and existing_password ~= '' and existing_password ~= password then
          return 'ERR_INVALID_PASSWORD'
        end

        -- Add user to join order
        redis.call('ZADD', join_order_key, timestamp, socket_id)
        redis.call('EXPIRE', join_order_key, ttl)

        -- Check if host exists
        local host_uid = redis.call('HGET', meta_key, 'host_uid')
        if not host_uid or host_uid == '' then
          redis.call('HSET', meta_key, 'host_uid', socket_id)
          redis.call('HSET', meta_key, 'is_playing', '0')
          redis.call('HSET', meta_key, 'current_track_id', '')
          redis.call('HSET', meta_key, 'current_title', '')
          redis.call('HSET', meta_key, 'last_playhead', '0')
          redis.call('HSET', meta_key, 'updated_at', timestamp)
          redis.call('HSET', meta_key, 'queue', '[]')
          redis.call('HSET', meta_key, 'history', '[]')
          redis.call('HSET', meta_key, 'title', title)
          if password and password ~= '' then
            redis.call('HSET', meta_key, 'password', password)
          end
          host_uid = socket_id
        end
        redis.call('EXPIRE', meta_key, ttl)

        return host_uid
      `,
    });

    // Lua script to leave a room and handle host migration
    // Keys: [meta_key, join_order_key]
    // Args: [socket_id, timestamp, ttl]
    this.redis.defineCommand('leaveRoom', {
      numberOfKeys: 2,
      lua: `
        local meta_key = KEYS[1]
        local join_order_key = KEYS[2]
        local socket_id = ARGV[1]
        local timestamp = ARGV[2]
        local ttl = ARGV[3]

        -- Remove from join order
        redis.call('ZREM', join_order_key, socket_id)

        -- Check if it was the host
        local host_uid = redis.call('HGET', meta_key, 'host_uid')
        local new_host = host_uid

        if host_uid == socket_id then
          -- Elect new host: lowest score in ZSET
          local next_host = redis.call('ZRANGE', join_order_key, 0, 0)
          if next_host[1] then
            new_host = next_host[1]
            redis.call('HSET', meta_key, 'host_uid', new_host)
            redis.call('HSET', meta_key, 'updated_at', timestamp)
            redis.call('EXPIRE', meta_key, ttl)
            redis.call('EXPIRE', join_order_key, ttl)
          else
            -- Room is empty, delete
            redis.call('DEL', meta_key)
            redis.call('DEL', join_order_key)
            new_host = ''
          end
        end

        return new_host
      `,
    });
  }

  async join(roomId: string, socketId: string, userId: string, password?: string, title?: string): Promise<string> {
    const metaKey = `room:${roomId}:meta`;
    const joinOrderKey = `room:${roomId}:join_order`;
    const ttl = 12 * 60 * 60; // 12 hours
    const timestamp = Date.now();

    // @ts-ignore - custom command
    const result = await this.redis.joinRoom(metaKey, joinOrderKey, socketId, userId, timestamp, ttl, password || '', title || roomId);
    if (result === 'ERR_INVALID_PASSWORD') {
      throw new Error('INVALID_PASSWORD');
    }
    return result;
  }

  async leave(roomId: string, socketId: string): Promise<string> {
    const metaKey = `room:${roomId}:meta`;
    const joinOrderKey = `room:${roomId}:join_order`;
    const ttl = 12 * 60 * 60;
    const timestamp = Date.now();

    // @ts-ignore - custom command
    return await this.redis.leaveRoom(metaKey, joinOrderKey, socketId, timestamp, ttl);
  }

  async setState(roomId: string, state: { 
    isPlaying: boolean, 
    currentPlayhead: number, 
    currentTrackId: string,
    currentTitle?: string,
    title?: string,
    queue?: { videoId: string; title: string }[],
    history?: { videoId: string; title: string; status: 'played' | 'skipped'; timestamp: number }[],
    isPublic?: boolean,
    isRequestOnly?: boolean,
    pendingRequests?: { id: string; trackId: string; title: string; username: string }[]
  }) {
    const metaKey = `room:${roomId}:meta`;
    const ttl = 12 * 60 * 60;
    const timestamp = Date.now();

    const update: any = {
      is_playing: state.isPlaying ? '1' : '0',
      last_playhead: state.currentPlayhead.toString(),
      current_track_id: state.currentTrackId,
      current_title: state.currentTitle || '',
      updated_at: timestamp.toString()
    };
    if (state.queue) {
      update.queue = JSON.stringify(state.queue);
    }
    if (state.history) {
      update.history = JSON.stringify(state.history);
    }
    if (state.isPublic !== undefined) {
      update.is_public = state.isPublic ? '1' : '0';
    }
    if (state.isRequestOnly !== undefined) {
      update.is_request_only = state.isRequestOnly ? '1' : '0';
    }
    if (state.pendingRequests) {
      update.pending_requests = JSON.stringify(state.pendingRequests);
    }

    await this.redis.hset(metaKey, update);
    await this.redis.expire(metaKey, ttl);
  }

  async getState(roomId: string) {
    const metaKey = `room:${roomId}:meta`;
    const data = await this.redis.hgetall(metaKey);
    if (!data || Object.keys(data).length === 0) return null;

    return {
      hostId: data.host_uid,
      isPlaying: data.is_playing === '1',
      currentPlayhead: parseFloat(data.last_playhead || '0'),
      currentTrackId: data.current_track_id || '',
      currentTitle: data.current_title || '',
      title: data.title || roomId,
      updatedAt: parseInt(data.updated_at || '0'),
      queue: JSON.parse(data.queue || '[]') as { videoId: string; title: string }[],
      history: JSON.parse(data.history || '[]') as { videoId: string; title: string; status: 'played' | 'skipped'; timestamp: number }[],
      isPublic: data.is_public === '1',
      isRequestOnly: data.is_request_only === '1',
      pendingRequests: JSON.parse(data.pending_requests || '[]') as { id: string; trackId: string; title: string; username: string }[]
    };
  }

  async getActivePublicRooms() {
    const keys = await this.redis.keys('room:*:meta');
    const rooms = [];
    for (const key of keys) {
      const data = await this.redis.hgetall(key);
      if (data && data.is_public === '1') {
        const roomId = key.split(':')[1];
        // Could fetch join_order size for user count if needed
        rooms.push({
          roomId,
          updatedAt: parseInt(data.updated_at || '0')
        });
      }
    }
    return rooms.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async setHost(roomId: string, socketId: string) {
    const metaKey = `room:${roomId}:meta`;
    await this.redis.hset(metaKey, 'host_uid', socketId);
  }

  async updateSocketId(roomId: string, oldSocketId: string, newSocketId: string) {
    const metaKey = `room:${roomId}:meta`;
    const joinOrderKey = `room:${roomId}:join_order`;
    const ttl = 12 * 60 * 60;

    // Check if the old socket is in the join order
    const score = await this.redis.zscore(joinOrderKey, oldSocketId);
    if (score !== null) {
      await this.redis.zrem(joinOrderKey, oldSocketId);
      await this.redis.zadd(joinOrderKey, score, newSocketId);
      await this.redis.expire(joinOrderKey, ttl);
    }

    // Check if it was the host
    const hostUid = await this.redis.hget(metaKey, 'host_uid');
    if (hostUid === oldSocketId) {
      await this.redis.hset(metaKey, 'host_uid', newSocketId);
      await this.redis.expire(metaKey, ttl);
    }
  }
}
