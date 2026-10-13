import { redis } from '../lib/redis.js';

export class LockService {
  private lockKey(seatId: string): string {
    return `lock:seat:${seatId}`;
  }

  // 1. Atomically acquire a 10-minute hold (600 seconds)
  // NX = Only set key if it does NOT exist (Atomicity guarantee)
  // EX = Automatically expire key after ttlSeconds (Auto-release protection)
  async acquireSeatHold(seatId: string, userId: string, ttlSeconds: number = 600): Promise<boolean> {
    const key = this.lockKey(seatId);
    const result = await redis.set(key, userId, 'NX', 'EX', ttlSeconds);
    return result === 'OK';
  }

  // 2. Atomically release hold using Lua Script
  // Guarantees that User A cannot accidentally release a lock held by User B
  async releaseSeatHold(seatId: string, userId: string, force: boolean = false): Promise<boolean> {
    const key = this.lockKey(seatId);
    const luaScript = `
      if ARGV[2] == '1' or redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const result = await redis.eval(luaScript, 1, key, userId, force ? '1' : '0');
    return result === 1;
  }

  // 3. Inspect hold status and remaining TTL
  async getSeatHold(seatId: string): Promise<{ userId: string; ttlRemaining: number } | null> {
    const key = this.lockKey(seatId);
    const userId = await redis.get(key);
    if (!userId) return null;

    const ttlRemaining = await redis.ttl(key);
    return {
      userId,
      ttlRemaining: Math.max(0, ttlRemaining),
    };
  }

  // 4. Batch inspect seat holds (useful for rendering initial seat grid)
  async getMultipleHolds(seatIds: string[]): Promise<Map<string, { userId: string; ttlRemaining: number }>> {
    const holds = new Map<string, { userId: string; ttlRemaining: number }>();
    if (seatIds.length === 0) return holds;

    const pipeline = redis.pipeline();
    for (const seatId of seatIds) {
      pipeline.get(this.lockKey(seatId));
      pipeline.ttl(this.lockKey(seatId));
    }

    const results = await pipeline.exec();
    if (!results) return holds;

    for (let i = 0; i < seatIds.length; i++) {
      const seatId = seatIds[i];
      const getUserErr = results[i * 2][0];
      const user = results[i * 2][1] as string | null;
      const getTtlErr = results[i * 2 + 1][0];
      const ttl = (results[i * 2 + 1][1] as number) || 0;

      if (!getUserErr && user) {
        holds.set(seatId, {
          userId: user,
          ttlRemaining: Math.max(0, ttl),
        });
      }
    }

    return holds;
  }
}

export const lockService = new LockService();
