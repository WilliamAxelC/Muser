# System Architecture & Technical Specification## Project: MRelay Collaborative Sync-Stream Music Player## 1. System Overview

MRelay is a real-time synchronized music playback platform that allows multiple concurrent clients to stream the same audio track in unison. The system runs as a Progressive Web Application (PWA) that drives an invisible YouTube IFrame playback instance on each client browser. Playback state, track selection, and queue arrays are synchronized across all session participants via a centralized WebSocket hub.### Core Architecture Axioms* **Client-Side Media Streaming:** To prevent the severe IP rate-limiting, compute overhead, and legal issues associated with server-side extraction proxies (such as `youtube-dl` forks), all media rendering, buffering, and audio delivery are executed directly inside the client browser via the official YouTube IFrame Player API.* **Stateless Application Layer:** The synchronization backend containers maintain no local memory state variables regarding active rooms. All room configurations, playback states, chronological join orders, and media queues reside entirely within an ephemeral, high-throughput in-memory data store to support seamless container restarts and horizontal scaling.



---## 2. Container Topology & Networking Isolation

The application stack is orchestrated via a three-tier container topology enclosed within an isolated private Docker bridge network (`mrelay-net`).

                +-----------------------------+

                |  Cloudflare Ingress Proxy   |

                +--------------+--------------+

                               |

                               | Public HTTPS (Port 8080)

                               v

+-------------------------------------------------------------------------+

| Docker Isolation Bridge (mrelay-net)                                    |

|                                                                         |

|   +------------------+      WS / HTTP API      +--------------------+   |

|   |  music-frontend  |------------------------>|    sync-backend    |   |

|   | (node:20-alpine) |                         | (node:20-alpine)   |   |

|   +------------------+                         +---------+----------+   |

|                                                          |              |

|                                                          | TCP (6379)   |

|                                                          v              |

|                                                +--------------------+   |

|                                                |    state-cache     |   |

|                                                |  (redis:7.2-alpine)|   |

|                                                +--------------------+   |

+-------------------------------------------------------------------------+



### Service Specifications

1. **`music-frontend` (`node:20-alpine` multi-stage build):** Serves production-optimized static PWA assets. It maps to host port `8080` for public HTTP/HTTPS ingress via the Cloudflare reverse proxy edge. It manages user interaction profiles, binds the browser audio runtime, and captures hardware media interactions.

2. **`sync-backend` (`node:20-alpine`):** Coordinates stateful WebSocket connections, handles real-time message routing, validates transactional schemas, and executes data store mutations. It maps no ports directly to the host machine and is completely inaccessible except through internal proxy routing.

3. **`state-cache` (`redis:7.2-alpine`):** Stores transient session schemas, active playheads, synchronization queues, and chronological connection arrays. It possesses zero external network configurations or mapped host ports, communicating exclusively with the backend service tier.



---



## 3. Real-Time Synchronization & Drift Compensation

Synchronization across distributed network paths relies on an event-driven master-to-peer replication layout combined with client-side clock compensation math.



### Drift Compensation Mechanics

When a sync event passes down to peer nodes, the client-side state machine tracks latency offsets by computing the unidirectional network transit delay ($\delta$) against local monotonic system time.



1. **Transit Delay Calculation:**

   $$\delta = \text{Date.now()} - \text{updatedAt}$$

2. **Target Playhead Estimation:**

   $$\text{Playhead}_{\text{target}} = \text{currentPlayhead} + \left(\frac{\delta}{1000}\right)$$

3. **Divergence Evaluation:** The client measures the absolute delta ($\Delta$) between its local playback position ($\text{Playhead}_{\text{local}}$) and the computed target:

   $$\Delta = |\text{Playhead}_{\text{local}} - \text{Target Playhead}|$$



* **If $\Delta > 1.5\text{ seconds}$:** The drift window breaches acceptable buffer boundaries. The client forces a hard realignment using the player's native seek API (`player.seekTo()`).

