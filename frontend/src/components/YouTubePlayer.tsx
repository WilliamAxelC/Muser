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
  onStateChange: (state: { isPlaying: boolean; playhead: number }) => void;
  updatedAt: number;
  volume?: number;
  dataSaver?: boolean;
  muted?: boolean;
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
  muted = false
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
      if (playerRef.current) return;
      
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
      }
    };
  }, []);

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
    if (!isReady || !playerRef.current) return;

    // Apply Play/Pause
    const currentPlayerState = playerRef.current.getPlayerState();
    if (isPlaying && currentPlayerState !== 1) { // 1 = playing
      isAutomatedChange.current = true;
      playerRef.current.playVideo();
    } else if (!isPlaying && currentPlayerState === 1) {
      isAutomatedChange.current = true;
      playerRef.current.pauseVideo();
    }

    // Drift Compensation
    const localPlayhead = playerRef.current.getCurrentTime();
    const transitDelay = (Date.now() - updatedAt) / 1000;
    const computedTarget = isPlaying ? targetPlayhead + transitDelay : targetPlayhead;
    const drift = localPlayhead - computedTarget;

    // Sync Deadzone: Early return to suppress minor fractional offsets
    if (Math.abs(drift) < 2.0) {
      return;
    }

    if (!isNaN(computedTarget)) {
      const safeTarget = Math.max(0, computedTarget);
      console.log(`[Sync] Drift detected: ${drift.toFixed(2)}s. Seeking to ${safeTarget.toFixed(2)}s`);
      isAutomatedChange.current = true;
      playerRef.current.seekTo(safeTarget, true);
    }
  }, [isReady, isPlaying, targetPlayhead, updatedAt]);

  const handlePlayerStateChange = (event: any) => {
    if (isAutomatedChange.current) {
      isAutomatedChange.current = false;
      return;
    }

    // Only host propagates state changes
    if (!isHost) return;

    const newState = event.data;
    const playhead = playerRef.current.getCurrentTime();

    if (newState === window.YT.PlayerState.PLAYING) {
      onStateChange({ isPlaying: true, playhead });
    } else if (newState === window.YT.PlayerState.PAUSED) {
      onStateChange({ isPlaying: false, playhead });
    }
  };

  return (
    <div className={`w-full h-full rounded-2xl overflow-hidden bg-black transition-opacity duration-300 ${dataSaver ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
      <div ref={containerRef} />
    </div>
  );
});
