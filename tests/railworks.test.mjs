import test from 'node:test';
import assert from 'node:assert/strict';
import { act, advance, newGame, restore, view } from '../engine.mjs';

const start = 1_700_000_000_000;
const hour = 3_600_000;

function use(s, type, id = null) {
  const result = act(s, type, id, s.last);
  assert.ok(result.ok, result.message);
}

function reject(s, id) {
  const before = JSON.stringify(s);
  assert.equal(act(s, 'railworks', id, s.last).ok, false);
  assert.equal(JSON.stringify(s), before, 'Rejected action must not charge or alter the save');
}

function reload(s, time = s.last) {
  return restore(JSON.stringify(s), time);
}

const rail = s => view(s).railworks;
const project = (s, id) => rail(s).projects.find(p => p.id === id);

function close(actual, expected, tolerance = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' differs from ' + expected);
}

// Captured from the published v3 engine after earning seven blueprints, departing,
// and accepting an in-transit job. The original log is omitted.
function v3Save() {
  const machines = {lathe:0, assembly:0, line:0};
  return {
    version:3, last:1_700_029_407_700, elapsed:29_407.7,
    workshop:{parts:54.735, earned:42.735, lifetime:1_434_352_238.93519, owned:{...machines},
      purchased:{...machines}, blueprints:7, generation:2, bestLathe:1},
    stock:{coal:380322.05475999997, steel:2439.5101550000004, tickets:0}, stops:0, track:'fast',
    trip:{total:104, left:96.3, award:{coal:34, steel:12, tickets:9},
      price:{coal:120, steel:8, tickets:0}, speedBonus:15, signals:0, priorityUsed:false},
    upgrades:{shovel:0, mill:0, boiler:0, yard:0}, cars:['tender'],
    freights:{river:0, ridge:0, snow:0, coast:0}, orders:[], shovelAuto:true, shovelCycleMs:400,
    ops:{serial:1, job:{kind:0, stop:0, startedAt:29400, due:29434, checked:null, crew:false}},
    log:[], offline:null,
  };
}

test('station-loaded parts are charged once, survive switching routes and pay on arrival offline', () => {
  const s = newGame(start);
  for (const id of ['cargo', 'repair', 'nozzle', 'unknown']) reject(s, id);
  advance(s, s.last + 180_000);
  const tickets = s.stock.tickets;
  const unladen = view(s).routes;
  const quote = rail(s).cargo;
  const stock = s.workshop.parts;
  assert.ok(quote.cost > 0 && quote.tickets > 0);
  use(s, 'railworks', 'cargo');
  close(s.workshop.parts, stock - quote.cost);
  assert.equal(s.stock.tickets, tickets);
  assert.ok(rail(s).cargo.loaded);
  reject(s, 'cargo');

  const ready = reload(s);
  use(ready, 'route', 'haul');
  const base = unladen.find(route => route.id === 'haul');
  const quotedTickets = base.award.tickets + quote.tickets;
  assert.equal(view(ready).leg.award.tickets, quotedTickets);
  const fuel = ready.stock.coal;
  use(ready, 'depart');
  close(ready.stock.coal, fuel - base.cost.coal);
  assert.equal(view(ready).leg.award.tickets, quotedTickets);
  reject(ready, 'cargo');

  const due = ready.last + ready.trip.left * 1000;
  const arrived = reload(ready, due + 60_000);
  const stale = reload(ready);
  assert.equal(act(stale, 'railworks', 'cargo', due).ok, false);
  assert.equal(rail(stale).cargo.loaded, false);
  assert.equal(stale.workshop.parts, reload(ready, due).workshop.parts);

  assert.equal(arrived.stops, 1);
  assert.equal(arrived.stock.tickets, tickets + quotedTickets);
  assert.equal(arrived.offline.tickets, quotedTickets);
  assert.equal(rail(arrived).cargo.loaded, false);
  assert.equal(reload(arrived).stock.tickets, arrived.stock.tickets);
});

