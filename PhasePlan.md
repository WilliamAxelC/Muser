# MRelay Phased Implementation & Deployment Blueprint

Development must advance sequentially through the following phases. Do not begin a new phase until the validation pipeline of the preceding phase returns process exit code 0.

## Phase 0 — Infrastructure Bootstrap
* **Objective:** Establish the containerized network topology and transient data plane.
* **Task:** Initialize `infrastructure/docker-compose.yml`. Define a private bridge network (`mrelay-net`) and the `state-cache` service using a pinned `redis:7.2-alpine` image. Configure a container healthcheck using `redis-cli ping` to test port readiness.
* **Validation:** Run `docker compose up -d state-cache` and verify the container transitions to a healthy status.

## Phase 1 — Backend Foundation & Observability Setup
* **Objective:** Build out the base application framework and integration harness.
* **Task:** Inside `backend/`, provision a strict-mode TypeScript environment. Implement:
  * An Express HTTP server with a public `/health` endpoint.
  * A Socket.io server layer extending default interfaces to store metadata (`roomId`, `userId`) safely.
  * An `ioredis` cache connection layer targeting the internal hostname of the `state-cache` container.
  * **Startup Gating:** Enforce orchestration sequence using explicit Docker Compose `depends_on` parameters checking for the `service_healthy` condition of the Redis service.
  * **Observability Standard:** Implement structured JSON logging to stdout. Every log entry must inject: `timestamp`, `service_name`, `severity` (INFO/WARN/ERROR), `socket_id`, `room_id`, and a unique `correlation_id` to trace distributed operations.
  * **Version-Safe Event Guard:** Ensure all WebSocket event payloads are centrally typed and version-checked at ingress to prevent frontend/backend schema drift.
  * **Test Harness:** Write an automated execution script (`src/test-client.ts`) using `socket.io-client` to run a headless connection lifecycle.
* **Validation:** Confirm `npm run lint` and `npm run build` return code 0. Spin up the containers; verify the server connects to Redis without exceptions, and assert that the test client finishes its loop with exit code 0.

## Phase 2 — Room Lifecycle & Deterministic Election System
* **Objective:** Establish room management channels and node hierarchy tracking.
* **Task:** Implement room creation, entry validation, and deletion event paths. Map data models to Redis Hashes with a 12-hour sliding-window TTL. 
  * **Deterministic Host Election:** Implement host-election tracking using a Redis Sorted Set at `room:{room_id}:join_order`. The `score` must store the initial epoch connection timestamp, and the `member` must store the `socket_id`. Host election consistency only needs to be guaranteed under normal single-failure conditions.
* **Validation:** Drive concurrent socket connections via the testing harness. Run controlled database inspections using `docker compose exec state-cache redis-cli ZRANGE "room:XYZ:join_order" 0 -1 WITHSCORES` to verify chronological peer ordering.

## Phase 3 — WebSocket Event System & Rate Limiting
* **Objective:** Operationalize real-time stream state replication.
* **Task:** Implement all event schemas defined in Section 6 of `Architecture.md` (`PLAY`, `PAUSE`, `SEEK`, `SKIP`, `QUEUE_REORDER`, `ROOM_RESYNC`, `STATE_SYNC`).
  * **Abuse Mitigations:** Enforce strict Zod schema validation checks on incoming payloads. Drop any frames over 4KB. Implement a per-socket token-bucket or sliding-window rate limiter to throttle high-frequency mutation events (specifically targeting `SEEK` and `ROOM_RESYNC` floods).
* **Validation:** Run the test script to issue rapid event sequences. Verify the server throttles flood events, drops oversized payloads safely, and broadcasts accurate state frames to synchronized peers.

## Phase 4 — Host Migration & Recovery Loops
* **Objective:** Build self-healing state transitions for disconnected sockets.
* **Task:** Implement socket heartbeat monitoring and a 15-second host tracking window handler. Upon host drop, queries must pull the lowest score from `room:{room_id}:join_order` to appoint the longest-lived socket peer as the new master. Ensure all socket disconnect handlers cleanly prune stale membership indices and clear active timeouts.
* **Validation:** Force-disconnect an active host thread via the test client. Verify inside logs that the server detects the drop, selects the correct chronological peer from the sorted set, and broadcasts a `HOST_CHANGED` frame.

## Phase 5 — Frontend UI Foundation
* **Objective:** Deploy the core client application layer.
* **Task:** Inside `frontend/`, scaffold a React + Vite + TypeScript interface (strict mode) with Tailwind CSS formatting. Integrate the Socket.io client layer and provide a multi-stage `Dockerfile`.
* **Validation:** Frontend validation must return zero compilation warnings or runtime console errors. The agent must verify:
  * The room join/creation states render correctly in the viewport.
  * WebSocket reconnection frames update UI states natively.
  * Queue mutations render modifications deterministically.
  * Invalid room codes or server rejections surface clear, user-visible errors.

## Phase 6 — YouTube Synchronization Layer & UX Rules
* **Objective:** Implement synchronized audio tracking across distributed clients.
* **Task:** Integrate the client-side YouTube IFrame Player API. Track a local execution toggle (`isProcessingRemoteEvent`) to isolate outbound loop triggers. Incorporate the mathematical drift compensation engine exactly as specified in Section 3 of `Architecture.md`.
* **Graceful Degradation:** If synchronization accuracy shifts due to browser tab throttling or packet jitter, favor smooth, progressive playback tracking over rapid, disruptive audio seeking maneuvers.
* **Acceptance Criteria:** Peers must synchronize within $\pm 1.5$ seconds of the master client under standard network profiles. Reconnection recovery states must completely resolve within 5 seconds under standard conditions.
* **Validation:** Open parallel browser frames. Confirm state replication loops, verify drift corrections trigger *only* when the 1.5-second threshold is broken, and ensure backgrounded tabs recover sync cleanly upon regain of focus.

## Phase 7 — Media Session & PWA Integration
* **Objective:** Implement system hardware audio control bindings.
* **Task:** Generate an installable web manifest configuration profile, set up an offline asset caching strategy using a web service worker, and bind event controls to the native browser `navigator.mediaSession` framework.
* **Validation:** Deploy the complete container stack. Verify the app is installable on mobile platforms, and confirm system notification media overlays, lock screen widgets, and attached Bluetooth hardware inputs map directly into active WebSocket room events.

## III. Continuous CI/CD Automated Execution Spec
To maintain production-ready integration, every build phase execution loop must comply with these pipeline automation requirements:
1. **Gating Timeouts:** Container initialization and internal healthchecks must achieve a full green status within a maximum threshold of 60 seconds. Exceeding this boundary must trigger a pipeline failure code 1.
2. **Handle Cleanup Validation:** Automated integration test scripts must exit cleanly. The workflow must fail if process execution hangs due to uncleaned websocket handles, dangling event loops, or active intervals.
3. **Isolation Verification:** Network configurations must verify that the backend application cannot accept direct external connections outside its designated proxy route, and the data tier remains isolated from public host addresses.
