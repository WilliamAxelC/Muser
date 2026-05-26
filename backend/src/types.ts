import { Socket } from 'socket.io';

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  text: string;
  timestamp: number;
}

export interface ClientToServerEvents {
  ROOM_MUTATION: (data: RoomMutation) => void;
  SEND_MESSAGE: (data: { roomId: string; text: string }) => void;
}

export interface ServerToClientEvents {
  STATE_SYNC: (data: StateSync) => void;
  HOST_CHANGED: (data: { hostId: string, hostName?: string }) => void;
  ERROR: (data: { message: string }) => void;
  ROOM_MESSAGE: (data: ChatMessage) => void;
}

export interface InterServerEvents {}

export interface SocketData {
  userId: string;
  username: string;
  roomId: string;
}

export interface RoomMutation {
  action: 'ROOM_MUTATION';
  version: number;
  correlationId: string;
  payload: {
    roomId: string;
    type: 'PLAY' | 'PAUSE' | 'SEEK' | 'SKIP' | 'QUEUE_REORDER' | 'ROOM_RESYNC' | 'QUEUE_ADD' | 'QUEUE_REMOVE' | 'QUEUE_CLEAR' | 'QUEUE_BATCH_APPEND' | 'SET_PUBLIC';
    playhead?: number;
    currentTrackId?: string;
    timestamp: number;
    item?: string;
    items?: string[];
    index?: number;
    newIndex?: number;
    isPublic?: boolean;
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
    queue: string[];
    isPublic?: boolean;
  };
}
