/**
 * Standalone TypeScript Stress Runner
 * Simulates 200 concurrent users attacking the exact same seat within the same millisecond window.
 * Asserts:
 * - Exactly 1 request succeeds (HTTP 200)
 * - Exactly 199 requests are safely rejected (HTTP 409 Conflict)
 * - 0 requests crash the server (0 HTTP 500s)
 */

async function runStressTest() {
  const API_URL = process.env.API_URL || 'http://localhost:4000';
  const EVENT_ID = 'event-coldplay-2026';
  const SEAT_ID = `${EVENT_ID}-A-1`;
  const CONCURRENT_USERS = 200;

  console.log(`\n======================================================`);
  console.log(`🚀 QUEUEFORGE CONCURRENCY STRESS TEST`);
  console.log(`Simulating ${CONCURRENT_USERS} concurrent requests hitting seat: ${SEAT_ID}`);
  console.log(`======================================================\n`);

  // First release any existing hold on that seat for clean test run
  try {
    await fetch(`${API_URL}/api/seats/${SEAT_ID}/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'cleanup-user', force: true }),
    });
  } catch (err) {
    // Ignore cleanup error if not running
  }

  const startTime = Date.now();
  const promises: Promise<Response>[] = [];

  for (let i = 0; i < CONCURRENT_USERS; i++) {
    const userId = `stress-user-${i + 1}`;
    const p = fetch(`${API_URL}/api/seats/${SEAT_ID}/hold`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        eventId: EVENT_ID,
        seatId: SEAT_ID,
        userId: userId,
      }),
    });
    promises.push(p);
  }

  const responses = await Promise.all(promises);
  const totalDuration = Date.now() - startTime;

  let successes = 0;
  let conflicts = 0;
  let errors = 0;
  let winnerUserId = '';

  for (let i = 0; i < responses.length; i++) {
    const res = responses[i];
    if (res.status === 200) {
      successes++;
      const body = (await res.json()) as any;
      winnerUserId = `user-${i + 1}`;
    } else if (res.status === 409) {
      conflicts++;
    } else {
      errors++;
      const errText = await res.text();
      console.error(`Unexpected status ${res.status}:`, errText);
    }
  }

  console.log(`---------------- RESULTS ----------------`);
  console.log(`Total Requests Sent:    ${CONCURRENT_USERS}`);
  console.log(`Completed In:           ${totalDuration}ms (Avg ${(totalDuration / CONCURRENT_USERS).toFixed(2)}ms / req)`);
  console.log(`Successful Holds (200): ${successes} ${successes === 1 ? '✅ (PERFECT)' : '❌ (RACE CONDITION DETECTED!)'}`);
  console.log(`Protected Clashes (409): ${conflicts} ${conflicts === CONCURRENT_USERS - 1 ? '✅ (ALL PROTECTED)' : '❌'}`);
  console.log(`Server Errors (500s):   ${errors} ${errors === 0 ? '✅ (ZERO ERRORS)' : '❌'}`);
  console.log(`-----------------------------------------\n`);

  if (successes === 1 && conflicts === CONCURRENT_USERS - 1 && errors === 0) {
    console.log(`🎉 EMPIRICAL VERIFICATION PASSED: ZERO DOUBLE-BOOKINGS GUARANTEED!`);
    process.exit(0);
  } else {
    console.error(`❌ STRESS TEST FAILED.`);
    process.exit(1);
  }
}

runStressTest().catch((err) => {
  console.error('Fatal stress test runner error:', err);
  process.exit(1);
});
