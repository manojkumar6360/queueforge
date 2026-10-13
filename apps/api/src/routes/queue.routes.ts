import { FastifyInstance } from 'fastify';
import { queueService } from '../services/queue.service.js';
import { z } from 'zod';

const EnterQueueSchema = z.object({
  eventId: z.string(),
  userId: z.string(),
});

const QueueStatusQuerySchema = z.object({
  eventId: z.string(),
  userId: z.string(),
});

const AdmitBatchSchema = z.object({
  eventId: z.string(),
  batchSize: z.number().optional().default(25),
});

export async function queueRoutes(fastify: FastifyInstance) {
  // 1. Enter Virtual Waiting Room
  fastify.post('/api/queue/enter', async (request, reply) => {
    const parse = EnterQueueSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'INVALID_REQUEST', details: parse.error.format() });
    }

    const { eventId, userId } = parse.data;
    const result = await queueService.enterQueue(eventId, userId);

    return reply.status(200).send(result);
  });

  // 2. Fetch live queue status & rank
  fastify.get('/api/queue/status', async (request, reply) => {
    const parse = QueueStatusQuerySchema.safeParse(request.query);
    if (!parse.success) {
      return reply.status(400).send({ error: 'INVALID_QUERY', details: parse.error.format() });
    }

    const { eventId, userId } = parse.data;
    const isAdmitted = await queueService.isAdmitted(eventId, userId);

    if (isAdmitted) {
      const passToken = queueService.generatePassToken(eventId, userId);
      return reply.status(200).send({
        eventId,
        userId,
        inQueue: false,
        rank: 0,
        totalWaiting: await queueService.getTotalWaiting(eventId),
        estimatedWaitSeconds: 0,
        isAdmitted: true,
        passToken,
      });
    }

    const rank = await queueService.getRank(eventId, userId);
    const totalWaiting = await queueService.getTotalWaiting(eventId);
    const waitTimeSeconds = rank > 0 ? Math.ceil(rank / 2.5) : 0;

    return reply.status(200).send({
      eventId,
      userId,
      inQueue: rank > 0,
      rank,
      totalWaiting,
      estimatedWaitSeconds: waitTimeSeconds,
      isAdmitted: false,
    });
  });

  // 3. Batch Admit (Worker / Admin trigger)
  fastify.post('/api/queue/admit', async (request, reply) => {
    const parse = AdmitBatchSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'INVALID_REQUEST', details: parse.error.format() });
    }

    const { eventId, batchSize } = parse.data;
    const admitted = await queueService.admitBatch(eventId, batchSize);

    return reply.status(200).send({
      eventId,
      admittedCount: admitted.length,
      admittedUsers: admitted,
    });
  });
}
