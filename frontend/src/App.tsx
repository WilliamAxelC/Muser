import React, { useState, useRef } from 'react';
import { useSocket } from './hooks/useSocket';
import { cn } from './lib/utils';
import { Play, Pause, SkipForward, Users, Radio, LogOut, Plus, Settings, Lock, Share2, Check, MessageSquare, ListMusic, VolumeX, Headphones } from 'lucide-react';
import { YouTubePlayer } from './components/YouTubePlayer';
import type { YouTubePlayerRef } from './components/YouTubePlayer';
import { ChatView } from './components/ChatView';
import { QueueView } from './components/QueueView';

function App() {
  const [userId] = useState(() => {
    const saved = localStorage.getItem('mrelay_user_id');
    if (saved) return saved;
    const newId = `user-${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('mrelay_user_id', newId);
    return newId;
  });
  
  const [username, setUsername] = useState(() => {
    return localStorage.getItem('mrelay_username') || `Guest_${userId.substr(5, 4)}`;
  });

  const [inputRoomId, setInputRoomId] = useState('');
  const [activeRoomId, setActiveRoomId] = useState<string | null>(() => {
    const match = window.location.pathname.match(/^\/room\/([A-Za-z0-9_-]+)/);
    return match ? match[1].toUpperCase() : null;
  });
  const [trackUrl, setTrackUrl] = useState('');
  const [volume, setVolume] = useState(50);
  const [dataSaver, setDataSaver] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [roomPassword, setRoomPassword] = useState('');
  const [copied, setCopied] = useState(false);
  const [mobileTab, setMobileTab] = useState<'queue' | 'chat'>('chat');
  const [audioMode, setAudioMode] = useState<'sync' | 'passive'>('sync');

  const handleCopyLink = () => {
    const link = `${window.location.origin}/room/${activeRoomId?.toLowerCase()}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  React.useEffect(() => {
    if (activeRoomId) {
      window.history.replaceState({}, '', `/room/${activeRoomId.toLowerCase()}`);
    } else {
      window.history.replaceState({}, '', '/');
    }
  }, [activeRoomId]);

  const { isConnected, roomState, hostId, isHost, emitMutation, socketId, messages, sendMessage } = useSocket(activeRoomId, userId, username, roomPassword);
  const ytPlayerRef = useRef<YouTubePlayerRef>(null);

  const handleNameChange = (newName: string) => {
    setUsername(newName);
    localStorage.setItem('mrelay_username', newName);
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputRoomId.trim()) {
      setActiveRoomId(inputRoomId.trim().toUpperCase());
    }
  };

  const handleAddTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackUrl.trim()) return;

    // Check for Playlist
    const listRegex = /[?&]list=([a-zA-Z0-9_-]+)/;
    const listMatch = trackUrl.match(listRegex);

    if (listMatch) {
      const listId = listMatch[1];
      try {
        const response = await fetch(`/api/playlist/${listId}`);
        if (response.ok) {
          const data = await response.json();
          let items = data.items || [];
          
          // Fisher-Yates shuffle
          for (let i = items.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [items[i], items[j]] = [items[j], items[i]];
          }
          
          if (items.length > 0) {
            if (!roomState?.currentTrackId) {
              const first = items.shift();
              emitMutation('ROOM_RESYNC', { currentTrackId: first, playhead: 0 });
              if (items.length > 0) {
                emitMutation('QUEUE_BATCH_APPEND', { items });
              }
            } else {
              emitMutation('QUEUE_BATCH_APPEND', { items });
            }
            setTrackUrl('');
          }
        }
      } catch (err) {
        console.error('Failed to fetch playlist', err);
      }
      return;
    }

    // Comprehensive YouTube ID extractor
    const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|music\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/;
    const match = trackUrl.match(regex);
    const videoId = match ? match[1] : (trackUrl.trim().length === 11 ? trackUrl.trim() : null);
    
    if (videoId) {
      if (!roomState?.currentTrackId) {
        emitMutation('ROOM_RESYNC', { currentTrackId: videoId, playhead: 0 });
      } else {
        emitMutation('QUEUE_ADD', { item: videoId });
      }
      setTrackUrl('');
    } else {
      console.warn('Invalid YouTube URL or ID');
    }
  };

  const handlePlayerStateChange = (state: { isPlaying: boolean; playhead: number }) => {
    emitMutation(state.isPlaying ? 'PLAY' : 'PAUSE', { playhead: state.playhead });
  };

  // MediaSession API Integration
  React.useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: roomState?.currentTrackId || 'MRelay',
        artist: activeRoomId || 'Sync Stream',
        album: 'Collaborative Music',
      });

      navigator.mediaSession.setActionHandler('play', () => emitMutation('PLAY'));
      navigator.mediaSession.setActionHandler('pause', () => emitMutation('PAUSE'));
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        if (isHost) emitMutation('SKIP');
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (isHost && details.seekTime !== undefined) {
           emitMutation('SEEK', { playhead: details.seekTime });
        }
      });
      
      navigator.mediaSession.playbackState = roomState?.isPlaying ? 'playing' : 'paused';
    }
  }, [roomState?.currentTrackId, roomState?.isPlaying, activeRoomId, emitMutation, isHost]);

  const [publicRooms, setPublicRooms] = useState<{roomId: string, updatedAt: number}[]>([]);
  const [isCreatingPublic, setIsCreatingPublic] = useState(true);

  React.useEffect(() => {
    if (!activeRoomId) {
      fetch('/api/rooms').then(res => res.json()).then(data => {
        if (data.rooms) setPublicRooms(data.rooms);
      }).catch(err => console.error(err));
    }
  }, [activeRoomId]);

  const handleLeave = () => {
    setActiveRoomId(null);
    setInputRoomId('');
  };

  const handleCreateRoom = () => {
    const newRoomId = Math.random().toString(36).substr(2, 6).toUpperCase();
    setActiveRoomId(newRoomId);
    // Setting public state happens after connecting, we need to wait for isConnected
  };

  React.useEffect(() => {
    if (activeRoomId && isConnected && isHost) {
        emitMutation('SET_PUBLIC', { isPublic: isCreatingPublic });
    }
  }, [activeRoomId, isConnected, isHost]);

  if (!activeRoomId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-8 bg-zinc-900/50 p-8 rounded-2xl border border-zinc-800 backdrop-blur-sm">
            <div className="space-y-2">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-zinc-800 mb-4">
                <Radio className="w-8 h-8 text-zinc-400" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-white">MRelay</h1>
              <p className="text-zinc-400">Collaborative Sync-Stream Platform</p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="username" className="text-sm font-medium text-zinc-400 ml-1">
                  Display Name
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-zinc-700 transition-all placeholder:text-zinc-700 text-white"
                />
              </div>
              <div className="pt-4 border-t border-zinc-800">
                <h3 className="text-sm font-bold text-zinc-300 uppercase mb-4">Create New Room</h3>
                <div className="flex flex-col gap-4 mb-4">
                  <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
                    <input type="checkbox" checked={isCreatingPublic} onChange={(e) => setIsCreatingPublic(e.target.checked)} className="rounded border-zinc-700 bg-zinc-900 text-white" />
                    Public Room
                  </label>
                  <div className="space-y-2">
                    <label htmlFor="create-password" className="text-xs font-medium text-zinc-500 ml-1">
                      Room Password (Optional)
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                      <input
                        id="create-password"
                        type="password"
                        placeholder="••••••••"
                        value={roomPassword}
                        onChange={(e) => setRoomPassword(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-700 transition-all placeholder:text-zinc-800 text-white"
                      />
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleCreateRoom}
                  className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-500 active:scale-[0.98] transition-all"
                >
                  Create Room
                </button>
              </div>
              <form onSubmit={handleJoin} className="pt-4 border-t border-zinc-800">
                 <h3 className="text-sm font-bold text-zinc-300 uppercase mb-4">Join Existing</h3>
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      id="room-id"
                      type="text"
                      placeholder="ROOM CODE"
                      value={inputRoomId}
                      onChange={(e) => setInputRoomId(e.target.value)}
                      className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-zinc-700 transition-all placeholder:text-zinc-700 uppercase text-white"
                    />
                    <button
                      type="submit"
                      className="bg-white text-black font-bold px-6 rounded-xl hover:bg-zinc-200 active:scale-[0.98] transition-all"
                    >
                      Join
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                    <input
                      type="password"
                      placeholder="Room Password (if required)"
                      value={roomPassword}
                      onChange={(e) => setRoomPassword(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-700 transition-all placeholder:text-zinc-800 text-white"
                    />
                  </div>
                </div>
              </form>
            </div>
          </div>
          
          <div className="space-y-4 bg-zinc-900/50 p-8 rounded-2xl border border-zinc-800 backdrop-blur-sm flex flex-col">
            <h3 className="text-lg font-bold text-zinc-300 uppercase tracking-widest border-b border-zinc-800 pb-4">Public Rooms</h3>
            <div className="flex-1 overflow-y-auto space-y-2 py-4">
               {publicRooms.length === 0 ? (
                 <div className="text-zinc-500 text-sm text-center mt-8">No public rooms available.</div>
               ) : (
                 publicRooms.map((room) => (
                   <div key={room.roomId} className="flex items-center justify-between p-4 bg-zinc-950 rounded-xl border border-zinc-800 hover:border-zinc-700 transition-colors">
                     <span className="font-mono text-zinc-300 font-bold">{room.roomId}</span>
                     <button onClick={() => setActiveRoomId(room.roomId)} className="text-sm bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg transition-colors">Join</button>
                   </div>
                 ))
               )}
            </div>
          </div>
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
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-white leading-none">{activeRoomId}</h2>
              <button 
                onClick={handleCopyLink}
                className="p-1 hover:bg-zinc-900 rounded-md transition-all text-zinc-500 hover:text-white"
                title="Copy Invite Link"
              >
                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Share2 className="w-4 h-4" />}
              </button>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className={cn("w-2 h-2 rounded-full", isConnected ? "bg-green-500" : "bg-red-500")} />
              <span className="text-xs text-zinc-500 font-medium uppercase tracking-wider">
                {isConnected ? "Synchronized" : "Disconnected"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isHost && (
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={cn(
                "p-2 rounded-lg transition-colors",
                showSettings ? "bg-white text-black" : "text-zinc-400 hover:text-white hover:bg-zinc-900"
              )}
            >
              <Settings className="w-5 h-5" />
            </button>
          )}

          <button
            onClick={handleLeave}
            className="p-2 hover:bg-zinc-900 rounded-lg transition-colors text-zinc-400 hover:text-white"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {showSettings && isHost && (
        <div className="mb-8 p-6 bg-zinc-900 rounded-3xl border border-zinc-800 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-widest">Room Settings</h3>
            <button 
              onClick={handleCopyLink}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-xs font-bold text-white transition-all active:scale-95"
            >
              {copied ? <Check className="w-3 h-3 text-green-500" /> : <Share2 className="w-3 h-3" />}
              {copied ? "Copied!" : "Copy Invite Link"}
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-white">Public Discovery</div>
                  <div className="text-xs text-zinc-500">Visible in the global room list</div>
                </div>
                <button 
                  onClick={() => emitMutation('SET_PUBLIC', { isPublic: !roomState?.isPublic })}
                  className={cn(
                    "w-12 h-6 rounded-full transition-colors relative",
                    roomState?.isPublic ? "bg-blue-600" : "bg-zinc-800"
                  )}
                >
                  <div className={cn("w-4 h-4 bg-white rounded-full absolute top-1 transition-all", roomState?.isPublic ? "right-1" : "left-1")} />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-white">Governance Mode</div>
                  <div className="text-xs text-zinc-500">Require host approval for songs</div>
                </div>
                <button 
                  onClick={() => emitMutation('SET_REQUEST_ONLY', { isRequestOnly: !roomState?.isRequestOnly })}
                  className={cn(
                    "w-12 h-6 rounded-full transition-colors relative",
                    roomState?.isRequestOnly ? "bg-blue-600" : "bg-zinc-800"
                  )}
                >
                  <div className={cn("w-4 h-4 bg-white rounded-full absolute top-1 transition-all", roomState?.isRequestOnly ? "right-1" : "left-1")} />
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="p-4 bg-zinc-950 rounded-2xl border border-zinc-800/50">
                 <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">Audio Topology</div>
                 <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => setAudioMode('sync')}
                      className={cn(
                        "flex flex-col items-center gap-2 p-3 rounded-xl border transition-all",
                        audioMode === 'sync' ? "bg-blue-500/10 border-blue-500 text-blue-400" : "bg-zinc-900 border-zinc-800 text-zinc-500"
                      )}
                    >
                      <Headphones className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase">Master Sync</span>
                    </button>
                    <button 
                      onClick={() => setAudioMode('passive')}
                      className={cn(
                        "flex flex-col items-center gap-2 p-3 rounded-xl border transition-all",
                        audioMode === 'passive' ? "bg-zinc-800 border-zinc-700 text-zinc-300" : "bg-zinc-900 border-zinc-800 text-zinc-500"
                      )}
                    >
                      <VolumeX className="w-4 h-4" />
                      <span className="text-[10px] font-bold uppercase">Passive</span>
                    </button>
                 </div>
              </div>
              
              <div className="p-4 bg-zinc-950 rounded-2xl border border-zinc-800/50">
                 <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Room Authority</div>
                 <div className="text-xs text-zinc-400">Host ID: <span className="font-mono text-blue-400">{hostId}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col lg:grid lg:grid-cols-3 gap-8 w-full">
        {/* Left: Queue (Desktop) / Tabbed (Mobile) */}
        <div className={cn(
          "lg:col-span-1 h-[500px]",
          mobileTab !== 'queue' && "hidden lg:block"
        )}>
          <QueueView 
            queue={roomState?.queue || []} 
            isHost={isHost} 
            onReorder={(oldIndex, newIndex) => emitMutation('QUEUE_REORDER', { index: oldIndex, newIndex })}
            onRemove={(index) => emitMutation('QUEUE_REMOVE', { index })}
            isRequestOnly={roomState?.isRequestOnly}
            onToggleRequestOnly={(val) => emitMutation('SET_REQUEST_ONLY', { isRequestOnly: val })}
            pendingRequests={roomState?.pendingRequests}
            onApprove={(id) => emitMutation('APPROVE_REQUEST', { requestId: id })}
            onDeny={(id) => emitMutation('DENY_REQUEST', { requestId: id })}
          />
        </div>

        {/* Center: Player */}
        <div className="order-first lg:order-none col-span-1 lg:col-span-1 flex flex-col items-center justify-start space-y-8 w-full">
          {/* Mock Player */}
          <div className="w-full aspect-video bg-zinc-900 rounded-3xl border border-zinc-800 flex flex-col items-center justify-center relative overflow-hidden group shadow-2xl">
            {roomState?.currentTrackId ? (
              <YouTubePlayer
                ref={ytPlayerRef}
                key={roomState.currentTrackId}
                videoId={roomState.currentTrackId}
                isPlaying={roomState.isPlaying}
                targetPlayhead={roomState.currentPlayhead}
                isHost={isHost}
                onStateChange={handlePlayerStateChange}
                updatedAt={roomState.updatedAt}
                volume={volume}
                dataSaver={dataSaver}
                muted={audioMode === 'passive'}
              />            ) : (
              <div className="z-10 text-center space-y-4 p-6">
                 <div className="text-sm font-medium text-zinc-500 uppercase tracking-widest">Idle</div>
                 <h3 className="text-xl md:text-3xl font-bold text-zinc-700 max-w-md mx-auto leading-tight">
                   Enter a YouTube URL to Start
                 </h3>
              </div>
            )}
          </div>

          {/* Track Input */}
          <form onSubmit={handleAddTrack} className="w-full flex gap-2">
            <input
              type="text"
              placeholder="Paste YouTube URL or ID"
              value={trackUrl}
              onChange={(e) => setTrackUrl(e.target.value)}
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-700 transition-all placeholder:text-zinc-600 text-white"
            />
            <button
              type="submit"
              className="bg-zinc-800 hover:bg-zinc-700 text-white p-2 rounded-xl transition-all active:scale-95"
            >
              <Plus className="w-5 h-5" />
            </button>
          </form>

          {/* Controls */}
          <div className="flex flex-col items-center gap-6 w-full">
            <div className="flex items-center gap-8">
              <button className="p-4 bg-zinc-900 hover:bg-zinc-800 rounded-2xl border border-zinc-800 text-zinc-400 transition-all hover:scale-105 active:scale-95">
                <SkipForward className="w-6 h-6 rotate-180" />
              </button>
              
              <button 
                onClick={() => {
                  const isPlaying = roomState?.isPlaying;
                  const playhead = ytPlayerRef.current?.getCurrentTime() || roomState?.currentPlayhead || 0;
                  emitMutation(isPlaying ? 'PAUSE' : 'PLAY', { playhead });
                }}
                disabled={!isHost}
                className={cn(
                  "w-20 h-20 flex items-center justify-center rounded-3xl transition-all hover:scale-105 active:scale-95 shadow-xl disabled:opacity-50 disabled:cursor-not-allowed",
                  roomState?.isPlaying ? "bg-zinc-900 border border-zinc-800 text-white" : "bg-white text-black"
                )}
              >
                {roomState?.isPlaying ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current" />}
              </button>

              <button 
                onClick={() => emitMutation('SKIP')}
                disabled={!isHost}
                className="p-4 bg-zinc-900 hover:bg-zinc-800 rounded-2xl border border-zinc-800 text-zinc-400 transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <SkipForward className="w-6 h-6" />
              </button>
            </div>

            <div className="w-full max-w-sm flex items-center gap-6 px-4 py-3 bg-zinc-900/50 rounded-2xl border border-zinc-800/50">
               <div className="flex-1 flex items-center gap-3">
                 <span className="text-[10px] font-bold text-zinc-500 uppercase">Vol</span>
                 <input 
                   type="range" 
                   min="0" 
                   max="100" 
                   value={volume} 
                   onChange={(e) => setVolume(parseInt(e.target.value))}
                   className="flex-1 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white"
                 />
                 <span className="text-[10px] font-mono text-zinc-400 w-6">{volume}</span>
               </div>
               
               <div className="w-px h-4 bg-zinc-800" />

               <button 
                 onClick={() => setDataSaver(!dataSaver)}
                 className={cn(
                   "flex items-center gap-2 px-3 py-1 rounded-lg transition-all border",
                   dataSaver 
                    ? "bg-blue-500/10 border-blue-500/50 text-blue-400" 
                    : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-300"
                 )}
               >
                 <div className={cn("w-1.5 h-1.5 rounded-full", dataSaver ? "bg-blue-400 animate-pulse" : "bg-zinc-600")} />
                 <span className="text-[10px] font-bold uppercase tracking-tight">Data Saver</span>
               </button>
            </div>
          </div>

          {/* Mobile Tabs */}
          <div className="flex lg:hidden w-full bg-zinc-900 rounded-2xl p-1 border border-zinc-800">
            <button 
              onClick={() => setMobileTab('chat')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold transition-all",
                mobileTab === 'chat' ? "bg-zinc-800 text-white" : "text-zinc-500"
              )}
            >
              <MessageSquare className="w-4 h-4" />
              Chat
            </button>
            <button 
              onClick={() => setMobileTab('queue')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold transition-all",
                mobileTab === 'queue' ? "bg-zinc-800 text-white" : "text-zinc-500"
              )}
            >
              <ListMusic className="w-4 h-4" />
              Queue
              {roomState?.queue && roomState.queue.length > 0 && (
                <span className="bg-blue-600 text-[8px] px-1.5 py-0.5 rounded-full ml-1">{roomState.queue.length}</span>
              )}
            </button>
          </div>
        </div>

        {/* Right: Chat (Desktop) / Tabbed (Mobile) */}
        <div className={cn(
          "lg:col-span-1 h-[500px]",
          mobileTab !== 'chat' && "hidden lg:block"
        )}>
          <ChatView messages={messages} onSendMessage={sendMessage} currentUserId={userId} />
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
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-zinc-500 uppercase text-[10px] font-bold tracking-widest">
              <Radio className="w-3 h-3" />
              Your Identity
            </div>
            <button 
              onClick={() => {
                const next = prompt("Enter new username:", username);
                if (next && next.trim()) {
                  handleNameChange(next.trim());
                  emitMutation('UPDATE_IDENTITY', { username: next.trim() });
                }
              }}
              className="text-[10px] text-zinc-500 hover:text-white uppercase font-bold"
            >
              Edit
            </button>
          </div>
          <div className="text-sm font-medium truncate">{username}</div>
          <div className="text-[10px] text-zinc-600 font-mono mt-1 truncate">ID: {userId} | Socket: {socketId || 'offline'}</div>
        </div>
      </footer>
    </div>
  );
}

export default App;
