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
  const automaticFares = view(resumed).rates.tickets * resumed.trip.left;
  advance(resumed, start + 63_300);
  assert.equal(resumed.stops, 1);
  assert.equal(resumed.stock.tickets, 15 + automaticFares);
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

function supplied(stop) {
  const s=newGame(start);
  s.stops=stop;
  s.stock={coal:50000,steel:500,tickets:500};
  return s;
}

function use(s,action) {
  const result=act(s,action.type,action.id,s.last);
  assert.ok(result.ok,result.message);
}

test('late market prices buy useful departure supplies with one batch per good each docking', () => {
  const s=supplied(11);
  const {market}=view(s).operations;
  const steel=market.find(a=>a.gain.steel>0);
  const coal=market.find(a=>a.gain.coal>0);
  assert.equal(coal.cost.tickets,12);
  assert.equal(steel.cost.tickets,13);
  assert.ok(coal.gain.coal>=view(s).leg.cost.coal/3);
  assert.ok(steel.gain.steel>=view(s).leg.cost.steel/2);
  use(s,coal);
  assert.equal(s.stock.coal,50000+coal.gain.coal);
  assert.equal(s.stock.tickets,500-coal.cost.tickets);
  const resumed=restore(s,s.last);
  assert.equal(act(resumed,'operation',coal.id,resumed.last).ok,false);
  use(resumed,steel);
  assert.equal(resumed.stock.steel,500+steel.gain.steel);
  assert.equal(resumed.stock.tickets,500-coal.cost.tickets-steel.cost.tickets);
  use(resumed,view(resumed).actions.depart);
  assert.equal(view(resumed).operations.market.length,0);
  advance(resumed,resumed.last+resumed.trip.left*1000);
  assert.ok(view(resumed).operations.market.every(a=>a.enabled));
});

test('each signal supply grants one resource and stays within 45 seconds of current automatic output', () => {
  for(const stop of [0,3,6,9,12]) {
    const s=supplied(stop);
    if(stop===3) use(s,view(s).actions.toggleStoke);
    use(s,view(s).actions.depart);
    for(const [i,phase] of [.25,.53,.8].entries()) {
      advance(s,start+Math.ceil(s.trip.total*1000*phase));
      const outlook=view(s);
      const supply=outlook.contracts.find(c=>c.id.endsWith('-supply'));
      const eligible=['coal','steel','tickets'][i];
      assert.deepEqual(Object.keys(supply.award).filter(key=>supply.award[key]>0),[eligible]);
      assert.ok(supply.award[eligible]<=outlook.rates[eligible]*45);
      const before=s.stock[eligible];
      use(s,supply.action);
      assert.equal(s.stock[eligible],before+supply.award[eligible]);
      assert.equal(act(s,'contract',supply.id,s.last).ok,false);
    }
  }
});

test('the on-board shift locks its smaller quote and opens only two jobs per leg', () => {
  const s=supplied(8);
  use(s,view(s).actions.depart);
  const first=view(s).operations.actions[0];
  use(s,first);
  const quote={...s.ops.job.reward};
  const rates=view(s).rates;
  assert.ok(quote.steel<=rates.steel*60);
  assert.ok(quote.tickets<=rates.tickets*64);
  const mill=view(s).upgrades.find(u=>u.id==='mill');
  use(s,mill.action);
  advance(s,s.last+70_000);
  const resumed=restore(s,s.last);
  const collect=view(resumed).operations.actions.find(a=>a.id.endsWith('-steel'));
  assert.equal(collect.gain.steel,quote.steel);
  use(resumed,collect);
  assert.equal(view(resumed).operations.phase,'between');
  assert.equal(view(resumed).operations.actions.length,0);
  advance(resumed,start+Math.ceil(resumed.trip.total*550));
  use(resumed,view(resumed).operations.actions[0]);
  advance(resumed,resumed.last+70_000);
  use(resumed,view(resumed).operations.actions[0]);
  assert.equal(view(restore(resumed,resumed.last)).operations.phase,'closed');
  advance(resumed,resumed.last+resumed.trip.left*1000);
  use(resumed,view(resumed).actions.depart);
  assert.equal(view(resumed).operations.phase,'offer');
});
