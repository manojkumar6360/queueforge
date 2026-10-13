'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldCheck,
  Zap,
  Users,
  Ticket,
  Clock,
  CheckCircle,
  AlertCircle,
  Activity,
  Play,
  RotateCcw,
} from 'lucide-react';
import { SeatDto } from '@queueforge/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const WS_BASE = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000/ws';
const EVENT_ID = 'event-coldplay-2026';

export default function QueueForgeApp() {
  // User Identity
  const [userId, setUserId] = useState<string>('user-' + Math.floor(1000 + Math.random() * 9000));

  // Waiting Room State
  const [inQueue, setInQueue] = useState<boolean>(false);
  const [queueRank, setQueueRank] = useState<number>(0);
  const [totalWaiting, setTotalWaiting] = useState<number>(0);
  const [isAdmitted, setIsAdmitted] = useState<boolean>(true); // start admitted or toggle queue
  const [passToken, setPassToken] = useState<string | null>(null);

  // Seat Grid State
  const [seats, setSeats] = useState<SeatDto[]>([]);
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  const [loadingSeats, setLoadingSeats] = useState<boolean>(true);
  const [orderReceipt, setOrderReceipt] = useState<any | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);

  // Hold Timer (seconds remaining)
  const [holdTimer, setHoldTimer] = useState<number>(600);

  // Load Test Simulation State
  const [stressTesting, setStressTesting] = useState<boolean>(false);
  const [stressResults, setStressResults] = useState<any | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  // 1. Fetch initial seat state
  const loadSeats = async () => {
    try {
      setLoadingSeats(true);
      const res = await fetch(`${API_BASE}/api/events/${EVENT_ID}/seats`);
      if (res.ok) {
        const data = await res.json();
        setSeats(data);
      }
    } catch (err) {
      console.error('Failed to load seats:', err);
    } finally {
      setLoadingSeats(false);
    }
  };

  useEffect(() => {
    loadSeats();
  }, []);

  // 2. Setup WebSocket Stream
  useEffect(() => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(WS_BASE);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onclose = () => {
        setWsConnected(false);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'SEAT_HELD') {
            const { seatId, heldByUserId, heldUntil } = msg.data;
            setSeats((prev) =>
              prev.map((s) =>
                s.id === seatId
                  ? { ...s, status: 'HELD', heldByUserId, heldUntil }
                  : s
              )
            );
          } else if (msg.type === 'SEAT_RELEASED') {
            const { seatId } = msg.data;
            setSeats((prev) =>
              prev.map((s) =>
                s.id === seatId
                  ? { ...s, status: 'AVAILABLE', heldByUserId: null, heldUntil: null }
                  : s
              )
            );
          } else if (msg.type === 'SEAT_SOLD') {
            const { seatId } = msg.data;
            setSeats((prev) =>
              prev.map((s) =>
                s.id === seatId
                  ? { ...s, status: 'SOLD', heldByUserId: null, heldUntil: null }
                  : s
              )
            );
          } else if (msg.type === 'QUEUE_ADMITTED') {
            if (msg.data.userId === userId) {
              setIsAdmitted(true);
              setInQueue(false);
              setPassToken(msg.data.passToken);
            }
          } else if (msg.type === 'QUEUE_UPDATE') {
            if (msg.data.totalWaiting !== undefined) {
              setTotalWaiting(msg.data.totalWaiting);
            }
          }
        } catch (err) {
          console.error('WS message error:', err);
        }
      };
    } catch (err) {
      console.error('WS connection error:', err);
    }

    return () => {
      if (ws) ws.close();
    };
  }, [userId]);

  // 3. Countdown timer for holds
  useEffect(() => {
    if (selectedSeatIds.length === 0) return;

    const interval = setInterval(() => {
      setHoldTimer((prev) => {
        if (prev <= 1) {
          // Hold expired
          setSelectedSeatIds([]);
          loadSeats();
          return 600;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [selectedSeatIds]);

  // Handle Seat Click (Atomic Redis Lock)
  const handleSeatClick = async (seat: SeatDto) => {
    if (seat.status === 'SOLD') return;

    // If already held by current user -> release
    if (seat.status === 'HELD' && seat.heldByUserId === userId) {
      try {
        await fetch(`${API_BASE}/api/seats/${seat.id}/release`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, eventId: EVENT_ID }),
        });
        setSelectedSeatIds((prev) => prev.filter((id) => id !== seat.id));
      } catch (err) {
        console.error('Failed to release hold:', err);
      }
      return;
    }

    // If held by someone else -> cannot click
    if (seat.status === 'HELD') return;

    // Acquire atomic hold via Redis SET NX EX
    try {
      const res = await fetch(`${API_BASE}/api/seats/${seat.id}/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: EVENT_ID,
          userId,
          ttlSeconds: 600,
        }),
      });

      if (res.ok) {
        setSelectedSeatIds((prev) => [...prev, seat.id]);
        setHoldTimer(600);
      } else if (res.status === 409) {
        alert('Contention conflict: Another user held this seat first!');
      }
    } catch (err) {
      console.error('Failed to acquire hold:', err);
    }
  };

  // Idempotent Checkout
  const handleCheckout = async () => {
    if (selectedSeatIds.length === 0) return;

    const idempotencyKey = `idemp-${userId}-${Date.now()}`;
    try {
      const res = await fetch(`${API_BASE}/api/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: EVENT_ID,
          userId,
          seatIds: selectedSeatIds,
          idempotencyKey,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setOrderReceipt(data);
        setSelectedSeatIds([]);
      } else {
        const err = await res.json();
        alert(`Checkout error: ${err.message || err.error}`);
      }
    } catch (err) {
      console.error('Checkout failed:', err);
    }
  };

  // Trigger Concurrency Stress Test
  const handleRunStressTest = async () => {
    setStressTesting(true);
    setStressResults(null);
    try {
      const targetSeatId = `${EVENT_ID}-A-1`;
      // Release target seat first
      await fetch(`${API_BASE}/api/seats/${targetSeatId}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'cleaner', force: true }),
      });

      const startTime = Date.now();
      const promises: Promise<Response>[] = [];
      const VUS = 100;

      for (let i = 0; i < VUS; i++) {
        const uId = `stress-bot-${i + 1}`;
        promises.push(
          fetch(`${API_BASE}/api/seats/${targetSeatId}/hold`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              eventId: EVENT_ID,
              seatId: targetSeatId,
              userId: uId,
            }),
          })
        );
      }

      const responses = await Promise.all(promises);
      const duration = Date.now() - startTime;

      let successCount = 0;
      let conflictCount = 0;
      let errorCount = 0;

      for (const r of responses) {
        if (r.status === 200) successCount++;
        else if (r.status === 409) conflictCount++;
        else errorCount++;
      }

      setStressResults({
        totalRequests: VUS,
        durationMs: duration,
        successCount,
        conflictCount,
        errorCount,
        targetSeatId,
      });

      loadSeats();
    } catch (err) {
      console.error('Stress test failed:', err);
    } finally {
      setStressTesting(false);
    }
  };

  // Waiting Room Simulation Controls
  const enterWaitingRoom = async () => {
    setIsAdmitted(false);
    setInQueue(true);
    try {
      const res = await fetch(`${API_BASE}/api/queue/enter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: EVENT_ID, userId }),
      });
      if (res.ok) {
        const data = await res.json();
        setQueueRank(data.rank);
        setTotalWaiting(data.totalWaiting);
      }
    } catch (err) {
      console.error('Enter queue error:', err);
    }
  };

  const bypassQueue = () => {
    setIsAdmitted(true);
    setInQueue(false);
  };

  // Compute metrics
  const availableCount = seats.filter((s) => s.status === 'AVAILABLE').length;
  const heldCount = seats.filter((s) => s.status === 'HELD').length;
  const soldCount = seats.filter((s) => s.status === 'SOLD').length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-50 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-indigo-600 flex items-center justify-center font-black text-white shadow-lg shadow-indigo-500/25">
            QF
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-lg tracking-tight text-white">QueueForge</h1>
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                v1.0 Production
              </span>
            </div>
            <p className="text-xs text-slate-400">Distributed Waiting Room & High-Concurrency Reservation Engine</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
              }`}
            />
            <span className="text-slate-300 font-medium">
              {wsConnected ? 'WebSockets Live' : 'Reconnecting...'}
            </span>
          </div>

          <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700 text-xs">
            <span className="text-slate-400">Actor:</span>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="bg-transparent font-mono text-indigo-300 focus:outline-none w-28 text-xs font-semibold"
            />
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-6 space-y-6">
        {/* Banner Bar */}
        <div className="bg-gradient-to-r from-indigo-950/60 via-slate-900 to-indigo-950/60 border border-indigo-500/20 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4 shadow-xl">
          <div>
            <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold uppercase tracking-wider">
              <Zap className="h-4 w-4" /> Live Event Flash Sale
            </div>
            <h2 className="text-xl font-bold text-white mt-0.5">Coldplay: Music of the Spheres World Tour 2026</h2>
            <p className="text-xs text-slate-400">Wembley Arena &bull; London &bull; 500 Interactive Tiered Seats</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleRunStressTest}
              disabled={stressTesting}
              className="flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 active:scale-95 transition-all text-white shadow-lg shadow-rose-600/25 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              {stressTesting ? 'Running 100 VUs...' : 'Simulate 100 VU Contention Test'}
            </button>

            {!isAdmitted ? (
              <button
                onClick={bypassQueue}
                className="text-xs font-semibold px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-all"
              >
                Bypass Waiting Room
              </button>
            ) : (
              <button
                onClick={enterWaitingRoom}
                className="text-xs font-semibold px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-all"
              >
                Simulate Waiting Room
              </button>
            )}
          </div>
        </div>

        {/* Stress Test Results Panel */}
        {stressResults && (
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 space-y-3 animate-in fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                <CheckCircle className="h-4 w-4" /> Concurrency Verification Proof
              </div>
              <span className="text-xs text-slate-400 font-mono">Contested Seat: {stressResults.targetSeatId}</span>
            </div>
            <div className="grid grid-cols-4 gap-3 text-center">
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <div className="text-xs text-slate-400">Simulated Attacks</div>
                <div className="text-lg font-bold text-white font-mono">{stressResults.totalRequests}</div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <div className="text-xs text-slate-400">Granted Hold (200)</div>
                <div className="text-lg font-bold text-emerald-400 font-mono">
                  {stressResults.successCount} <span className="text-xs font-normal">({stressResults.successCount === 1 ? 'Zero Double-Booking' : 'Race!'})</span>
                </div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <div className="text-xs text-slate-400">Shielded Clashes (409)</div>
                <div className="text-lg font-bold text-amber-400 font-mono">{stressResults.conflictCount}</div>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <div className="text-xs text-slate-400">Execution Speed</div>
                <div className="text-lg font-bold text-indigo-400 font-mono">{stressResults.durationMs}ms</div>
              </div>
            </div>
          </div>
        )}

        {/* Waiting Room Modal (If not admitted) */}
        {!isAdmitted && (
          <div className="bg-slate-900 border border-indigo-500/30 rounded-2xl p-8 max-w-xl mx-auto text-center space-y-5 shadow-2xl">
            <div className="h-16 w-16 mx-auto rounded-full bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Clock className="h-8 w-8 animate-spin" />
            </div>
            <div>
              <h3 className="text-2xl font-bold text-white">You Are in the Virtual Waiting Room</h3>
              <p className="text-sm text-slate-400 mt-1">
                High traffic volume detected. We are metering admission to protect system stability.
              </p>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-slate-400">Your Queue Position</div>
                <div className="text-3xl font-extrabold text-indigo-400 font-mono">#{queueRank || 1}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Total In Queue</div>
                <div className="text-3xl font-extrabold text-slate-200 font-mono">{totalWaiting || 1}</div>
              </div>
            </div>

            <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
              <div
                className="bg-indigo-500 h-full transition-all duration-500"
                style={{ width: `${Math.max(10, 100 - (queueRank / (totalWaiting || 1)) * 100)}%` }}
              />
            </div>

            <p className="text-xs text-slate-500">
              Do not refresh this page. Your position is preserved in Redis Sorted Sets.
            </p>

            <button
              onClick={bypassQueue}
              className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm transition-all shadow-lg shadow-indigo-600/30"
            >
              Admit Now (Dev Bypass)
            </button>
          </div>
        )}

        {/* Seat Grid View (When Admitted) */}
        {isAdmitted && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Seating Grid Canvas */}
            <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-5 shadow-lg">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-base text-white">Interactive Venue Seating Map</h3>
                  <p className="text-xs text-slate-400">Click any available seat to acquire an atomic 10-minute hold.</p>
                </div>

                {/* Legend */}
                <div className="flex items-center gap-4 text-xs font-semibold">
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full bg-emerald-500" />
                    <span className="text-slate-300">Available ({availableCount})</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full bg-amber-500" />
                    <span className="text-slate-300">Held ({heldCount})</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full bg-indigo-500" />
                    <span className="text-slate-300">Your Hold</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full bg-rose-600" />
                    <span className="text-slate-300">Sold ({soldCount})</span>
                  </div>
                </div>
              </div>

              {/* Stage Banner */}
              <div className="w-full bg-slate-800/80 border border-slate-700 py-2 rounded-lg text-center text-xs font-bold text-slate-300 tracking-widest uppercase">
                &bull; &bull; &bull; MAIN STAGE &bull; &bull; &bull;
              </div>

              {/* 500-Seat SVG Grid */}
              <div className="overflow-x-auto bg-slate-950 p-4 rounded-xl border border-slate-800/80">
                <div className="min-w-[650px] space-y-2">
                  {loadingSeats ? (
                    <div className="text-center py-16 text-slate-500 text-sm">
                      Connecting to PostgreSQL & Redis engine...
                    </div>
                  ) : (
                    // Group seats by row
                    Array.from(new Set(seats.map((s) => s.row))).map((row) => (
                      <div key={row} className="flex items-center gap-1.5">
                        <div className="w-6 text-center font-mono text-xs font-bold text-slate-500">{row}</div>
                        <div className="flex items-center gap-1 flex-1">
                          {seats
                            .filter((s) => s.row === row)
                            .map((seat) => {
                              const isMyHold =
                                seat.status === 'HELD' &&
                                (seat.heldByUserId === userId || selectedSeatIds.includes(seat.id));
                              const isOtherHold = seat.status === 'HELD' && !isMyHold;
                              const isSold = seat.status === 'SOLD';
                              const isAvailable = seat.status === 'AVAILABLE';

                              let bgClass = 'bg-emerald-500/80 hover:bg-emerald-400 text-white cursor-pointer';
                              if (isMyHold) {
                                bgClass = 'bg-indigo-600 text-white ring-2 ring-indigo-400 animate-pulse cursor-pointer';
                              } else if (isOtherHold) {
                                bgClass = 'bg-amber-500/80 text-black cursor-not-allowed';
                              } else if (isSold) {
                                bgClass = 'bg-rose-950/70 text-rose-500 cursor-not-allowed border border-rose-900/50';
                              }

                              return (
                                <button
                                  key={seat.id}
                                  onClick={() => handleSeatClick(seat)}
                                  disabled={isSold || isOtherHold}
                                  title={`Seat ${seat.row}-${seat.number} (${seat.section}) - $${seat.priceCents / 100}`}
                                  className={`h-5 w-5 rounded-[4px] text-[8px] font-bold font-mono flex items-center justify-center transition-all ${bgClass}`}
                                >
                                  {seat.number}
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Tier 1: VIP Platinum (A-E)</span>
                <span>Tier 2: Floor Reserved (F-M)</span>
                <span>Tier 3: Balcony Standard (N-T)</span>
              </div>
            </div>

            {/* Sidebar Cart & Checkout */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between shadow-lg">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="font-bold text-base text-white">Your Cart</h3>
                  <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
                    {selectedSeatIds.length} Held
                  </span>
                </div>

                {selectedSeatIds.length > 0 && (
                  <div className="bg-indigo-950/40 border border-indigo-500/30 p-3 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold">
                      <Clock className="h-4 w-4" /> Hold Expiration:
                    </div>
                    <div className="font-mono text-sm font-bold text-indigo-300">
                      {Math.floor(holdTimer / 60)}:{(holdTimer % 60).toString().padStart(2, '0')}
                    </div>
                  </div>
                )}

                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {selectedSeatIds.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 text-xs">
                      No seats selected. Click any green seat on the map to hold.
                    </div>
                  ) : (
                    selectedSeatIds.map((id) => {
                      const seat = seats.find((s) => s.id === id);
                      if (!seat) return null;
                      return (
                        <div
                          key={id}
                          className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between text-xs"
                        >
                          <div>
                            <div className="font-bold text-white">
                              Seat {seat.row}-{seat.number}
                            </div>
                            <div className="text-[10px] text-slate-400">{seat.section}</div>
                          </div>
                          <div className="font-mono font-bold text-indigo-400">${seat.priceCents / 100}</div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="space-y-3 pt-4 border-t border-slate-800">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-400">Total Price:</span>
                  <span className="font-mono font-bold text-white text-lg">
                    $
                    {selectedSeatIds.reduce((sum, id) => {
                      const s = seats.find((seat) => seat.id === id);
                      return sum + (s ? s.priceCents / 100 : 0);
                    }, 0)}
                  </span>
                </div>

                <button
                  onClick={handleCheckout}
                  disabled={selectedSeatIds.length === 0}
                  className="w-full py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed font-bold text-sm text-white transition-all shadow-lg shadow-emerald-600/25"
                >
                  Confirm Instant Checkout
                </button>

                {orderReceipt && (
                  <div className="bg-emerald-950/40 border border-emerald-500/30 p-3 rounded-lg text-xs space-y-1 animate-in fade-in">
                    <div className="font-bold text-emerald-400 flex items-center gap-1">
                      <CheckCircle className="h-3.5 w-3.5" /> Order Completed!
                    </div>
                    <div className="text-[10px] text-slate-300 font-mono break-all">ID: {orderReceipt.orderId}</div>
                    <div className="text-[10px] text-slate-400">Total: ${orderReceipt.totalAmountCents / 100}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-900/40 py-4 px-6 text-center text-xs text-slate-500">
        QueueForge System Engine &bull; Built with Fastify, Redis Sorted Sets, Distributed Locks & PostgreSQL ACID Transactions
      </footer>
    </div>
  );
}
