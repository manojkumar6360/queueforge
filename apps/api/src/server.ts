import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import dotenv from 'dotenv';

import { queueRoutes } from './routes/queue.routes.js';
import { seatRoutes } from './routes/seat.routes.js';
import { eventRoutes } from './routes/event.routes.js';
import { wsService } from './services/websocket.service.js';

dotenv.config();

const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = process.env.HOST || '0.0.0.0';

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

async function main() {
  // 1. Enable CORS for local Next.js frontend
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  // 2. High-throughput Rate Limiting
  await fastify.register(rateLimit, {
    max: 1000,
    timeWindow: '1 minute',
  });

  // 3. Register WebSocket support
  await fastify.register(fastifyWebsocket);

  fastify.register(async function (fastifyInstance) {
    fastifyInstance.get('/ws', { websocket: true }, (connection, _req) => {
      wsService.addClient(connection.socket);
      fastify.log.info(`🔌 WebSocket client connected (Total: ${wsService.getClientCount()})`);

      connection.socket.send(
        JSON.stringify({
          type: 'CONNECTED',
          data: { message: 'QueueForge WebSocket stream active' },
        })
      );
    });
  });

  // 4. Health Check
  fastify.get('/health', async () => {
    return {
      status: 'UP',
      timestamp: new Date().toISOString(),
      activeWebSockets: wsService.getClientCount(),
    };
  });

  // 5. Register Core Domain Routes
  await fastify.register(queueRoutes);
  await fastify.register(seatRoutes);
  await fastify.register(eventRoutes);

  // 6. Start Server
  try {
    await fastify.listen({ port: PORT, host: HOST });
    console.log(`\n======================================================`);
    console.log(`🚀 QueueForge Fastify API listening on http://${HOST}:${PORT}`);
    console.log(`🔌 WebSocket endpoint active at ws://${HOST}:${PORT}/ws`);
    console.log(`======================================================\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
