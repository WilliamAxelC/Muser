import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';

declare global {
  interface Window {
    onYouTubeIframeAPIReady: () => void;
    YT: any;
  }
}

export interface YouTubePlayerRef {
  getCurrentTime: () => number;
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
  const isAutomatedChange = useRef(false);

  useImperativeHandle(ref, () => ({
    getCurrentTime: () => {
      if (playerRef.current && isReady) {
        return playerRef.current.getCurrentTime() || 0;
      }
      return 0;
    }
  }));

  // Load YouTube API - Only if NOT in data saver mode
  useEffect(() => {
    if (dataSaver) return;

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
  }, [dataSaver, videoId]);

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

  // Handle Playback State Sync
  useEffect(() => {
    if (!isReady || !playerRef.current || isUnsynced) return;

    // Apply Play/Pause
    const currentPlayerState = playerRef.current.getPlayerState();
    if (isPlaying && currentPlayerState !== 1) { // 1 = playing
      isAutomatedChange.current = true;
      playerRef.current.playVideo();
    } else if (!isPlaying && currentPlayerState === 1) {
      isAutomatedChange.current = true;
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
      isAutomatedChange.current = true;
      playerRef.current.seekTo(safeTarget, true);
    }
  }, [isReady, isPlaying, targetPlayhead, videoId, isUnsynced]); 

  const handlePlayerStateChange = (event: any) => {
    if (isAutomatedChange.current) {
      isAutomatedChange.current = false;
      return;
    }

    const newState = event.data;

    // Auto-advance logic for host
    if (newState === window.YT.PlayerState.ENDED && isHost) {
      onStateChange({ isPlaying: false, playhead: 0, isEnded: true });
      return;
    }

    // Only host propagates state changes
    if (!isHost) return;

    const playhead = playerRef.current.getCurrentTime();

    if (newState === window.YT.PlayerState.PLAYING) {
      onStateChange({ isPlaying: true, playhead });
    } else if (newState === window.YT.PlayerState.PAUSED) {
      onStateChange({ isPlaying: false, playhead });
    }
  };

  return (
    <div className="w-full h-full rounded-2xl overflow-hidden bg-black relative">
      {dataSaver ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950">
           <img 
             src={`https://img.youtube.com/vi/${videoId}/hqdefault.jpg`} 
             alt="Thumbnail" 
             className="w-full h-full object-cover opacity-30 grayscale blur-sm"
           />
           <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 space-y-4">
              <div className="px-4 py-2 bg-blue-600/20 border border-blue-500/50 rounded-full text-[10px] font-black uppercase tracking-widest text-blue-400">
                Low Bandwidth Mode
              </div>
              <h4 className="text-zinc-500 text-xs font-bold max-w-xs truncate">Audio Rendering Active</h4>
           </div>
        </div>
      ) : (
        <div ref={containerRef} className="w-full h-full" />
      )}
    </div>
  );
});
