import { redis } from '../lib/redis.js';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'queueforge-super-secret-jwt-key-2026';

export class QueueService {
  private queueKey(eventId: string): string {
    return `queue:event:${eventId}`;
  }

  private admittedKey(eventId: string, userId: string): string {
    return `queue:admitted:${eventId}:${userId}`;
  }

  // 1. Enter Queue (strict FIFO using Unix timestamp)
  async enterQueue(eventId: string, userId: string): Promise<{
    rank: number;
    totalWaiting: number;
    waitTimeSeconds: number;
    isAdmitted: boolean;
    passToken?: string;
  }> {
    // Check if user is already admitted
    const alreadyAdmitted = await this.isAdmitted(eventId, userId);
    if (alreadyAdmitted) {
      const token = this.generatePassToken(eventId, userId);
      return {
        rank: 0,
        totalWaiting: await this.getTotalWaiting(eventId),
        waitTimeSeconds: 0,
        isAdmitted: true,
        passToken: token,
      };
    }

    const key = this.queueKey(eventId);
    // Check if user is already in queue
    const existingRank = await redis.zrank(key, userId);
    if (existingRank === null) {
      const score = Date.now();
      await redis.zadd(key, score, userId);
    }

    const rank = await this.getRank(eventId, userId);
    const totalWaiting = await this.getTotalWaiting(eventId);
    // Admission rate: 25 users per 10 seconds (~2.5 users/sec)
    const waitTimeSeconds = Math.max(1, Math.ceil(rank / 2.5));

    return {
      rank,
      totalWaiting,
      waitTimeSeconds,
      isAdmitted: false,
    };
  }

  // 2. Fetch live rank (1-indexed)
  async getRank(eventId: string, userId: string): Promise<number> {
    const key = this.queueKey(eventId);
    const rank = await redis.zrank(key, userId);
    return rank !== null ? rank + 1 : -1;
  }

  // 3. Fetch total waiting users
  async getTotalWaiting(eventId: string): Promise<number> {
    const key = this.queueKey(eventId);
    return await redis.zcard(key);
  }

  // 4. Check if user is already admitted
  async isAdmitted(eventId: string, userId: string): Promise<boolean> {
    const key = this.admittedKey(eventId, userId);
    const val = await redis.get(key);
    return val !== null;
  }

  // 5. Admit batch of users (used by background worker or admin controller)
  async admitBatch(eventId: string, batchSize: number = 25): Promise<Array<{ userId: string; passToken: string }>> {
    const key = this.queueKey(eventId);
    // ZPOPMIN atomically pops the lowest scores (earliest arrivals)
    const popped = await redis.zpopmin(key, batchSize);
    const admittedUsers: Array<{ userId: string; passToken: string }> = [];

    // Popped returns array of [member, score, member, score, ...]
    for (let i = 0; i < popped.length; i += 2) {
      const userId = popped[i];
      if (!userId) continue;

      // Mark admitted for 15 minutes (900 seconds)
      const admKey = this.admittedKey(eventId, userId);
      const token = this.generatePassToken(eventId, userId);
      await redis.set(admKey, token, 'EX', 900);

      admittedUsers.push({ userId, passToken: token });
    }

    return admittedUsers;
  }

  // 6. Generate cryptographically signed JWT pass (valid for 15 minutes)
  generatePassToken(eventId: string, userId: string): string {
    return jwt.sign(
      {
        userId,
        eventId,
      },
      JWT_SECRET,
      { expiresIn: '15m' }
    );
  }

  // 7. Verify Pass Token
  verifyPassToken(token: string): { userId: string; eventId: string } | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; eventId: string };
      return decoded;
    } catch {
      return null;
    }
  }
}

export const queueService = new QueueService();
