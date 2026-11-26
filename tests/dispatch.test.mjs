import test from 'node:test';
import assert from 'node:assert/strict';
import { act, advance, newGame, restore, view } from '../engine.mjs';

const start = 1_700_000_000_000;
function depart() {
  const s = newGame(start);
  advance(s, start + 60_000);
  assert.ok(act(s, 'depart', null, s.last).ok);
  return s;
}

test('partial automatic shovel cycles survive reload and cannot be collected twice manually', () => {
  const auto = newGame(start);
  advance(auto, start + 649);
  const resumed = restore(JSON.stringify(auto), auto.last);
  const manual = restore(JSON.stringify(auto), auto.last);
  act(manual, 'toggleStoke', null, manual.last);
  advance(resumed, start + 650);
  advance(manual, start + 650);
  const amount = view(auto).autoStoke.amount;
  assert.ok(Math.abs(resumed.stock.coal - manual.stock.coal - amount) < 1e-8);
  assert.equal(act(resumed, 'stoke', null, resumed.last).ok, false);
  assert.ok(act(manual, 'stoke', null, manual.last).ok);
  assert.ok(Math.abs(resumed.stock.coal - manual.stock.coal) < 1e-8);
});

test('migrating an old save keeps its booked trip and converts coal exactly once', () => {
  const v1 = {
    version:1, last:start, elapsed:52, stops:0, track:'haul',
    stock:{coal:31,steel:5,tickets:2}, cars:['tender'], orders:[], log:[],
    upgrades:{shovel:1,mill:0,boiler:0,yard:0},
    freights:{river:0,ridge:0,snow:0,coast:0},
    trip:{total:136,left:63.3,signals:1,award:{coal:20,steel:9,tickets:13}},
  };
  const migrated = restore(v1, start);
  const resumed = restore(JSON.stringify(migrated), start);
  assert.equal(resumed.stock.coal, 31 * 24);
  assert.equal(resumed.trip.left, 63.3);
  assert.deepEqual(resumed.trip.award, v1.trip.award);
  advance(resumed, start + 63_300);
  assert.equal(resumed.stops, 1);
  assert.equal(resumed.stock.tickets, 15);
});

test('optional priority charges once and a late signal can finish the trip immediately', () => {
  const s = depart();
  s.stock.tickets = 100;
  const { cost, saved } = view(s).priorityPass;
  const original = s.trip.total;
  assert.equal(saved, original * 0.08);
  assert.ok(act(s, 'priority', null, s.last).ok);
  assert.equal(s.stock.tickets, 100 - cost.tickets);
  const reloaded = restore(JSON.stringify(s), s.last);
  assert.equal(act(reloaded, 'priority', null, reloaded.last).ok, false);
  advance(s, s.last + s.trip.left * 1000 - 500);
  const signal = view(s).contracts.find(c => c.id.endsWith('-skip'));
  assert.equal(signal.saved, 0.5);
  assert.ok(act(s, 'contract', signal.id, s.last).ok);
  assert.equal(s.stops, 1);
  assert.equal(s.trip, null);
});

test('a job can be settled after arrival, and reloading cannot repeat its reward', () => {
  const s = depart();
  const offer = view(s).operations.actions.find(a => a.enabled);
  assert.ok(act(s, 'operation', offer.id, s.last).ok);
  advance(s, s.last + 180_000);
  const resumed = restore(JSON.stringify(s), s.last);
  const board = view(resumed).operations;
  assert.ok(board.readyToCollect);
  const payout = board.actions.find(a => a.gain.tickets > 0);
  const before = resumed.stock.tickets;
  assert.ok(act(resumed, 'operation', payout.id, resumed.last).ok);
  assert.equal(resumed.stock.tickets, before + payout.gain.tickets);
  assert.equal(act(resumed, 'operation', payout.id, resumed.last).ok, false);
});
