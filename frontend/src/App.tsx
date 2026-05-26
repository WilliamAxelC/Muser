import React, { useState } from 'react';
import { useSocket } from './hooks/useSocket';
import { cn } from './lib/utils';
import { Play, Pause, SkipForward, Users, Radio, LogOut } from 'lucide-react';

function App() {
  const [userId] = useState(() => `user-${Math.random().toString(36).substr(2, 9)}`);
  const [inputRoomId, setInputRoomId] = useState('');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);

  const { isConnected, roomState, hostId, isHost, emitMutation, socketId } = useSocket(activeRoomId, userId);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputRoomId.trim()) {
      setActiveRoomId(inputRoomId.trim().toUpperCase());
    }
  };

  const handleLeave = () => {
    setActiveRoomId(null);
    setInputRoomId('');
  };

  if (!activeRoomId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-8 bg-zinc-900/50 p-8 rounded-2xl border border-zinc-800 backdrop-blur-sm">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-zinc-800 mb-4">
              <Radio className="w-8 h-8 text-zinc-400" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white">MRelay</h1>
            <p className="text-zinc-400">Collaborative Sync-Stream Platform</p>
          </div>

          <form onSubmit={handleJoin} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="room-id" className="text-sm font-medium text-zinc-400 ml-1">
                Room ID
              </label>
              <input
                id="room-id"
                type="text"
                placeholder="ENTER ROOM CODE"
                value={inputRoomId}
                onChange={(e) => setInputRoomId(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-lg font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-zinc-700 transition-all placeholder:text-zinc-700 uppercase"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-white text-black font-bold py-3 rounded-xl hover:bg-zinc-200 active:scale-[0.98] transition-all"
            >
              Join Room
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col p-4 md:p-8 max-w-4xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between mb-12">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <h2 className="text-2xl font-bold text-white leading-none">{activeRoomId}</h2>
            <div className="flex items-center gap-2 mt-1">
              <div className={cn("w-2 h-2 rounded-full", isConnected ? "bg-green-500" : "bg-red-500")} />
              <span className="text-xs text-zinc-500 font-medium uppercase tracking-wider">
                {isConnected ? "Synchronized" : "Disconnected"}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={handleLeave}
          className="p-2 hover:bg-zinc-900 rounded-lg transition-colors text-zinc-400 hover:text-white"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center space-y-12">
        {/* Mock Player */}
        <div className="w-full aspect-video bg-zinc-900 rounded-3xl border border-zinc-800 flex flex-col items-center justify-center relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-b from-zinc-900/0 to-zinc-900/50" />
          
          <div className="z-10 text-center space-y-4 p-6">
             <div className="text-sm font-medium text-zinc-500 uppercase tracking-widest">Now Streaming</div>
             <h3 className="text-xl md:text-3xl font-bold text-white max-w-md mx-auto leading-tight">
               {roomState?.currentTrackId || "No Track Selected"}
             </h3>
             <div className="flex items-center justify-center gap-4 text-zinc-400 text-sm font-mono">
               <span>{Math.floor(roomState?.currentPlayhead || 0)}s</span>
               <div className="w-48 h-1 bg-zinc-800 rounded-full overflow-hidden">
                 <div 
                   className="h-full bg-white transition-all duration-1000" 
                   style={{ width: `${Math.min(100, (roomState?.currentPlayhead || 0) / 3)}%` }} 
                 />
               </div>
               <span>--:--</span>
             </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-8">
          <button className="p-4 bg-zinc-900 hover:bg-zinc-800 rounded-2xl border border-zinc-800 text-zinc-400 transition-all hover:scale-105 active:scale-95">
            <SkipForward className="w-6 h-6 rotate-180" />
          </button>
          
          <button 
            onClick={() => emitMutation(roomState?.isPlaying ? 'PAUSE' : 'PLAY')}
            disabled={!isHost}
            className={cn(
              "w-20 h-20 flex items-center justify-center rounded-3xl transition-all hover:scale-105 active:scale-95 shadow-xl disabled:opacity-50 disabled:cursor-not-allowed",
              roomState?.isPlaying ? "bg-zinc-900 border border-zinc-800 text-white" : "bg-white text-black"
            )}
          >
            {roomState?.isPlaying ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current" />}
          </button>

          <button className="p-4 bg-zinc-900 hover:bg-zinc-800 rounded-2xl border border-zinc-800 text-zinc-400 transition-all hover:scale-105 active:scale-95">
            <SkipForward className="w-6 h-6" />
          </button>
        </div>
      </main>

      {/* Footer / Info */}
      <footer className="mt-12 pt-8 border-t border-zinc-900 grid grid-cols-2 gap-4">
        <div className="bg-zinc-900/30 p-4 rounded-2xl border border-zinc-800/50">
          <div className="flex items-center gap-2 mb-2 text-zinc-500 uppercase text-[10px] font-bold tracking-widest">
            <Users className="w-3 h-3" />
            Host Status
          </div>
          <div className="text-sm font-medium">
            {isHost ? "You are the Master" : "Listening to Peer"}
          </div>
          <div className="text-[10px] text-zinc-600 font-mono mt-1 truncate">
            {hostId || "Waiting..."}
          </div>
        </div>

        <div className="bg-zinc-900/30 p-4 rounded-2xl border border-zinc-800/50">
          <div className="flex items-center gap-2 mb-2 text-zinc-500 uppercase text-[10px] font-bold tracking-widest">
            <Radio className="w-3 h-3" />
            Your Identity
          </div>
          <div className="text-sm font-medium truncate">{userId}</div>
          <div className="text-[10px] text-zinc-600 font-mono mt-1 truncate">{socketId}</div>
        </div>
      </footer>
    </div>
  );
}

export default App;
