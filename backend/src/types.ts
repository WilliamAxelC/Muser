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
  ROSTER_UPDATE: (data: { peers: { socketId: string; userId: string; username: string; isDetached?: boolean }[] }) => void;
  ROOM_CLOSED: (data: { message: string }) => void;
}

export interface InterServerEvents {}

export interface SocketData {
  userId: string;
  username: string;
  roomId: string;
  isDetached?: boolean;
}

export interface QueueItem {
  videoId: string;
  title: string;
}

export interface HistoryItem extends QueueItem {
  status: 'played' | 'skipped';
  timestamp: number;
}

export interface RoomMutation {
  action: 'ROOM_MUTATION';
  version: number;
  correlationId: string;
  payload: {
    roomId: string;
    type: 'PLAY' | 'PAUSE' | 'SEEK' | 'SKIP' | 'BACK' | 'QUEUE_REORDER' | 'QUEUE_JUMP' | 'ROOM_RESYNC' | 'QUEUE_ADD' | 'QUEUE_REMOVE' | 'QUEUE_CLEAR' | 'QUEUE_BATCH_APPEND' | 'SET_PUBLIC' | 'SET_REQUEST_ONLY' | 'APPROVE_REQUEST' | 'DENY_REQUEST' | 'APPROVE_ALL_REQUESTS' | 'DENY_ALL_REQUESTS' | 'UPDATE_IDENTITY' | 'TRANSFER_AUTHORITY' | 'QUEUE_PLAYLIST_REQUEST' | 'SET_TITLE' | 'SET_PEER_STATUS';
    playhead?: number;
    currentTrackId?: string;
    timestamp: number;
    item?: string;
    items?: string[];
    index?: number;
    newIndex?: number;
    isPublic?: boolean;
    isRequestOnly?: boolean;
    requestId?: string;
    username?: string;
    targetUserId?: string;
    playlistId?: string;
    title?: string;
    isDetached?: boolean;
  };
}

export interface StateSync {
  event: 'STATE_SYNC';
  version: number;
  correlationId: string;
  payload: {
    roomId: string;
    title: string;
    isPlaying: boolean;
    currentPlayhead: number;
    currentTrackId: string;
    updatedAt: number;
    queue: QueueItem[];
    history: HistoryItem[];
    isPublic?: boolean;
    isRequestOnly?: boolean;
    pendingRequests?: { id: string; trackId: string; title: string; username: string }[];
    peers?: { socketId: string; userId: string; username: string; isDetached?: boolean }[];
    hostUserId?: string;
  };
}
