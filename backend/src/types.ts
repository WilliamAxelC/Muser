import { Socket } from 'socket.io';

export interface ClientToServerEvents {
  ROOM_MUTATION: (data: RoomMutation) => void;
}

export interface ServerToClientEvents {
  STATE_SYNC: (data: StateSync) => void;
  HOST_CHANGED: (data: { hostId: string }) => void;
}

export interface InterServerEvents {}

export interface SocketData {
  userId: string;
  roomId: string;
}

export interface RoomMutation {
  action: 'ROOM_MUTATION';
  version: number;
  correlationId: string;
  payload: {
    roomId: string;
    type: 'PLAY' | 'PAUSE' | 'SEEK' | 'SKIP' | 'QUEUE_REORDER' | 'ROOM_RESYNC';
    playhead?: number;
    timestamp: number;
  };
}

export interface StateSync {
  event: 'STATE_SYNC';
  version: number;
  correlationId: string;
  payload: {
    roomId: string;
    isPlaying: boolean;
    currentPlayhead: number;
    currentTrackId: string;
    updatedAt: number;
  };
}