* **If $\Delta \le 1.5\text{ seconds}$:** The variance falls within normal transport jitter limits. The client allows uninterrupted playback to prevent choppy audio micro-stuttering.

* **Graceful Throttling Recovery:** If a client experiences severe browser tab throttling or packet degradation, the system favors progressive, smooth playback rate micro-adjustments or passive state synchronization rather than continuous, jarring audio seeking loops.



---



## 4. Reconnection Consistency & Authority Flow

To maintain synchronization truth across flakey mobile network profiles, the system establishes a strict authority hierarchy:



* **Sticky Election Policy:** Host election is sticky. If an active room host disconnects, the backend transfers host authority to the next chronological peer. If the original host subsequently reconnects, they do **not** automatically regain host authority. They join the active room as a standard client instance to prevent ping-pong authority flapping.

* **Snapshot Truth Authority:** The current room state saved inside the Redis database remains the single source of truth. Reconnecting clients must always force-replay their local state straight from the Redis snapshot data payload rather than attempting local peer-to-peer reconciliation loops.



---



## 5. Storage Architecture & Redis Key Layouts

Redis handles transient session data. All keys enforce explicit sliding-window expirations to ensure clean memory cycles.



### Key Layout & Structures

* **Room Metadata (Hash):** `room:{room_id}:meta`

  * *Fields:* `host_uid` (string), `is_playing` (binary flag), `current_track_id` (string), `last_playhead` (float), and `updated_at` (epoch timestamp).

  * *TTL:* 12 hours (refreshed on any active room state mutation).

* **Playback Queue (List):** `room:{room_id}:queue`

  * *Structure:* An ordered list containing centrally typed, stringified JSON strings tracking track schemas (`{"videoId": "abc", "title": "...", "duration": 180}`).

* **Chronological Join Order (Sorted Set):** `room:{room_id}:join_order`

  * *Structure:* A Redis Sorted Set (`ZSET`) where the `score` represents the exact epoch timestamp of initial room entry, and the `member` maps the user's `socket_id`. 

  * *Purpose:* Provides a deterministic, race-condition-proof order array used for host migration selection routines.



---



## 6. WebSocket Event Schema Definitions

To eliminate frontend/backend schema drift, all communications conform to strict, centrally typed versioned JSON payloads.



### Inbound Actions (Client $\rightarrow$ Server Hub)

```json

{

  "action": "ROOM_MUTATION",

  "version": 1,

  "correlationId": "tx_8f3c1a92-d7b4",

  "payload": {

    "roomId": "A3F9X2",

    "type": "SEEK", 

    "playhead": 45.23,

    "timestamp": 1716768341000

  }

}

(Valid mutation type parameters: PLAY, PAUSE, SEEK, SKIP, QUEUE_REORDER, ROOM_RESYNC)

Outbound Sync Frames (Server Hub $\rightarrow$ Client Room Broadcast)

JSON



{

  "event": "STATE_SYNC",

  "version": 1,

  "correlationId": "tx_8f3c1a92-d7b4",

  "payload": {

    "roomId": "A3F9X2",

    "isPlaying": true,

    "currentPlayhead": 45.23,

    "currentTrackId": "dQw4w9WgXcQ",

    "updatedAt": 1716768341005

  }

}

7. Rate Limiting & Abuse Mitigations

Token-Bucket Throttling: Sockets are subject to a token-bucket rate-limiting calculation at ingestion. High-frequency mutations (specifically SEEK and ROOM_RESYNC commands) are capped to a maximum burst threshold of 3 requests per 5-second sliding window per socket to mitigate server-side broadcast flooding.

Payload Boundary Restrictions: Max incoming queue additions and frame payloads are hard-capped at a string buffer length of 4KB. Active track list queues are limited to a maximum of 100 entries per room to eliminate memory exhaustion vectors.

Input Regex Filtering: Upstream track selection identifiers are programmatically verified against strict regex boundaries (^[a-zA-Z0-9_-]{11}$) checking for clean YouTube video ID shapes before database execution blocks commit the strings to memory.