test('v3 blueprints immediately fund real projects without losing booked fares, jobs or passive perks', () => {
  const old = v3Save();
  const s = reload(old);
  const baseline = view(s);
  assert.equal(s.version, 4);
  assert.deepEqual(s.workshop, old.workshop);
  assert.deepEqual(s.stock, old.stock);
  assert.equal(rail(s).available, 7);
  assert.ok(rail(s).projects.every(p => p.level === 0));
  for (const id of ['rack', 'nozzle', 'arm']) {
    assert.equal(project(s, id).cost, 1);
    use(s, 'railworks', id);
  }
  assert.equal(rail(s).available, 4);
  assert.equal(rail(s).blueprints, 7);
  assert.equal(s.workshop.blueprints, 7);
  assert.equal(rail(s).repair.percent, 12);
  const improved = view(s);
  assert.deepEqual(improved.rates, baseline.rates);
  assert.equal(improved.workshop.multiplier, baseline.workshop.multiplier);
  assert.deepEqual(s.trip, old.trip);
  assert.deepEqual(s.ops, old.ops);
  assert.deepEqual(improved.leg.cost, old.trip.price);
  assert.deepEqual(improved.leg.award, old.trip.award);

  const plain = reload(old, old.last + old.trip.left * 1000);
  const next = reload(s, s.last + s.trip.left * 1000);
  assert.equal(next.stock.tickets, old.trip.award.tickets);
  for (const route of view(plain).routes) {
    const modified = view(next).routes.find(r => r.id === route.id);
    assert.equal(modified.savings.coal, route.cost.coal - modified.cost.coal);
    assert.equal(modified.savings.tickets, modified.award.tickets - route.award.tickets);
    assert.ok(modified.cost.coal < route.cost.coal);
    assert.ok(modified.award.tickets > route.award.tickets);
    close(modified.cost.coal, route.cost.coal * 0.92, 1);
    close(modified.award.tickets, route.award.tickets * 1.15, 1);
    assert.equal(modified.total, route.total);
  }
  const unit = rail(next).cargo;
  const booked = view(next).leg;
  const before = {...next.stock};
  use(next, 'depart');
  close(next.stock.coal, before.coal - booked.cost.coal);
  use(next, 'railworks', 'cargo');
  assert.equal(view(next).leg.award.tickets, booked.award.tickets + unit.tickets);
  const atStation = reload(next, next.last + next.trip.left * 1000);
  assert.equal(atStation.stock.tickets, before.tickets + booked.award.tickets + unit.tickets);
});

test('repairs deduct the quote and skip the booked percentage once; a late repair settles cargo immediately', () => {
  const s = newGame(start);
  advance(s, s.last + 5 * 60_000);
  use(s, 'depart');
  advance(s, s.last + 30_000);
  const first = rail(s).repair;
  const before = {left:s.trip.left, parts:s.workshop.parts};
  assert.equal(first.percent, 8);
  close(first.saved, s.trip.total * 0.08);
  use(s, 'railworks', 'repair');
  close(s.workshop.parts, before.parts - first.cost);
  close(s.trip.left, before.left - first.saved);
  const resumed = reload(s);
  assert.ok(rail(resumed).repair.used);
  reject(resumed, 'repair');

  const old = v3Save();
  const late = reload(old, old.last + old.trip.left * 1000 - 500);
  use(late, 'railworks', 'arm');
  use(late, 'railworks', 'cargo');
  const quote = rail(late).repair;
  assert.equal(quote.percent, 12);
  assert.equal(quote.saved, 0.5);
  const fare = view(late).leg.award.tickets;
  const stock = late.workshop.parts;
  use(late, 'railworks', 'repair');
  close(late.workshop.parts, stock - quote.cost);
  assert.equal(late.trip, null);
  assert.equal(late.stops, 1);
  assert.equal(late.stock.tickets, old.stock.tickets + fare);
  assert.equal(rail(late).cargo.loaded, false);
  reject(late, 'repair');
  assert.equal(reload(late).stock.tickets, late.stock.tickets);
});

test('blueprint spending is bounded, permanent through prestige, and independent of the workshop threshold', () => {
  const s = reload(v3Save());
  const before = view(s).workshop.prestige.threshold;
  for (const cost of [1, 2, 3]) {
    assert.equal(project(s, 'nozzle').cost, cost);
    use(s, 'railworks', 'nozzle');
  }
  assert.equal(project(s, 'nozzle').level, 3);
  assert.equal(rail(s).available, 1);
  reject(s, 'nozzle');
  use(s, 'railworks', 'rack');
  assert.equal(rail(s).available, 0);
  reject(s, 'arm');
  assert.equal(view(s).workshop.prestige.threshold, before);

  use(s, 'workshop', 'buy:lathe:1');
  advance(s, s.last + hour);
  use(s, 'workshop', 'buy:assembly:1');
  advance(s, s.last + 8 * hour);
  use(s, 'railworks', 'cargo');
  const tickets = rail(s).cargo.tickets;
  const gain = view(s).workshop.prestige.gain;
  assert.ok(gain > 0);
  use(s, 'workshop', 'prestige');
  const continued = reload(s);
  assert.equal(rail(continued).available, gain);
  assert.equal(rail(continued).blueprints, 7 + gain);
  assert.equal(project(continued, 'nozzle').level, 3);
  assert.equal(project(continued, 'rack').level, 1);
  assert.equal(rail(continued).cargo.loaded, true);
  assert.equal(rail(continued).cargo.tickets, tickets);
  reject(continued, 'cargo');
});

