# MRelay Features

MRelay is a high-performance, synchronized YouTube audio relay application designed for real-time collaboration.

## Core Synchronization
- **Real-time State Sync:** High-precision synchronization of YouTube playback state (time, play/pause, volume) across all connected clients via WebSockets.
- **State Reconciliation:** Intelligent handling of network jitter to ensure all clients stay within a tight synchronization window.
- **Detached Mode:** Allows individual users to temporarily desynchronize from the room to preview tracks or manage local playback without affecting other participants.

## Room Management
- **Persistent Sessions:** User identities are mapped to unique IDs rather than transient socket connections, ensuring continuity across page reloads.
- **Dynamic Host Election:** Automated promotion of a new room host if the current host disconnects, maintaining room stability.
- **Host Controls:** Authorized users can manage the queue, skip tracks, and control global playback state.
- **Auto-Cleanup:** Scheduled background jobs automatically prune orphaned room data from the cache when rooms become inactive.

## Media & Queue
- **Smart Queueing:** Add, remove, and reorder YouTube tracks in a shared room queue.
- **Media Ingestion:** Simplified form for adding tracks via YouTube URLs with automatic metadata extraction.
- **Data Saver Mode:** Headless playback optimization that uses CSS layering to minimize resource usage while maintaining active playback.
- **Persistent Playback:** The backend maintains the global queue and playback position even if the host temporarily drops.

## Social & Interaction
- **Integrated Chat:** Low-latency room chat for real-time communication between participants.
- **Presence Tracking:** Real-time roster showing active participants and their current status.
- **Spam Protection:** Integrated rate limiting for chat messages and socket events to maintain performance and prevent abuse.

## Technical & Infrastructure
- **Redis-Backed State:** All critical room state is cached in Redis for high-speed access and fault tolerance.
- **Containerized Stack:** Fully orchestrated via Docker Compose for consistent deployment across environments.
- **Nginx Proxying:** Optimized traffic routing for both static frontend assets and WebSocket backend communication.
- **Observability:** Structured logging and health monitoring built into the backend framework.
