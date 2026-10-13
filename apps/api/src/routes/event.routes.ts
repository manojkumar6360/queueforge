import { FastifyInstance } from 'fastify';
import { prisma } from '@queueforge/database';

export async function eventRoutes(fastify: FastifyInstance) {
  fastify.get('/api/events', async (_request, reply) => {
    const events = await prisma.event.findMany({
      include: {
        venue: true,
        _count: {
          select: { seats: true },
        },
      },
    });

    return reply.status(200).send(events);
  });

  fastify.get('/api/events/:eventId', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        venue: true,
        _count: {
          select: { seats: true },
        },
      },
    });

    if (!event) {
      return reply.status(404).send({ error: 'EVENT_NOT_FOUND' });
    }

    return reply.status(200).send(event);
  });
}
