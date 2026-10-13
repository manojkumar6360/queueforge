import { FastifyInstance } from 'fastify';
import { seatService } from '../services/seat.service.js';
import { z } from 'zod';

const HoldSeatSchema = z.object({
  eventId: z.string(),
  userId: z.string(),
  ttlSeconds: z.number().optional().default(600),
});

const ReleaseSeatSchema = z.object({
  userId: z.string(),
  force: z.boolean().optional().default(false),
});

const CheckoutSchema = z.object({
  eventId: z.string(),
  userId: z.string(),
  seatIds: z.array(z.string()).min(1),
  idempotencyKey: z.string().min(1),
});

export async function seatRoutes(fastify: FastifyInstance) {
  // 1. Get all seats for an event with real-time hold statuses
  fastify.get('/api/events/:eventId/seats', async (request, reply) => {
    const { eventId } = request.params as { eventId: string };
    try {
      const seats = await seatService.getEventSeats(eventId);
      return reply.status(200).send(seats);
    } catch (err: any) {
      return reply.status(500).send({ error: 'FAILED_TO_FETCH_SEATS', message: err.message });
    }
  });

  // 2. Atomically hold a seat (High-concurrency contention point)
  fastify.post('/api/seats/:seatId/hold', async (request, reply) => {
    const { seatId } = request.params as { seatId: string };
    const parse = HoldSeatSchema.safeParse(request.body);

    if (!parse.success) {
      return reply.status(400).send({ error: 'INVALID_REQUEST', details: parse.error.format() });
    }

    const { eventId, userId, ttlSeconds } = parse.data;

    try {
      const result = await seatService.holdSeat(eventId, seatId, userId, ttlSeconds);
      return reply.status(200).send({
        success: true,
        seatId,
        heldUntil: result.heldUntil,
      });
    } catch (err: any) {
      if (err.message === 'SEAT_ALREADY_HELD' || err.message === 'SEAT_ALREADY_SOLD') {
        return reply.status(409).send({
          success: false,
          error: err.message,
          message: 'This seat is currently held or sold by another user.',
        });
      }
      if (err.message === 'SEAT_NOT_FOUND') {
        return reply.status(404).send({ success: false, error: 'SEAT_NOT_FOUND' });
      }

      fastify.log.error(err);
      return reply.status(500).send({ success: false, error: 'INTERNAL_ERROR', message: err.message });
    }
  });

  // 3. Release seat hold
  fastify.post('/api/seats/:seatId/release', async (request, reply) => {
    const { seatId } = request.params as { seatId: string };
    const parse = ReleaseSeatSchema.safeParse(request.body);

    if (!parse.success) {
      return reply.status(400).send({ error: 'INVALID_REQUEST', details: parse.error.format() });
    }

    const { userId, force } = parse.data;
    // Derive eventId from request body or seatId pattern
    const eventId = (request.body as any)?.eventId || 'event-coldplay-2026';

    const released = await seatService.releaseSeat(eventId, seatId, userId, force);
    return reply.status(200).send({ success: released, seatId });
  });

  // 4. Idempotent ACID checkout
  fastify.post('/api/checkout', async (request, reply) => {
    const parse = CheckoutSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'INVALID_REQUEST', details: parse.error.format() });
    }

    const { eventId, userId, seatIds, idempotencyKey } = parse.data;

    try {
      const result = await seatService.checkout(eventId, userId, seatIds, idempotencyKey);
      return reply.status(200).send(result);
    } catch (err: any) {
      if (err.message.startsWith('HOLD_EXPIRED_OR_NOT_OWNED')) {
        return reply.status(410).send({ error: 'HOLD_EXPIRED', message: err.message });
      }
      if (err.message.startsWith('SEAT_ALREADY_SOLD')) {
        return reply.status(409).send({ error: 'SEAT_ALREADY_SOLD', message: err.message });
      }

      fastify.log.error(err);
      return reply.status(500).send({ error: 'CHECKOUT_FAILED', message: err.message });
    }
  });
}
