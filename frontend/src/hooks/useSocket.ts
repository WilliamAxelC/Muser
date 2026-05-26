import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface StateSync {
  isPlaying: boolean;
  currentPlayhead: number;
  currentTrackId: string;
  updatedAt: number;
}

export function useSocket(roomId: string | null, userId: string) {
  const [isConnected, setIsConnected] = useState(false);
  const [roomState, setRoomState] = useState<StateSync | null>(null);
  const [hostId, setHostId] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!roomId) return;

    console.log(`[Diagnostic] Attempting Socket.io connection to: ${window.location.origin}`);

    const socket = io(window.location.origin, {
      path: '/socket.io/',
      query: { roomId, userId, correlationId: `ui-${userId}` },
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
      setRoomState(data.payload);
    });

    socket.on('HOST_CHANGED', (data: any) => {
      console.log('[Diagnostic] Received HOST_CHANGED:', data);
      setHostId(data.hostId);
    });

    return () => {
      console.log('[Diagnostic] Cleaning up socket connection.');
      socket.disconnect();
    };
  }, [roomId, userId]);

  const emitMutation = (type: string, payload: any = {}) => {
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
  };

  return {
    isConnected,
    roomState,
    hostId,
    isHost: socketRef.current?.id === hostId,
    emitMutation,
    socketId: socketRef.current?.id
  };
}