test('mainline arrivals and the twelfth-station crate pay once and open circuit service', () => {
  const s = newGame(start);
  while (!view(s).finished) {
    advance(s, s.last + 8 * hour);
    if (s.stops === 0) {
      use(s, 'workshop', 'buy:lathe:1');
      use(s, 'workshop', 'buy:assembly:1');
    }
    const final = s.stops === view(s).stations.length - 1;
    if (final) use(s, 'railworks', 'cargo');
    use(s, 'depart');
    const fare = view(s).leg.award.tickets;
    const expected = s.stock.tickets + view(s).rates.tickets * s.trip.left + fare;
    advance(s, s.last + s.trip.left * 1000);
    close(s.stock.tickets, expected);
  }
  assert.equal(rail(s).cargo.loaded, false);
  assert.equal(rail(s).circuits, 0);
  assert.equal(view(s).leg.circuit, true);
  assert.ok(rail(s).cargo.action.enabled);
  reject(s, 'repair');
});

test('a finished v3 railway can book repeat circuits; arrival pays once and keeps all 12 stations', () => {
  // Terminal save values from v3, with the common fleet and order defaults above.
  const old = v3Save();
  Object.assign(old, {
    last:1_700_055_700_000, elapsed:55700, stops:12, trip:null, shovelCycleMs:200,
    stock:{coal:624308.7999999999, steel:4360.460000000001, tickets:1830.52},
    ops:{serial:0, job:null},
    workshop:{parts:81345957673.1125, earned:81345958523.1125, lifetime:81345958523.1125,
      owned:{lathe:49399.18951070304, assembly:1, line:0}, purchased:{lathe:1, assembly:1, line:0},
      blueprints:0, generation:1, bestLathe:1},
  });
  const s = reload(old);
  assert.ok(view(s).finished);
  assert.equal(rail(s).circuits, 0);
  assert.ok(view(s).leg.circuit);
  assert.equal(view(s).leg.total, 360);
  use(s, 'railworks', 'cargo');
  const ready = reload(s);
  use(ready, 'route', 'haul');
  const route = view(ready).leg;
  const coalBefore = ready.stock.coal;
  use(ready, 'depart');
  close(ready.stock.coal, coalBefore - route.cost.coal);
  use(ready, 'railworks', 'repair');
  const returning = reload(ready);
  assert.ok(view(returning).finished && view(returning).leg.traveling);
  reject(returning, 'repair');
  reject(returning, 'cargo');

  const due = returning.trip.left;
  const expected = returning.stock.tickets + view(returning).rates.tickets * due + route.award.tickets;
  const home = reload(returning, returning.last + Math.round(due * 1000));
  assert.ok(view(home).finished);
  assert.equal(home.stops, 12);
  assert.equal(home.trip, null);
  assert.equal(rail(home).circuits, 1);
  close(home.stock.tickets, expected);
  const again = reload(home);
  assert.equal(rail(again).circuits, 1);
  assert.equal(again.stock.tickets, home.stock.tickets);
  assert.equal(rail(again).cargo.loaded, false);
  use(again, 'depart');
  use(again, 'railworks', 'cargo');
  advance(again, again.last + again.trip.left * 1000);
  assert.equal(again.stops, 12);
  assert.equal(rail(again).circuits, 2);
});

test('surplus blueprints increase repeat freight fares, with each paid crate locked to its loading quote', () => {
  const old = v3Save();
  Object.assign(old, {stops:12, trip:null});
  Object.assign(old.workshop, {blueprints:19, parts:1e6, earned:1e9, lifetime:2e9});
  const s = reload(old);
  const quote = rail(s).cargo;
  assert.equal(quote.blueprintPremium, 1);
  assert.equal(quote.tickets, 20);
  use(s, 'railworks', 'cargo');
  use(s, 'workshop', 'prestige');
  assert.ok(s.workshop.blueprints > 19);
  assert.equal(rail(s).cargo.tickets, 20);
  assert.equal(rail(s).cargo.blueprintPremium, 1);
  use(s, 'depart');
  const totalFare = view(s).leg.award.tickets;
  const expected = s.stock.tickets + totalFare + view(s).rates.tickets * s.trip.total;
  const home = reload(s, s.last + s.trip.total * 1000);
  close(home.stock.tickets, expected);
  assert.equal(rail(home).cargo.tickets, 19 + s.workshop.blueprints - 18);
});
