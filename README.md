# MRelay

MRelay is a synchronized YouTube audio relay application. It lets multiple clients connect to a central room to listen to YouTube tracks concurrently while maintaining playback state across the network.

## Features

- Synchronized playback using WebSockets to align track time and state across clients
- Room-based architecture with host controls for queue management and playback authority
- Detached mode allowing clients to pause or build a local queue without broadcasting state changes to the room
- Rate limiting on chat and socket events to drop high-frequency spam
- In-memory state tracking using Redis to cache room metadata
- Headless playback fallback (Data Saver) that relies on CSS z-index layering to hide the iframe rather than unmounting it, which prevents the YouTube API from throttling

## Architecture

The backend maps connections to persistent user IDs rather than transient socket IDs. This prevents duplicate client states during browser reloads and allows authority to persist if a host drops and reconnects within the buffer window. 

State payloads are split. Playback scrub events sync the heavy state timeline, while roster presence and chat events use lightweight channels to avoid unnecessary client re-renders. When a room is empty, a scheduled job cleans the orphaned keys from Redis.

## Tech Stack

- React 18 / Vite
- Node.js / Express
- Socket.io
- Redis
- Docker / Docker Compose
- Nginx

## Deployment

The stack runs entirely through Docker Compose. Make sure Docker is installed on your host system.

1. Clone the repository:
   ```bash
   git clone https://github.com/WilliamAxelC/MRelay.git
   cd MRelay/infrastructure
   ```

2. Build and run the containers:
   ```bash
   docker compose up -d --build
   ```

3. Access the web interface at `http://localhost:8080`.

The default Nginx configuration maps external traffic directly to the React frontend container and proxies `/socket.io` paths to the Node backend.
