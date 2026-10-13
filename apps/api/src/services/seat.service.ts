import { prisma, SeatStatus, OrderStatus } from '@queueforge/database';
import { lockService } from './lock.service.js';
import { wsService } from './websocket.service.js';
import { SeatDto } from '@queueforge/types';

export class SeatService {
  // 1. Fetch all seats for an event with live Redis hold statuses merged
  async getEventSeats(eventId: string): Promise<SeatDto[]> {
    const seats = await prisma.seat.findMany({
      where: { eventId },
      orderBy: [{ row: 'asc' }, { number: 'asc' }],
    });

    const seatIds = seats.map((s) => s.id);
    const liveHolds = await lockService.getMultipleHolds(seatIds);

    const now = Date.now();
    return seats.map((seat) => {
      const hold = liveHolds.get(seat.id);
      let status: 'AVAILABLE' | 'HELD' | 'SOLD' | 'BLOCKED' = seat.status;

      if (seat.status === SeatStatus.AVAILABLE && hold) {
        status = 'HELD';
      }

      return {
        id: seat.id,
        eventId: seat.eventId,
        section: seat.section,
        row: seat.row,
        number: seat.number,
        priceCents: seat.priceCents,
        status,
        heldByUserId: hold ? hold.userId : null,
        heldUntil: hold ? now + hold.ttlRemaining * 1000 : null,
      };
    });
  }

  // 2. Atomically hold seat (Redis SET NX EX)
  async holdSeat(
    eventId: string,
    seatId: string,
    userId: string,
    ttlSeconds: number = 600
  ): Promise<{ success: boolean; heldUntil: number }> {
    // Fast check: verify seat is in database and available
    const seat = await prisma.seat.findUnique({
      where: { id: seatId },
      select: { status: true, eventId: true },
    });

    if (!seat || seat.eventId !== eventId) {
      throw new Error('SEAT_NOT_FOUND');
    }

    if (seat.status === SeatStatus.SOLD) {
      throw new Error('SEAT_ALREADY_SOLD');
    }

    // Atomic acquisition in Redis
    const acquired = await lockService.acquireSeatHold(seatId, userId, ttlSeconds);
    if (!acquired) {
      throw new Error('SEAT_ALREADY_HELD');
    }

    const heldUntil = Date.now() + ttlSeconds * 1000;

    // Broadcast live hold via WebSockets
    await wsService.broadcast({
      type: 'SEAT_HELD',
      eventId,
      data: {
        seatId,
        heldByUserId: userId,
        heldUntil,
      },
    });

    return { success: true, heldUntil };
  }

  // 3. Release seat hold
  async releaseSeat(
    eventId: string,
    seatId: string,
    userId: string,
    force: boolean = false
  ): Promise<boolean> {
    const released = await lockService.releaseSeatHold(seatId, userId, force);
    if (released) {
      await wsService.broadcast({
        type: 'SEAT_RELEASED',
        eventId,
        data: { seatId },
      });
    }
    return released;
  }

  // 4. Idempotent ACID checkout
  async checkout(
    eventId: string,
    userId: string,
    seatIds: string[],
    idempotencyKey: string
  ): Promise<{
    orderId: string;
    totalAmountCents: number;
    seats: string[];
    createdAt: string;
    isDuplicateReplay: boolean;
  }> {
    if (seatIds.length === 0) {
      throw new Error('NO_SEATS_SELECTED');
    }

    // 1. Idempotency Check: Return existing order if already submitted
    const existingOrder = await prisma.order.findUnique({
      where: { idempotencyKey },
      include: { seats: true },
    });

    if (existingOrder) {
      return {
        orderId: existingOrder.id,
        totalAmountCents: existingOrder.totalAmountCents,
        seats: existingOrder.seats.map((s) => s.id),
        createdAt: existingOrder.createdAt.toISOString(),
        isDuplicateReplay: true,
      };
    }

    // 2. Validate that the requesting user holds all requested seats
    for (const seatId of seatIds) {
      const hold = await lockService.getSeatHold(seatId);
      if (!hold || hold.userId !== userId) {
        throw new Error(`HOLD_EXPIRED_OR_NOT_OWNED:${seatId}`);
      }
    }

    // 3. PostgreSQL Transaction: Atomically settle inventory & create order
    const result = await prisma.$transaction(async (tx) => {
      // Fetch DB seats with row lock or check
      const dbSeats = await tx.seat.findMany({
        where: {
          id: { in: seatIds },
          eventId,
        },
      });

      if (dbSeats.length !== seatIds.length) {
        throw new Error('INVALID_SEAT_SELECTION');
      }

      for (const s of dbSeats) {
        if (s.status === SeatStatus.SOLD) {
          throw new Error(`SEAT_ALREADY_SOLD_IN_DB:${s.id}`);
        }
      }

      const totalAmountCents = dbSeats.reduce((sum, s) => sum + s.priceCents, 0);

      // Create Order
      const order = await tx.order.create({
        data: {
          eventId,
          userId,
          totalAmountCents,
          status: OrderStatus.COMPLETED,
          idempotencyKey,
        },
      });

      // Update seats to SOLD and link order
      await tx.seat.updateMany({
        where: { id: { in: seatIds } },
        data: {
          status: SeatStatus.SOLD,
          orderId: order.id,
        },
      });

      return { order, totalAmountCents };
    });

    // 4. Release Redis locks
    for (const seatId of seatIds) {
      await lockService.releaseSeatHold(seatId, userId, true);
      // Broadcast SEAT_SOLD
      await wsService.broadcast({
        type: 'SEAT_SOLD',
        eventId,
        data: { seatId },
      });
    }

    return {
      orderId: result.order.id,
      totalAmountCents: result.totalAmountCents,
      seats: seatIds,
      createdAt: result.order.createdAt.toISOString(),
      isDuplicateReplay: false,
    };
  }
}

export const seatService = new SeatService();
