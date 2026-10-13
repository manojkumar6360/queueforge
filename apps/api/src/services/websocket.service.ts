import { WebSocket } from 'ws';
import { redis, redisSub } from '../lib/redis.js';
import { WebSocketMessage } from '@queueforge/types';

export class WebSocketService {
  private clients: Set<WebSocket> = new Set();
  private readonly CHANNEL = 'queueforge:events';

  constructor() {
    this.initPubSub();
  }

  private initPubSub() {
    redisSub.subscribe(this.CHANNEL, (err) => {
      if (err) {
        console.error('❌ Failed to subscribe to Redis Pub/Sub channel:', err);
      } else {
        console.log(`📡 WebSocket service subscribed to Redis channel: ${this.CHANNEL}`);
      }
    });

    redisSub.on('message', (_channel, messageStr) => {
      try {
        const message = JSON.parse(messageStr);
        this.broadcastLocal(message);
      } catch (err) {
        console.error('Failed to parse Pub/Sub message:', err);
      }
    });
  }

  addClient(socket: WebSocket) {
    this.clients.add(socket);
    socket.on('close', () => {
      this.clients.delete(socket);
    });
    socket.on('error', () => {
      this.clients.delete(socket);
    });
  }

  // Publish event across all instances via Redis Pub/Sub
  async broadcast<T>(message: WebSocketMessage<T>) {
    await redis.publish(this.CHANNEL, JSON.stringify(message));
  }

  // Broadcast to locally connected sockets
  private broadcastLocal<T>(message: WebSocketMessage<T>) {
    const payload = JSON.stringify(message);
    for (const socket of this.clients) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

export const wsService = new WebSocketService();
