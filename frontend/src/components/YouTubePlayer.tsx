import React, { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    onYouTubeIframeAPIReady: () => void;
    YT: any;
  }
}

interface YouTubePlayerProps {
  videoId: string;
  isPlaying: boolean;
  targetPlayhead: number;
  isHost: boolean;
  onStateChange: (state: { isPlaying: boolean; playhead: number }) => void;
  updatedAt: number;
}

export const YouTubePlayer: React.FC<YouTubePlayerProps> = ({
  videoId,
  isPlaying,
  targetPlayhead,
  isHost,
  onStateChange,
  updatedAt
}) => {
  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);
  const isProcessingRemoteEvent = useRef(false);

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
        },
        events: {
          onReady: () => setIsReady(true),
          onStateChange: handlePlayerStateChange,
        },
      });
    }

    return () => {
      // Cleanup not strictly necessary for YT API usually, 
      // but good to null out refs
    };
  }, []);

  // Handle Playback State Sync
  useEffect(() => {
    if (!isReady || !playerRef.current) return;

    // Apply Play/Pause
    const currentPlayerState = playerRef.current.getPlayerState();
    if (isPlaying && currentPlayerState !== 1) { // 1 = playing
      isProcessingRemoteEvent.current = true;
      playerRef.current.playVideo();
    } else if (!isPlaying && currentPlayerState === 1) {
      isProcessingRemoteEvent.current = true;
      playerRef.current.pauseVideo();
    }

    // Drift Compensation
    const localPlayhead = playerRef.current.getCurrentTime();
    const transitDelay = (Date.now() - updatedAt) / 1000;
    const computedTarget = isPlaying ? targetPlayhead + transitDelay : targetPlayhead;
    const delta = Math.abs(localPlayhead - computedTarget);

    if (delta > 1.5) {
      console.log(`[Sync] Drift detected: ${delta.toFixed(2)}s. Seeking to ${computedTarget.toFixed(2)}s`);
      isProcessingRemoteEvent.current = true;
      playerRef.current.seekTo(computedTarget, true);
    }
  }, [isReady, isPlaying, targetPlayhead, updatedAt]);

  const handlePlayerStateChange = (event: any) => {
    if (isProcessingRemoteEvent.current) {
      isProcessingRemoteEvent.current = false;
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
    <div className="w-full h-full rounded-2xl overflow-hidden bg-black">
      <div ref={containerRef} />
    </div>
  );
};
