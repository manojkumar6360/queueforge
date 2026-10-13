export type SeatStatus = 'AVAILABLE' | 'HELD' | 'SOLD' | 'BLOCKED';

export type EventStatus = 'UPCOMING' | 'ON_SALE' | 'SOLD_OUT' | 'COMPLETED';

export type OrderStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED';

export interface VenueDto {
  id: string;
  name: string;
  city: string;
  totalRows: number;
  totalCols: number;
}

export interface SeatDto {
  id: string;
  eventId: string;
  section: string;
  row: string;
  number: number;
  priceCents: number;
  status: SeatStatus;
  heldByUserId?: string | null;
  heldUntil?: number | null; // epoch timestamp in ms
}

export interface EventDto {
  id: string;
  title: string;
  venueId: string;
  venue?: VenueDto;
  eventDate: string;
  status: EventStatus;
  maxTicketsPerUser: number;
  totalSeats?: number;
  availableSeats?: number;
}

export interface OrderDto {
  id: string;
  eventId: string;
  userId: string;
  totalAmountCents: number;
  status: OrderStatus;
  idempotencyKey: string;
  seatIds: string[];
  createdAt: string;
}

export interface QueueStatusDto {
  eventId: string;
  userId: string;
  inQueue: boolean;
  rank: number;
  totalWaiting: number;
  estimatedWaitSeconds: number;
  isAdmitted: boolean;
  passToken?: string;
}

export interface QueuePassPayload {
  userId: string;
  eventId: string;
  exp: number; // expiration unix timestamp
  iat: number;
}

export interface SeatHoldRequest {
  eventId: string;
  seatId: string;
  userId: string;
}

export interface SeatHoldResponse {
  success: boolean;
  seatId: string;
  heldUntil: number;
  message?: string;
}

export interface CheckoutRequest {
  eventId: string;
  userId: string;
  seatIds: string[];
  idempotencyKey: string;
}

export interface CheckoutResponse {
  success: boolean;
  orderId: string;
  totalAmountCents: number;
  seats: string[];
  createdAt: string;
}

// WebSocket Event Types
export type WebSocketEventType =
  | 'SEAT_HELD'
  | 'SEAT_RELEASED'
  | 'SEAT_SOLD'
  | 'QUEUE_UPDATE'
  | 'QUEUE_ADMITTED';

export interface WebSocketMessage<T = unknown> {
  type: WebSocketEventType;
  eventId: string;
  data: T;
}
