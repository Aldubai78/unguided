/**
 * timerAudio tests — assert the windup SEQUENCE (not the sound).
 *
 * Under Node there is no AudioContext / speechSynthesis, so beep()/sayTenSeconds()
 * are no-ops; what we verify is that windup drives onNumber in the exact order
 * 10,9,8,7,6,5,4,3,2,1,0, fires onDone exactly once after onNumber(0), and that
 * cancel() stops it early. We inject a fake scheduler (setScheduler) so this runs
 * instantly instead of waiting ~10s of wall-clock time.
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { windup, setScheduler, type WindupHandle } from "../src/timerAudio.js";

/** A tiny fake clock: collect scheduled (fn, ms); flush advances them in order. */
function fakeClock() {
  const queue: { fn: () => void; ms: number }[] = [];
  let nextId = 1;
  const ids = new Map<number, number>(); // id -> index in queue
  const schedule = (fn: () => void, ms: number) => {
    const id = nextId++;
    ids.set(id, queue.length);
    queue.push({ fn, ms });
    return id as any;
  };
  const unschedule = (id: any) => {
    const idx = ids.get(id);
    if (idx === undefined) return;
    queue[idx] = { fn: () => {}, ms: 0 }; // mark dead
    ids.delete(id);
  };
  // Run all currently-scheduled callbacks (and any they schedule) to quiescence.
  const flush = (maxSteps = 1000) => {
    let steps = 0;
    while (queue.length > 0 && steps < maxSteps) {
      const { fn } = queue.shift() as { fn: () => void };
      steps++;
      fn();
    }
    return steps;
  };
  return { schedule, unschedule, flush };
}

afterEach(() => setScheduler(null));

test("windup drives onNumber 10..0 in order, then onDone once", () => {
  const seen: number[] = [];
  let done = 0;
  const { schedule, unschedule, flush } = fakeClock();
  setScheduler(schedule, unschedule);
  const h = windup((n) => seen.push(n), () => done++);
  // Immediately: onNumber(10) fired synchronously.
  assert.deepEqual(seen, [10], "10 fires synchronously");
  assert.equal(done, 0, "not done yet");
  flush();
  assert.deepEqual(seen, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0], "full 10..0 sequence");
  assert.equal(done, 1, "onDone fired exactly once");
  h.cancel(); // idempotent after completion
});

test("windup cancel() stops it early and never calls onDone", () => {
  const seen: number[] = [];
  let done = 0;
  const { schedule, unschedule, flush } = fakeClock();
  setScheduler(schedule, unschedule);
  const h = windup((n) => seen.push(n), () => done++);
  assert.deepEqual(seen, [10]);
  h.cancel();
  // Flushing after cancel must produce no further onNumber and no onDone.
  flush();
  assert.deepEqual(seen, [10], "only 10 fired before cancel");
  assert.equal(done, 0, "onDone never fired after cancel");
});

test("windup is re-entrant: a second windup after the first completes works", () => {
  const order: string[] = [];
  const { schedule, unschedule, flush } = fakeClock();
  setScheduler(schedule, unschedule);
  const a = windup((n) => order.push(`a${n}`), () => order.push("aDone"));
  flush();
  const b = windup((n) => order.push(`b${n}`), () => order.push("bDone"));
  flush();
  assert.ok(order.indexOf("a10") < order.indexOf("aDone"), "a completes in order");
  assert.ok(order.indexOf("b10") > order.indexOf("aDone"), "b starts after a done");
  const tail = order.slice(-2);
  assert.deepEqual(tail, ["b0", "bDone"], "b ends at 0 then done");
  a.cancel();
  b.cancel();
});
