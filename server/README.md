# PartyHazz Server

WebSocket relay server for the **PartyHazz** Chrome extension — synchronized Crunchyroll viewing for multiple users.

---

## Prerequisites

| Tool | Minimum version |
|---|---|
| Java (JDK) | 17 |
| Maven | 3.8 |

---

## Build

```bash
cd server
mvn clean package -q
```

This produces a single executable fat-jar at `target/partyhazz-server.jar`.

---

## Run locally

```bash
# Default port (8080)
java -jar target/partyhazz-server.jar

# Custom port
PORT=9000 java -jar target/partyhazz-server.jar
```

Logs are written to the console and to `logs/partyhazz.log` (rolling daily, kept for 7 days).

---

## WebSocket API

### Endpoint

```
ws://<host>:<port>/ws
```

> **Default:** `ws://localhost:8080/ws`

All messages are UTF-8 encoded JSON text frames. There are no query parameters — room association is done via messages after the connection is established.

---

### Client → Server messages

#### `CREATE_ROOM`
Creates a new room. The sender becomes the host.

```json
{ "type": "CREATE_ROOM" }
```

#### `JOIN_ROOM`
Joins an existing room. Optionally include your previous `participantId` for reconnection.

```json
{ "type": "JOIN_ROOM", "roomId": "A3B9KZ" }

// Reconnection (within 30 s of disconnect):
{ "type": "JOIN_ROOM", "roomId": "A3B9KZ", "participantId": "<your-previous-uuid>" }
```

#### `LEAVE_ROOM`
Gracefully leaves the current room.

```json
{ "type": "LEAVE_ROOM" }
```

#### `PLAY` / `PAUSE` / `SEEK`
Sync events — relayed to all other room members.

```json
{ "type": "PLAY",  "time": 1234.56 }
{ "type": "PAUSE", "time": 1234.56 }
{ "type": "SEEK",  "time": 1234.56 }
```

#### `SYNC_CHECK`
Latency probe — relayed to all other room members.

```json
{ "type": "SYNC_CHECK", "time": 1234.56, "sendTimestamp": 1700000000000 }
```

#### `STATE_REQUEST`
Sent by a newly joined client to request the current playback state. The server forwards this to the host.

```json
{ "type": "STATE_REQUEST" }
```

#### `STATE_RESPONSE`
Sent by the host in response to a `STATE_REQUEST`. The server routes it to the requester identified by `toParticipantId`.

```json
{
  "type": "STATE_RESPONSE",
  "toParticipantId": "<uuid-of-requester>",
  "time": 1234.56,
  "paused": false
}
```

---

### Server → Client messages

#### `ROOM_CREATED`
Sent to the room creator.

```json
{
  "type": "ROOM_CREATED",
  "roomId": "A3B9KZ",
  "participantId": "<your-uuid>",
  "isHost": true
}
```

> ⚠️ **Save `participantId`** in `chrome.storage.session` — you'll need it to reconnect within 30 seconds if you lose connection.

#### `ROOM_JOINED`
Sent to the participant who just joined.

```json
{
  "type": "ROOM_JOINED",
  "roomId": "A3B9KZ",
  "participantId": "<your-uuid>",
  "isHost": false,
  "participants": 2,
  "reconnected": false
}
```

#### `USER_JOINED`
Broadcast to all existing room members when someone new joins.

```json
{ "type": "USER_JOINED", "participants": 3 }
```

#### `USER_LEFT`
Broadcast when a participant leaves or disconnects.

```json
{
  "type": "USER_LEFT",
  "participants": 2,
  "newHost": true,
  "reconnecting": false
}
```

- `newHost: true` — the recipient is the new host
- `reconnecting: true` — the user may come back within 30 s

#### `PLAY` / `PAUSE` / `SEEK` / `SYNC_CHECK`
Relayed verbatim from the sender to all other room members.

#### `STATE_REQUEST` (forwarded to host)
```json
{ "type": "STATE_REQUEST", "fromParticipantId": "<uuid>" }
```

#### `STATE_RESPONSE` (forwarded to requester)
Contains whatever fields the host included.

#### `ERROR`
```json
{ "type": "ERROR", "message": "Room not found: XXXXXX" }
```

---

### Room ID format

6-character uppercase alphanumeric code using unambiguous characters (no `0/O`, `1/I`).

**Example:** `A3B9KZ`

---

### Reconnection flow

```
1. Client disconnects unexpectedly
2. Server opens a 30-second reconnection window
3. Client reconnects (new WebSocket to ws://host:port/ws)
4. Client sends JOIN_ROOM with its saved participantId:
   { "type": "JOIN_ROOM", "roomId": "A3B9KZ", "participantId": "<saved-uuid>" }
5. Server cancels the eviction timer and re-integrates the participant
6. Server sends ROOM_JOINED with "reconnected": true
```

---

## Docker

### Build image

```bash
docker build -t partyhazz-server .
```

### Run container

```bash
# Default port 8080
docker run -p 8080:8080 partyhazz-server

# Custom port
docker run -p 9000:8080 -e PORT=8080 partyhazz-server
```

### Docker Compose (optional)

```yaml
version: "3.9"
services:
  partyhazz:
    build: .
    ports:
      - "8080:8080"
    environment:
      - PORT=8080
    restart: unless-stopped
```

---

## Project structure

```
server/
├── src/main/java/com/partyhazz/
│   ├── MainVerticle.java       # Entry point, HTTP/WS server
│   ├── RoomManager.java        # Room lifecycle + event relay
│   ├── MessageHandler.java     # JSON parsing + dispatch
│   └── model/
│       ├── Room.java           # Room state
│       └── Participant.java    # Per-connection state
├── src/main/resources/
│   ├── logback.xml             # Logging configuration
│   └── config.json             # Default configuration
├── Dockerfile
└── pom.xml
```

---

## Performance notes

- Single event-loop thread: Vert.x guarantees that all WebSocket callbacks and timer
  handlers run on the same thread as the verticle, so `RoomManager`'s plain `HashMap`
  is safe without locking.
- At 500 rooms × 10 users = 5,000 concurrent connections, the bottleneck is network I/O,
  not CPU. Vert.x's Netty-based non-blocking I/O handles this comfortably on a single core.
- If horizontal scaling is needed, move room state to Redis and use Vert.x's Hazelcast
  cluster manager.
