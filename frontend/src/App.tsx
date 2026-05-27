import React, { useState, useRef, useEffect } from 'react';
import { useSocket } from './hooks/useSocket';
import { cn } from './lib/utils';
import { Play, Pause, SkipForward, Radio, LogOut, Settings, Share2, Check, MessageSquare, ListMusic, VolumeX, Headphones, Menu, X, ChevronRight, Crown, Users, RotateCcw, Link2, Globe, ShieldCheck } from 'lucide-react';
import { YouTubePlayer } from './components/YouTubePlayer';
import type { YouTubePlayerRef } from './components/YouTubePlayer';
import { ChatView } from './components/ChatView';
import { QueueView } from './components/QueueView';
import { MediaIngestionForm } from './components/MediaIngestionForm';

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
  const [volume, setVolume] = useState(50);
  const [dataSaver, setDataSaver] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [roomPassword, setRoomPassword] = useState('');
  const [roomTitleInput, setRoomTitleInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [mobileTab, setMobileTab] = useState<'queue' | 'chat'>('chat');
  const [audioMode, setAudioMode] = useState<'sync' | 'passive'>('sync');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showUserList, setShowUserList] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [isCreatingPublic, setIsCreatingPublic] = useState(true);
  const [isUnsynced, setIsUnsynced] = useState(false);
  const prevUnsyncedRef = useRef(false);

  React.useEffect(() => {
    if (errorToast) {
      const timer = setTimeout(() => setErrorToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [errorToast]);

  // Phase 3.2: Active Tab Eviction Guard
  React.useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (activeRoomId) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [activeRoomId]);

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

  const { isConnected, roomState, hostId, isHost, emitMutation, messages, sendMessage } = useSocket(activeRoomId, userId, username, roomPassword, roomTitleInput);
  const ytPlayerRef = useRef<YouTubePlayerRef>(null);

  const [detachedQueue, setDetachedQueue] = useState<{ videoId: string; title: string }[]>([]);
  const [detachedCurrentTrackId, setDetachedCurrentTrackId] = useState<string | null>(null);
  const [detachedIsPlaying, setDetachedIsPlaying] = useState(false);
  const [showWarningBanner, setShowWarningBanner] = useState(false);

  // Phase 1: Local Session State Buckets & Catch-up re-synchronization
  useEffect(() => {
    if (isUnsynced && !prevUnsyncedRef.current) {
      // User just toggled to DETACHED - fork state
      setDetachedQueue([...(roomState?.queue || [])]);
      setDetachedCurrentTrackId(roomState?.currentTrackId || null);
      setDetachedIsPlaying(roomState?.isPlaying || false);
      setShowWarningBanner(true);
    } else if (prevUnsyncedRef.current === true && isUnsynced === false) {
      // User just toggled back to SYNCED - snap to master timeline
      if (roomState && ytPlayerRef.current) {
        const networkDriftOffset = (Date.now() - (roomState.updatedAt || Date.now())) / 1000;
        const masterPlayhead = (roomState.currentPlayhead || 0) + (roomState.isPlaying ? networkDriftOffset : 0);
        const safeTarget = Math.max(0, masterPlayhead);
        try {
          (ytPlayerRef.current as any).getCurrentTime; // access check
          // Force player re-sync by updating playhead state indirectly
          emitMutation('ROOM_RESYNC', { playhead: safeTarget });
        } catch (err) {
          console.error('[Re-Sync] Failed to snap playhead on re-sync', err);
        }
      }
    }
    if (prevUnsyncedRef.current !== isUnsynced) {
      emitMutation('SET_PEER_STATUS', { isDetached: isUnsynced });
    }
    prevUnsyncedRef.current = isUnsynced;
  }, [isUnsynced, roomState, emitMutation]);

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

  const handleIngest = async (input: string) => {
    try {
      // Robust domain-agnostic Playlist extraction
      const listRegex = /[?&]list=([a-zA-Z0-9_-]+)/;
      const listMatch = input.match(listRegex);

      if (listMatch) {
        const playlistId = listMatch[1];
        if (isUnsynced) {
          try {
            const res = await fetch(`http://localhost:8080/api/playlist?id=${playlistId}`);
            if (res.ok) {
              const data = await res.json();
              setDetachedQueue((prev) => [...prev, ...data.items.map((i: any) => ({ videoId: i.id, title: i.title }))]);
            } else {
              throw new Error('Failed to unroll playlist locally');
            }
          } catch (e: any) {
            setErrorToast(e.message || 'Error fetching playlist');
          }
        } else {
          emitMutation('QUEUE_PLAYLIST_REQUEST', { playlistId });
        }
        return;
      }

      // Single Video ID extractor
      const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/|music\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/;
      const match = input.match(regex);
      const videoId = match ? match[1] : (input.length === 11 ? input : null);
      
      if (videoId) {
        if (isUnsynced) {
          setDetachedQueue((prev) => [...prev, { videoId, title: 'Local Track' }]);
        } else {
          emitMutation('QUEUE_ADD', { item: videoId });
        }
      } else {
        throw new Error('Invalid Media Link or ID');
      }
    } catch (err: any) {
      console.error('[Ingestion Engine Error]', err);
      setErrorToast(err.message || 'Media ingestion failed');
    }
  };

  const handlePlayerStateChange = (state: { isPlaying: boolean; playhead: number; isEnded?: boolean }) => {
    if (isUnsynced) return;
    if (state.isEnded) {
      emitMutation('SKIP');
    } else {
      emitMutation(state.isPlaying ? 'PLAY' : 'PAUSE', { playhead: state.playhead });
    }
  };

  React.useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: roomState?.title || 'MRelay Sync',
        artist: activeRoomId || 'Stream',
        album: 'Collaborative Music',
      });
      navigator.mediaSession.setActionHandler('play', () => emitMutation('PLAY'));
      navigator.mediaSession.setActionHandler('pause', () => emitMutation('PAUSE'));
      navigator.mediaSession.setActionHandler('nexttrack', () => { if (isHost) emitMutation('SKIP'); });
      navigator.mediaSession.playbackState = roomState?.isPlaying ? 'playing' : 'paused';
    }
  }, [roomState?.title, roomState?.isPlaying, activeRoomId, emitMutation, isHost]);

  const [publicRooms, setPublicRooms] = useState<{roomId: string, updatedAt: number}[]>([]);

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
  };

  React.useEffect(() => {
    if (activeRoomId && isConnected && isHost) {
        emitMutation('SET_PUBLIC', { isPublic: isCreatingPublic });
    }
  }, [activeRoomId, isConnected, isHost]);

  if (!activeRoomId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8 bg-black overflow-y-auto">
        <div className="max-w-6xl w-full mx-auto px-4 py-12 space-y-12">
          <div className="text-center space-y-4">
             <div className="inline-flex items-center justify-center w-20 h-20 rounded-[2rem] bg-zinc-900 border border-zinc-800 shadow-2xl">
                <Radio className="w-10 h-10 text-blue-500 animate-pulse" />
             </div>
             <h1 className="text-4xl font-black tracking-tighter text-white uppercase italic">M-Relay</h1>
             <p className="text-zinc-500 font-medium tracking-tight">Collaborative Sync-Stream Protocol</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Column Box A (lg:col-span-4): Global Identity Profile card */}
            <div className="lg:col-span-4 space-y-6">
              <div className="bg-zinc-900/30 border border-zinc-800/80 p-8 rounded-3xl shadow-2xl backdrop-blur-md space-y-6 h-full">
                <div className="flex items-center gap-3">
                  <Users className="w-4 h-4 text-blue-500" />
                  <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Profile</h3>
                </div>
                <div className="space-y-2">
                  <label htmlFor="username" className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest ml-1">Display Name</label>
                  <input id="username" type="text" value={username} onChange={(e) => handleNameChange(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800/50 rounded-2xl px-6 py-4 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-900/50 transition-all placeholder:text-zinc-800 text-white" />
                </div>
                <p className="text-[10px] text-zinc-600 font-medium leading-relaxed">Your identity is persisted locally and broadcast to all connected peer nodes in real-time.</p>
              </div>
            </div>

            {/* Column Box B (lg:col-span-8): Create New Room and Join cards */}
            <div className="lg:col-span-8 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Card B: Provisioning Matrix (Create) */}
                <div className="bg-zinc-900/30 border border-zinc-800/80 p-8 rounded-3xl shadow-2xl backdrop-blur-md space-y-8 flex flex-col">
                  <div className="flex items-center gap-3">
                    <Globe className="w-4 h-4 text-emerald-500" />
                    <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Create New Room</h3>
                  </div>
                  
                  <div className="space-y-6 flex-1">
                    <div className="space-y-2">
                      <label htmlFor="room-title" className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest ml-1">Room Title</label>
                      <input id="room-title" type="text" placeholder="THE SYNC MATRIX" value={roomTitleInput} onChange={(e) => setRoomTitleInput(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800/50 rounded-2xl px-6 py-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900/50 transition-all placeholder:text-zinc-800 text-white" />
                    </div>

                    <div className="flex items-center justify-between bg-zinc-950/50 p-4 rounded-2xl border border-zinc-800/50">
                      <div>
                        <div className="text-sm font-bold text-white">Public Discovery</div>
                        <div className="text-[9px] text-zinc-600 uppercase tracking-tighter">Visible to global peer-list</div>
                      </div>
                      <button onClick={() => setIsCreatingPublic(!isCreatingPublic)} className={cn("w-12 h-6 rounded-full transition-all relative", isCreatingPublic ? "bg-blue-600" : "bg-zinc-800")}>
                        <div className={cn("w-4 h-4 bg-white rounded-full absolute top-1 transition-all", isCreatingPublic ? "right-1" : "left-1")} />
                      </button>
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="create-password" className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest ml-1">Room Password (Optional)</label>
                      <input id="create-password" type="password" placeholder="••••••••" value={roomPassword} onChange={(e) => setRoomPassword(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800/50 rounded-2xl px-6 py-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900/50 transition-all placeholder:text-zinc-800 text-white" />
                    </div>
                  </div>

                  <button onClick={handleCreateRoom} className="w-full bg-white text-black font-black py-5 rounded-[1.5rem] hover:bg-zinc-200 active:scale-[0.98] transition-all shadow-xl uppercase tracking-widest text-xs mt-6">Create Room</button>
                </div>

                {/* Card C: Port Ingress (Join) */}
                <div className="bg-zinc-900/30 border border-zinc-800/80 p-8 rounded-3xl shadow-2xl backdrop-blur-md space-y-8 flex flex-col">
                  <div className="flex items-center gap-3">
                    <Link2 className="w-4 h-4 text-blue-500" />
                    <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.2em]">Join Existing Room</h3>
                  </div>

                  <form onSubmit={handleJoin} className="space-y-6 flex-1 flex flex-col">
                    <div className="space-y-2">
                       <label htmlFor="room-id" className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest ml-1">Room Code</label>
                       <input id="room-id" type="text" placeholder="CODE" value={inputRoomId} onChange={(e) => setInputRoomId(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800/50 rounded-2xl px-6 py-4 font-mono tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-blue-900/50 transition-all placeholder:text-zinc-800 uppercase text-white" />
                    </div>
                    
                    <div className="space-y-2 flex-1">
                       <label className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest ml-1">Room Password</label>
                       <input type="password" placeholder="••••••••" value={roomPassword} onChange={(e) => setRoomPassword(e.target.value)} className="w-full bg-zinc-950 border border-zinc-800/50 rounded-2xl px-6 py-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-900/50 transition-all placeholder:text-zinc-800 text-white" />
                    </div>
                    
                    <button type="submit" className="w-full bg-blue-600 text-white font-black py-5 rounded-[1.5rem] hover:bg-blue-500 active:scale-[0.98] transition-all shadow-xl uppercase tracking-widest text-xs mt-6">Join Room</button>
                  </form>
                </div>
              </div>
            </div>
          </div>
          
          <div className="space-y-6 pt-8 border-t border-zinc-900">
            <h3 className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] text-center">Public Rooms</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
               {publicRooms.length === 0 ? ( 
                 <div className="md:col-span-2 lg:col-span-3 text-zinc-800 text-[10px] font-black uppercase text-center py-12 tracking-widest bg-zinc-900/10 rounded-3xl border border-dashed border-zinc-900">No active public nodes</div> 
               ) : ( 
                 publicRooms.map((room) => ( 
                   <div key={room.roomId} className="flex items-center justify-between p-5 bg-zinc-950/40 rounded-2xl border border-zinc-900 hover:border-zinc-800 transition-all group"> 
                     <div className="flex flex-col">
                        <span className="font-mono text-zinc-300 font-black tracking-widest uppercase">{room.roomId}</span>
                        <span className="text-[9px] text-zinc-700 font-bold uppercase tracking-tight">Active Peer Node</span>
                     </div>
                     <button onClick={() => setActiveRoomId(room.roomId)} className="text-[10px] font-black bg-zinc-900 hover:bg-white hover:text-black text-zinc-500 px-6 py-2.5 rounded-xl border border-zinc-800 transition-all uppercase tracking-widest">Connect</button> 
                   </div> 
                 )) 
               )}
            </div>
          </div>
        </div>
      </div>
    );
  }
  const activeTrackId = isUnsynced ? detachedCurrentTrackId : roomState?.currentTrackId;
  const activePlaybackState = isUnsynced ? detachedIsPlaying : roomState?.isPlaying;
  const activeQueue = isUnsynced ? detachedQueue : (roomState?.queue || []);

  return (
    <div className="h-screen flex flex-col bg-black text-white overflow-hidden relative">
      {errorToast && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[60] animate-in fade-in slide-in-from-top-4 duration-300">
           <div className="bg-red-600 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-red-500/50">
             <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center font-bold text-xs">!</div>
             <span className="text-sm font-bold tracking-tight">{errorToast}</span>
             <button onClick={() => setErrorToast(null)} className="ml-2 hover:opacity-50"><X className="w-4 h-4" /></button>
           </div>
        </div>
      )}

      <header className="h-16 shrink-0 border-b border-zinc-900 bg-zinc-950/50 backdrop-blur-xl px-4 md:px-8 flex items-center justify-between z-40">
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-white tracking-tighter truncate">{roomState?.title || activeRoomId}</h2>
              <button onClick={handleCopyLink} className="p-1 hover:bg-zinc-800 rounded-md transition-all text-zinc-500 hover:text-white shrink-0">
                {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Share2 className="w-3.5 h-3.5" />}
              </button>
            </div>
            {roomState?.title && roomState.title !== activeRoomId && (
              <span className="text-[10px] text-zinc-500/60 font-mono uppercase tracking-wider leading-none">{activeRoomId}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 md:gap-3">
          <button onClick={() => setShowUserList(!showUserList)} className={cn("p-2 rounded-xl transition-all", showUserList ? "bg-white text-black shadow-lg shadow-white/10" : "text-zinc-400 hover:bg-zinc-900 hover:text-white")} title="User Roster">
            <Users className="w-5 h-5" />
          </button>
          {isHost && ( <button onClick={() => setShowSettings(!showSettings)} className={cn("p-2 rounded-xl transition-all", showSettings ? "bg-white text-black" : "text-zinc-400 hover:bg-zinc-900 hover:text-white")} title="Settings"> <Settings className="w-5 h-5" /> </button> )}
          <div className="w-px h-6 bg-zinc-800 mx-1" />
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className={cn("p-2 rounded-xl transition-all lg:hidden", isSidebarOpen ? "bg-blue-600 text-white" : "text-zinc-400 hover:bg-zinc-900 hover:text-white")} title="Toggle Sidebar">
            {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <button onClick={handleLeave} className="p-2 hover:bg-zinc-900 rounded-xl transition-all text-zinc-400 hover:text-white" title="Leave Room">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0 relative">
        <main className="flex-1 flex flex-col min-w-0 bg-black relative">
          {isUnsynced && showWarningBanner && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-4xl bg-amber-950/40 border border-amber-500/30 text-amber-400 p-4 rounded-2xl flex justify-between items-center text-xs font-medium backdrop-blur-md transition-all animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center gap-3">
                <span>⚠️ Independent Session Mode: You are currently detached from the Room Master. Playback controls, media additions, and queue progressions are isolated locally.</span>
              </div>
              <button onClick={() => setShowWarningBanner(false)} className="ml-4 hover:bg-amber-900/50 p-1 rounded-lg transition-all shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          <div className="flex-1 flex flex-col items-center justify-center p-4 md:p-8 space-y-8 overflow-y-auto">
            <div className="w-full max-w-4xl aspect-video bg-zinc-900 rounded-[2rem] border border-zinc-800 shadow-2xl relative overflow-hidden group">
              {activeTrackId ? (
                <YouTubePlayer ref={ytPlayerRef} key={activeTrackId} videoId={activeTrackId} isPlaying={activePlaybackState ?? false} targetPlayhead={roomState?.currentPlayhead || 0} isHost={isHost} onStateChange={handlePlayerStateChange} updatedAt={roomState?.updatedAt || Date.now()} volume={volume} dataSaver={dataSaver} muted={audioMode === 'passive'} isUnsynced={isUnsynced} />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center space-y-6">
                  <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center animate-pulse"> <Radio className="w-8 h-8 text-zinc-600" /> </div>
                  <h3 className="text-2xl md:text-3xl font-black text-zinc-700 tracking-tighter"> READY FOR <span className="text-zinc-600 uppercase italic tracking-widest ml-2">Ingestion</span> </h3>
                </div>
              )}
            </div>

            <div className="w-full max-w-2xl">
              <MediaIngestionForm onIngest={handleIngest} />
            </div>

            <div className="flex flex-col items-center gap-8 w-full max-w-3xl">
              <div className="w-full flex items-center justify-between gap-4 px-4 md:px-6 py-4 bg-zinc-900/50 rounded-3xl border border-zinc-800/50 backdrop-blur-md">
                 {/* Container Block 1 (Left - Volume Grouping) */}
                 <div className="flex items-center gap-2 w-44 flex-shrink-0">
                   <div className="p-2 rounded-lg bg-zinc-800/50 flex-shrink-0"> <VolumeX className="w-4 h-4 text-zinc-400" /> </div>
                   <input type="range" min="0" max="100" value={volume} onChange={(e) => setVolume(parseInt(e.target.value))} className="flex-1 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-white" />
                   <div className="w-12 text-right font-mono text-xs"><span className="font-bold text-zinc-400">{volume}</span></div>
                 </div>

                 {/* Container Block 2 (Center - Navigation Cushion) */}
                 <div className="flex-1 flex items-center justify-center gap-4 md:gap-8">
                   <button onClick={() => {
                     if (isUnsynced) {
                       ytPlayerRef.current?.seekTo(0);
                     } else {
                       emitMutation('BACK');
                     }
                   }} disabled={(!isHost && !isUnsynced) || (!isUnsynced && (roomState?.history?.length || 0) === 0)} className="p-3 bg-zinc-900 hover:bg-zinc-800 rounded-2xl border border-zinc-800 text-zinc-600 transition-all hover:scale-105 active:scale-90 disabled:opacity-20 disabled:pointer-events-none" title="Previous Track">
                     <RotateCcw className="w-5 h-5" />
                   </button>                  
                   <button onClick={() => { 
                     const isPlaying = activePlaybackState; 
                     if (isUnsynced) {
                       if (isPlaying) ytPlayerRef.current?.pauseVideo();
                       else ytPlayerRef.current?.playVideo();
                       setDetachedIsPlaying(!isPlaying);
                     } else {
                       const playhead = ytPlayerRef.current?.getCurrentTime() || roomState?.currentPlayhead || 0; 
                       emitMutation(isPlaying ? 'PAUSE' : 'PLAY', { playhead }); 
                     }
                   }} disabled={(!isHost && !isUnsynced) || (!activeTrackId && activeQueue.length === 0)} className={cn( "w-16 h-16 flex items-center justify-center rounded-[2rem] transition-all hover:scale-105 active:scale-95 shadow-2xl disabled:opacity-20 disabled:grayscale disabled:cursor-not-allowed", activePlaybackState ? "bg-zinc-900 border border-zinc-800 text-white" : "bg-white text-black" )} >
                     {activePlaybackState ? <Pause className="w-7 h-7 fill-current" /> : <Play className="w-7 h-7 fill-current ml-1" />}
                   </button>
                   <button onClick={() => {
                     if (isUnsynced) {
                       if (detachedQueue.length > 0) {
                         const nextItem = detachedQueue[0];
                         setDetachedQueue(detachedQueue.slice(1));
                         setDetachedCurrentTrackId(nextItem.videoId);
                         setDetachedIsPlaying(true);
                       } else {
                         setDetachedCurrentTrackId(null);
                         setDetachedIsPlaying(false);
                       }
                     } else {
                       emitMutation('SKIP');
                     }
                   }} disabled={(!isHost && !isUnsynced) || activeQueue.length === 0} className="p-3 bg-zinc-900 hover:bg-zinc-800 rounded-2xl border border-zinc-800 text-zinc-600 transition-all hover:scale-105 active:scale-90 disabled:opacity-20 disabled:grayscale disabled:cursor-not-allowed" title="Skip Track">
                     <SkipForward className="w-5 h-5 fill-current" />
                   </button>
                 </div>

                 {/* Container Block 3 (Right - Mode Toggles Grouping) */}
                 <div className="flex items-center gap-4 ml-auto flex-shrink-0">
                    {!isHost && (
                      <button onClick={() => setIsUnsynced(!isUnsynced)} className={cn("flex items-center gap-2 px-3 py-2 rounded-xl border transition-all flex-shrink-0", isUnsynced ? "bg-orange-500/10 border-orange-500/50 text-orange-400" : "bg-zinc-800/50 border-zinc-700/50 text-zinc-500")} title="Bypass Master Sync">
                         <ShieldCheck className={cn("w-3.5 h-3.5", isUnsynced ? "text-orange-400" : "text-zinc-600")} />
                         <span className="text-[9px] font-black uppercase tracking-widest">{isUnsynced ? 'Detached' : 'Synced'}</span>
                      </button>
                    )}

                    <button onClick={() => setDataSaver(!dataSaver)} className={cn( "flex items-center gap-2 px-3 py-2 rounded-xl transition-all border flex-shrink-0 min-w-max whitespace-nowrap", dataSaver ? "bg-blue-500/10 border-blue-500/50 text-blue-400" : "bg-zinc-800/50 border-zinc-700/50 text-zinc-500 hover:text-zinc-300" )} >
                      <div className={cn("w-1.5 h-1.5 rounded-full", dataSaver ? "bg-blue-400 animate-pulse shadow-[0_0_8px_rgba(96,165,250,0.5)]" : "bg-zinc-600")} />
                      <span className="text-[9px] font-black uppercase tracking-wider"> {dataSaver ? 'Active' : 'Data Saver'} </span>
                    </button>
                 </div>
              </div>
            </div>
          </div>
        </main>

        <aside className={cn( "fixed inset-y-0 right-0 z-50 w-80 bg-zinc-950 border-l border-zinc-900 transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0 flex flex-col shadow-2xl lg:shadow-none", isSidebarOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0", "lg:w-96" )}>
          {isSidebarOpen && (
            <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden absolute -left-12 top-4 p-3 bg-zinc-950 border border-zinc-900 rounded-l-xl text-zinc-400 animate-in fade-in slide-in-from-right-4 duration-300">
              <ChevronRight className="w-6 h-6" />
            </button>
          )}
          <div className="flex border-b border-zinc-900 shrink-0">
            <button onClick={() => setMobileTab('chat')} className={cn( "flex-1 py-4 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] transition-all", mobileTab === 'chat' ? "text-white border-b-2 border-white" : "text-zinc-600 hover:text-zinc-400" )}> <MessageSquare className="w-3 h-3" /> Stream Chat </button>
            <button onClick={() => setMobileTab('queue')} className={cn( "flex-1 py-4 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] transition-all", mobileTab === 'queue' ? "text-white border-b-2 border-white" : "text-zinc-600 hover:text-zinc-400" )}> <ListMusic className="w-3 h-3" /> Media Queue {roomState?.queue && roomState.queue.length > 0 && ( <span className="bg-blue-600 text-[8px] px-1.5 py-0.5 rounded-full ml-1">{roomState.queue.length}</span> )} </button>
          </div>
          <div className="flex-1 min-h-0">
            {mobileTab === 'chat' ? ( <ChatView messages={messages} onSendMessage={sendMessage} currentUserId={userId} /> ) : ( <QueueView queue={roomState?.queue || []} detachedQueue={detachedQueue} isUnsynced={isUnsynced} history={roomState?.history || []} isHost={isHost} onReorder={(oldIndex, newIndex) => emitMutation('QUEUE_REORDER', { index: oldIndex, newIndex })} onLocalReorder={(oldIndex, newIndex) => { const newQ = [...detachedQueue]; const [item] = newQ.splice(oldIndex, 1); newQ.splice(newIndex, 0, item); setDetachedQueue(newQ); }} onRemove={(index) => emitMutation('QUEUE_REMOVE', { index })} onLocalRemove={(index) => { const newQ = [...detachedQueue]; newQ.splice(index, 1); setDetachedQueue(newQ); }} onJump={(index) => emitMutation('QUEUE_JUMP', { index })} onLocalJump={(index) => { if (index < detachedQueue.length) { const item = detachedQueue[index]; setDetachedQueue(detachedQueue.slice(index + 1)); setDetachedCurrentTrackId(item.videoId); setDetachedIsPlaying(true); } }} isRequestOnly={roomState?.isRequestOnly} onToggleRequestOnly={(val) => emitMutation('SET_REQUEST_ONLY', { isRequestOnly: val })} pendingRequests={roomState?.pendingRequests} onApprove={(id) => emitMutation('APPROVE_REQUEST', { requestId: id })} onDeny={(id) => emitMutation('DENY_REQUEST', { requestId: id })} /> )}
          </div>
        </aside>

        {showUserList && (
          <div className="absolute top-16 right-4 w-64 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-200 overflow-hidden">
             <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
               <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Active Peers</span>
               <button onClick={() => setShowUserList(false)}><X className="w-4 h-4 text-zinc-600" /></button>
             </div>
             <div className="max-h-64 overflow-y-auto p-2 space-y-1">
                {(roomState?.peers || []).map((peer: any) => (
                  <div key={peer.socketId} className="flex items-center justify-between p-2 rounded-xl bg-zinc-800/30">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-bold text-white shrink-0"> {peer.username[0]?.toUpperCase() || '?'} </div>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold truncate"> {peer.username} {peer.userId === userId.substring(0,8) && " (You)"} </span>
                          {peer.isDetached && (
                            <span className="text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider">Detached</span>
                          )}
                        </div>
                        <span className="text-[9px] text-zinc-600 font-mono">ID: {peer.userId}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {peer.socketId === hostId ? ( <Crown className="w-3.5 h-3.5 text-yellow-500 fill-current" /> ) : ( isHost && ( <button onClick={() => { if (confirm(`Transfer Master authority to ${peer.username}?`)) { emitMutation('TRANSFER_AUTHORITY', { targetUserId: peer.socketId }); } }} className="p-1.5 hover:bg-white hover:text-black rounded-md transition-all text-zinc-600" title="Make Master" > <Crown className="w-3 h-3" /> </button> ) )}
                    </div>
                  </div>
                ))}
             </div>
          </div>
        )}

        {showSettings && isHost && (
          <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
             <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-[2rem] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-300">
               <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                 <h3 className="text-sm font-black text-zinc-300 uppercase tracking-widest">Administrative Matrix</h3>
                 <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-zinc-800 rounded-xl transition-all"><X className="w-5 h-5" /></button>
               </div>
               <div className="p-8 space-y-8">
                  <div className="space-y-4">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Room Title</label>
                    <div className="flex gap-2">
                       <input type="text" value={roomState?.title || ''} onChange={(e) => emitMutation('SET_TITLE', { title: e.target.value })} className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all text-white" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div> <div className="text-sm font-bold text-white">Public Discovery</div> <div className="text-xs text-zinc-500">Visible in the global discovery set</div> </div>
                    <button onClick={() => emitMutation('SET_PUBLIC', { isPublic: !roomState?.isPublic })} className={cn("w-12 h-6 rounded-full transition-all relative", roomState?.isPublic ? "bg-blue-600" : "bg-zinc-800")}> <div className={cn("w-4 h-4 bg-white rounded-full absolute top-1 transition-all", roomState?.isPublic ? "right-1" : "left-1")} /> </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div> <div className="text-sm font-bold text-white">Governance Mode</div> <div className="text-xs text-zinc-500">Require host approval for guest adds</div> </div>
                    <button onClick={() => emitMutation('SET_REQUEST_ONLY', { isRequestOnly: !roomState?.isRequestOnly })} className={cn("w-12 h-6 rounded-full transition-all relative", roomState?.isRequestOnly ? "bg-blue-600" : "bg-zinc-800")}> <div className={cn("w-4 h-4 bg-white rounded-full absolute top-1 transition-all", roomState?.isRequestOnly ? "right-1" : "left-1")} /> </button>
                  </div>
                  <div className="p-4 bg-zinc-950 rounded-2xl border border-zinc-800/50">
                    <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">Audio Topology</div>
                    <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setAudioMode('sync')} className={cn( "flex flex-col items-center gap-2 p-3 rounded-xl border transition-all", audioMode === 'sync' ? "bg-blue-500/10 border-blue-500 text-blue-400" : "bg-zinc-900 border-zinc-800 text-zinc-500" )}> <Headphones className="w-4 h-4" /> <span className="text-[10px] font-bold uppercase">Master Sync</span> </button>
                        <button onClick={() => setAudioMode('passive')} className={cn( "flex flex-col items-center gap-2 p-3 rounded-xl border transition-all", audioMode === 'passive' ? "bg-zinc-800 border-zinc-700 text-zinc-300" : "bg-zinc-900 border-zinc-800 text-zinc-500" )}> <VolumeX className="w-4 h-4" /> <span className="text-[10px] font-bold uppercase">Passive</span> </button>
                    </div>
                  </div>
                  <button onClick={handleCopyLink} className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 text-white rounded-2xl font-bold flex items-center justify-center gap-2 transition-all" > {copied ? <Check className="w-4 h-4 text-green-500" /> : <Share2 className="w-4 h-4" />} {copied ? "Link Harvested" : "Copy Invite Hyperlink"} </button>
               </div>
             </div>
          </div>
        )}
      </div>

      <footer className="h-8 shrink-0 bg-zinc-950 border-t border-zinc-900 px-6 flex items-center justify-between">
         <div className="flex items-center gap-6 text-[9px] font-black uppercase tracking-widest text-zinc-600">
           <div className="flex items-center gap-1.5">
             <div className={cn("w-1.5 h-1.5 rounded-full", isConnected ? "bg-green-500" : "bg-red-500")} />
             {isConnected ? "NETWORK: OPERATIONAL" : "NETWORK: DISCONNECTED"}
           </div>
           <div className="flex items-center gap-3">
              <span>NODE: {isHost ? "MASTER" : "LISTENER"}</span>
              <span className="opacity-50">|</span>
              <span className="text-zinc-500">IDENTITY: {username}</span>
           </div>
         </div>
         <div className="text-[9px] font-mono text-zinc-800 tracking-tighter uppercase opacity-50">MRelay Core v1.3.1</div>
      </footer>
    </div>
  );
}

export default App;
