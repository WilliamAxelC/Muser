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

    const socket = io(import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000', {
      query: { roomId, userId, correlationId: `ui-${userId}` }
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      console.log('Connected to backend');
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('STATE_SYNC', (data: any) => {
      setRoomState(data.payload);
    });

    socket.on('HOST_CHANGED', (data: any) => {
      setHostId(data.hostId);
    });

    return () => {
      socket.disconnect();
    };
  }, [roomId, userId]);

  const emitMutation = (type: string, payload: any = {}) => {
    if (!socketRef.current || !roomId) return;

    socketRef.current.emit('ROOM_MUTATION' as any, {
      action: 'ROOM_MUTATION',
      version: 1,
      correlationId: `ui-${Date.now()}`,
      payload: {
        roomId,
        type,
        timestamp: Date.now(),
        ...payload
      }
    });
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
