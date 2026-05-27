import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  text: string;
  timestamp: number;
}

export interface QueueItem {
  videoId: string;
  title: string;
}

export interface HistoryItem extends QueueItem {
  status: 'played' | 'skipped';
  timestamp: number;
}

interface StateSync {
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
  peers?: { socketId: string; userId: string; username: string }[];
  hostUserId?: string;
}

export function useSocket(roomId: string | null, userId: string, username: string, password?: string, title?: string, isUnsynced: boolean = false, onRoomClosed?: (message: string) => void) {
  const [isConnected, setIsConnected] = useState(false);
  const [roomState, setRoomState] = useState<StateSync | null>(null);
  const [hostId, setHostId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const isUnsyncedRef = useRef(isUnsynced);

  useEffect(() => {
    isUnsyncedRef.current = isUnsynced;
  }, [isUnsynced]);

  useEffect(() => {
    if (!roomId) return;

    console.log(`[Diagnostic] Attempting Socket.io connection to: ${window.location.origin}`);

    const socket = io(window.location.origin, {
      path: '/socket.io/',
      query: { roomId, userId, username, password, title, correlationId: `ui-${userId}` },
      transports: ['websocket', 'polling']
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      console.log(`[Diagnostic] Connected to backend successfully. Socket ID: ${socket.id}, Origin: ${window.location.origin}`);
    });

    socket.on('connect_error', (error) => {
      console.error('[Diagnostic] Socket connection error:', error, error.message, error.cause);
    });

    socket.on('disconnect', (reason) => {
      setIsConnected(false);
      console.warn(`[Diagnostic] Socket disconnected. Reason: ${reason}`);
    });

    socket.on('STATE_SYNC', (data: any) => {
      console.log('[Diagnostic] Received STATE_SYNC:', data);
      if (isUnsyncedRef.current) {
        console.log('[Diagnostic] Blocked STATE_SYNC due to detached mode');
        return;
      }
      setRoomState(data.payload);
    });

    socket.on('ROSTER_UPDATE', (data: any) => {
      console.log('[Diagnostic] Received ROSTER_UPDATE:', data);
      setRoomState((prevState) => {
        if (!prevState) return prevState;
        return { ...prevState, peers: data.peers };
      });
    });

    socket.on('HOST_CHANGED', (data: any) => {
      console.log('[Diagnostic] Received HOST_CHANGED:', data);
      setHostId(data.hostId);
    });

    socket.on('ROOM_MESSAGE', (message: ChatMessage) => {
      setMessages((prev) => [...prev, message]);
    });

    socket.on('ROOM_CLOSED', (data: any) => {
      console.log('[Diagnostic] Received ROOM_CLOSED from server:', data.message);
      if (onRoomClosed) {
        onRoomClosed(data.message);
      }
    });

    socket.on('ERROR', (data: any) => {
      console.error('[Diagnostic] Received ERROR from server:', data.message);
      // For immediate visibility to the user
      alert(`MRelay Server Notice:\n${data.message}`);
    });

    return () => {
      console.log('[Diagnostic] Cleaning up socket connection.');
      socket.disconnect();
      setMessages([]);
      setRoomState(null);
      setHostId(null);
    };
  }, [roomId, userId, username, title, onRoomClosed]);

  const emitMutation = useCallback((type: string, payload: any = {}) => {
    if (!socketRef.current || !roomId) {
        console.warn(`[Diagnostic] Emit aborted. socketRef: ${!!socketRef.current}, roomId: ${roomId}`);
        return;
    }

    const mutationData = {
      action: 'ROOM_MUTATION',
      version: 1,
      correlationId: `ui-${Date.now()}`,
      payload: {
        roomId,
        type,
        timestamp: Date.now(),
        ...payload
      }
    };

    console.log(`[Diagnostic] Emitting ROOM_MUTATION: ${type}`, mutationData);
    socketRef.current.emit('ROOM_MUTATION' as any, mutationData);
    console.log(`[Diagnostic] ROOM_MUTATION emit executed for ${type}`);
  }, [roomId]);

  const sendMessage = useCallback((text: string) => {
    if (!socketRef.current || !roomId) return;
    socketRef.current.emit('SEND_MESSAGE', { roomId, text });
  }, [roomId]);

  return {
    isConnected,
    roomState,
    hostId,
    isHost: userId === hostId,
    emitMutation,
    socketId: socketRef.current?.id,
    messages,
    sendMessage
  };
}
