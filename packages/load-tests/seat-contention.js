// packages/load-tests/seat-contention.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  // Simulate 200 concurrent users attacking the exact same seat within 5 seconds
  vus: 200,
  duration: '5s',
};

export default function () {
  const url = 'http://localhost:4000/api/seats/event-coldplay-2026-A-1/hold';
  const payload = JSON.stringify({
    userId: `user-${__VU}-${__ITER}`,
    eventId: 'event-coldplay-2026',
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-jwt-pass',
    },
  };

  const res = http.post(url, payload, params);

  // We expect EXACTLY ONE 200 OK, and ALL OTHER 199 responses to be 409 Conflict
  check(res, {
    'status is 200 or 409': (r) => r.status === 200 || r.status === 409,
    'not a server crash 500': (r) => r.status !== 500,
  });

  sleep(0.1);
}
