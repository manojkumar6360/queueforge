# QueueForge

> **Distributed Virtual Waiting Room & High-Concurrency Flash Reservation Engine**  
> *Engineered to prevent database connection exhaustion, write-contention deadlocks, and inventory double-bookings during flash traffic surges.*

---

## 🏛️ Architectural Overview

During high-demand ticket drops (e.g., concert drops, limited sneaker releases), standard web architectures collapse due to synchronous database write contention and connection pool exhaustion. 

**QueueForge** introduces a multi-tier ingress defense pattern:

```
[ Incoming Flash Surge: 50,000+ Concurrent HTTP/WS Requests ]
                           │
                           ▼
  ┌─────────────────────────────────────────────────────────┐
  │       Ingress Rate Limiter & Virtual Waiting Room       │
  │    (Redis Sorted Sets FIFO Queuing • ZADD / ZRANK)      │
  └────────────────────────┬────────────────────────────────┘
                           │ Metered Admission (JWT Pass Tokens)
                           ▼
  ┌─────────────────────────────────────────────────────────┐
  │         Interactive Real-Time SVG Seating Canvas        │
  │   - Atomic Distributed Holds: Redis SET NX EX (600s)    │
  │   - Safe Ownership Release: Atomic Lua Evaluation       │
  │   - WebSocket Sync: Zero-Polling State Broadcasts       │
  └────────────────────────┬────────────────────────────────┘
                           │ Idempotent ACID Settlement
                           ▼
  ┌─────────────────────────────────────────────────────────┐
  │               PostgreSQL Database Core                  │
  │   - Unique Idempotency Key Constraint                   │
  │   - Interactive Transactional State Update              │
  └─────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack (100% Free Tier Ready)

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend** | Next.js 14 / Tailwind CSS / Lucide | Interactive 500-seat SVG Canvas & Live Waiting Room Telemetry |
| **Backend API** | Fastify (Node.js TypeScript) | High-throughput async REST endpoints & WebSockets |
| **Cache & Lock** | Redis (v7.2) | Sub-millisecond `ZADD` FIFO queues & `SET NX EX` distributed locks |
| **Database** | PostgreSQL (v16) + Prisma ORM | ACID transactional settlement with idempotent UUID constraint |
| **Background Jobs** | Node.js Worker Process | Automated batch queue draining & 10-minute hold sweepers |
| **Testing** | k6 & Native Concurrency Runner | Automated 200+ VU contention tests proving 0 double-bookings |

---

## ⚡ Concurrency Guarantees

### 1. Atomic Distributed Seat Locks (`SET NX EX`)
```typescript
// Atomically acquires 10-minute hold only if key does not exist
await redis.set(`lock:seat:${seatId}`, userId, "NX", "EX", 600);
```

### 2. Lock Steal Prevention via Lua Script
```lua
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
```
*Guarantees that if User A's hold expires and User B claims it, a delayed release from User A will never wrongfully delete User B's lock.*

### 3. Idempotent Checkout Transactions
Each checkout requires a client-generated UUID `idempotencyKey`. If a user mashes the checkout button or a network glitch retries the request, PostgreSQL's unique constraint ensures the exact same order receipt is returned without billing twice.

---

## 🚀 Quick Start Guide

### 1. Start Infrastructure Containers
```bash
docker compose up -d
```
Starts local **PostgreSQL (port 5432)** and **Redis (port 6379)**.

### 2. Install Dependencies
```bash
npm install
```

### 3. Run Database Migrations & Seeder
```bash
# Push Prisma schema to Postgres
npm run db:migrate --workspace=@queueforge/database

# Seed Wembley Arena with 500 tiered seats
npm run db:seed --workspace=@queueforge/database
```

### 4. Run Development Services
```bash
# Run Fastify API (port 4000)
npm run dev:api

# Run Background Worker
npm run dev:worker

# Run Next.js Web Frontend (port 3001)
npm run dev:web
```

Open [http://localhost:3001](http://localhost:3001) in your browser.

---

## 🧪 Empirical Concurrency Verification

Run the built-in concurrency contention test simulating 200 simultaneous users attacking the exact same seat:

```bash
npm run test:concurrency --workspace=@queueforge/load-tests
```

**Expected Result:**
```
Total Requests Sent:    200
Completed In:           85ms
Successful Holds (200): 1 ✅ (PERFECT)
Protected Clashes (409): 199 ✅ (ALL PROTECTED)
Server Errors (500s):   0 ✅ (ZERO ERRORS)
🎉 EMPIRICAL VERIFICATION PASSED: ZERO DOUBLE-BOOKINGS GUARANTEED!
```
