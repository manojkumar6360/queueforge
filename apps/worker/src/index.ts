import dotenv from 'dotenv';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const JWT_SECRET = process.env.JWT_SECRET || 'queueforge-super-secret-jwt-key-2026';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '25', 10);
const DRAIN_INTERVAL_MS = parseInt(process.env.DRAIN_INTERVAL_MS || '10000', 10);

const redis = new Redis(REDIS_URL);
const redisPub = new Redis(REDIS_URL);

console.log('⚙️ QueueForge Background Worker starting...');

// 1. Queue Drain Worker Loop
async function processQueueDrain() {
  const eventId = 'event-coldplay-2026';
  const queueKey = `queue:event:${eventId}`;

  try {
    const queueLength = await redis.zcard(queueKey);
    if (queueLength > 0) {
      console.log(`[QueueDrain] Processing queue for ${eventId}: ${queueLength} users waiting...`);

      // Atomically extract lowest scores (FIFO)
      const popped = await redis.zpopmin(queueKey, BATCH_SIZE);
      const admittedCount = popped.length / 2;

      for (let i = 0; i < popped.length; i += 2) {
        const userId = popped[i];
        if (!userId) continue;

        // Generate 15-minute cryptographically signed JWT pass
        const passToken = jwt.sign({ userId, eventId }, JWT_SECRET, { expiresIn: '15m' });

        // Record in Redis admitted cache for 15 minutes (900 seconds)
        await redis.set(`queue:admitted:${eventId}:${userId}`, passToken, 'EX', 900);

        // Broadcast to WebSockets
        await redisPub.publish(
          'queueforge:events',
          JSON.stringify({
            type: 'QUEUE_ADMITTED',
            eventId,
            data: { userId, passToken },
          })
        );
      }

      console.log(`[QueueDrain] Admitted batch of ${admittedCount} users. Remaining in queue: ${queueLength - admittedCount}`);

      // Broadcast queue update to remaining users
      await redisPub.publish(
        'queueforge:events',
        JSON.stringify({
          type: 'QUEUE_UPDATE',
          eventId,
          data: {
            totalWaiting: Math.max(0, queueLength - admittedCount),
          },
        })
      );
    }
  } catch (err) {
    console.error('[QueueDrain] Error processing drain:', err);
  }
}

// 2. Start intervals
setInterval(processQueueDrain, DRAIN_INTERVAL_MS);

console.log(`✅ QueueForge Worker active. Drain interval: ${DRAIN_INTERVAL_MS / 1000}s (Batch size: ${BATCH_SIZE})`);
