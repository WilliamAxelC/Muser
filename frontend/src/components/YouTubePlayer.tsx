import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { cn } from '../lib/utils';

declare global {
  interface Window {
    onYouTubeIframeAPIReady: () => void;
    YT: any;
  }
}

export interface YouTubePlayerRef {
  getCurrentTime: () => number;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number) => void;
}

interface YouTubePlayerProps {
  videoId: string;
  isPlaying: boolean;
  targetPlayhead: number;
  isHost: boolean;
  onStateChange: (state: { isPlaying: boolean; playhead: number; isEnded?: boolean }) => void;
  updatedAt: number;
  volume?: number;
  dataSaver?: boolean;
  muted?: boolean;
  isUnsynced?: boolean;
}

export const YouTubePlayer = forwardRef<YouTubePlayerRef, YouTubePlayerProps>(({
  videoId,
  isPlaying,
  targetPlayhead,
  isHost,
  onStateChange,
  updatedAt,
  volume = 50,
  dataSaver = false,
  muted = false,
  isUnsynced = false
}, ref) => {
  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => {
      if (playerRef.current && isReady) {
        return playerRef.current.getCurrentTime() || 0;
      }
      return 0;
    },
    playVideo: () => {
      if (playerRef.current && isReady) {
        playerRef.current.playVideo();
      }
    },
    pauseVideo: () => {
      if (playerRef.current && isReady) {
        playerRef.current.pauseVideo();
      }
    },
    seekTo: (seconds: number) => {
      if (playerRef.current && isReady) {
        playerRef.current.seekTo(seconds, true);
      }
    }
  }));

  // Load YouTube API
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

      window.onYouTubeIframeAPIReady = () => {
        initPlayer();
      };
    } else {
      initPlayer();
    }

    function initPlayer() {
      if (playerRef.current || !containerRef.current) return;
      
      playerRef.current = new window.YT.Player(containerRef.current, {
        height: '100%',
        width: '100%',
        videoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          mute: muted ? 1 : 0
        },
        events: {
          onReady: () => {
            setIsReady(true);
            playerRef.current.setVolume(volume);
          },
          onStateChange: handlePlayerStateChange,
        },
      });
    }

    return () => {
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
        setIsReady(false);
      }
    };
  }, [videoId]); // Re-init only on videoId change, NOT dataSaver

  // Handle Volume Changes
  useEffect(() => {
    if (isReady && playerRef.current) {
      if (muted) {
        playerRef.current.mute();
      } else {
        playerRef.current.unMute();
        playerRef.current.setVolume(volume);
      }
    }
  }, [isReady, volume, muted]);

  const propsRef = useRef({ isPlaying, isHost, onStateChange, targetPlayhead });
  
  useEffect(() => {
    propsRef.current = { isPlaying, isHost, onStateChange, targetPlayhead };
  }, [isPlaying, isHost, onStateChange, targetPlayhead]);

  // Handle Playback State Sync
  useEffect(() => {
    if (!isReady || !playerRef.current || isUnsynced) return;

    // Apply Play/Pause
    const currentPlayerState = playerRef.current.getPlayerState();
    if (isPlaying && currentPlayerState !== 1) { // 1 = playing
      playerRef.current.playVideo();
    } else if (!isPlaying && currentPlayerState === 1) {
      playerRef.current.pauseVideo();
    }

    // Drift Compensation / Seek to Target
    const localPlayhead = playerRef.current.getCurrentTime();
    const transitDelay = (Date.now() - updatedAt) / 1000;
    const computedTarget = isPlaying ? targetPlayhead + transitDelay : targetPlayhead;
    const drift = localPlayhead - computedTarget;

    if (Math.abs(drift) > 2.0 && !isNaN(computedTarget)) {
      const safeTarget = Math.max(0, computedTarget);
      console.log(`[Sync] Real state change or significant drift detected. Seeking to ${safeTarget.toFixed(2)}s`);
      playerRef.current.seekTo(safeTarget, true);
    }
  }, [isReady, isPlaying, targetPlayhead, videoId, isUnsynced]); 

  const handlePlayerStateChange = (event: any) => {
    const newState = event.data;
    const { isPlaying: currentIsPlaying, isHost: currentIsHost, onStateChange: currentOnStateChange, targetPlayhead: currentTargetPlayhead } = propsRef.current;

    // Auto-advance logic for host
    if (newState === window.YT.PlayerState.ENDED && currentIsHost) {
      currentOnStateChange({ isPlaying: false, playhead: 0, isEnded: true });
      return;
    }

    // Only host propagates state changes
    if (!currentIsHost) return;

    const playhead = playerRef.current.getCurrentTime();

    // To prevent infinite loops and race conditions, we only emit a mutation if:
    // 1. The local state transition differs from the server's known state (e.g. playing when server thinks paused)
    // 2. OR, if it's a significant playhead seek that wasn't just a drift correction.
    
    // We assume if playhead is very close to currentTargetPlayhead, it's just a sync correction, not a manual user seek.
    const isManualSeek = Math.abs(playhead - currentTargetPlayhead) > 3.0;

    if (newState === window.YT.PlayerState.PLAYING) {
      if (!currentIsPlaying || isManualSeek) {
        currentOnStateChange({ isPlaying: true, playhead });
      }
    } else if (newState === window.YT.PlayerState.PAUSED) {
      if (currentIsPlaying || isManualSeek) {
        currentOnStateChange({ isPlaying: false, playhead });
      }
    }
  };

  return (
    <div className="w-full h-full rounded-2xl overflow-hidden bg-black relative">
      <div className={cn(
        "absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 transition-opacity duration-500",
        dataSaver ? "opacity-100 z-10" : "opacity-0 pointer-events-none"
      )}>
         <img 
           src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`} 
           alt="Thumbnail" 
           className="absolute inset-0 z-10 w-full h-full object-cover opacity-30 grayscale blur-sm"
         />
         <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 space-y-4">
            <div className="px-4 py-2 bg-blue-600/20 border border-blue-500/50 rounded-full text-[10px] font-black uppercase tracking-widest text-blue-400">
              Low Bandwidth Mode
            </div>
            <h4 className="text-zinc-500 text-xs font-bold max-w-xs truncate">Audio Rendering Active</h4>
         </div>
      </div>
      <div
        className={cn(
          "w-full h-full transition-opacity duration-500",
          dataSaver ? "opacity-0 pointer-events-none z-0" : "opacity-100"
        )}
      >
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
});

