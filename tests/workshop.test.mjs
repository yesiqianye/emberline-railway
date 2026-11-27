import test from 'node:test';
import assert from 'node:assert/strict';
import { act, advance, newGame, restore, view } from '../engine.mjs';

const start = 1_700_000_000_000;
const hour = 3_600_000;
const stock = (coal, steel, tickets) => ({coal, steel, tickets});

// An in-transit v2 save with a running mail job, recorded using the published v2 engine.
function oldSave() {
  return {
    version:2, last:start + 76_500, elapsed:76.5, stops:0, track:'fast',
    stock:stock(787.204, 4.349500000000001, 0),
    trip:{total:120, left:103.5, award:stock(34,12,9), price:stock(120,8,0),
      speedBonus:0, signals:0, priorityUsed:false},
    upgrades:{shovel:0, mill:0, boiler:0, yard:0}, cars:['tender'],
    freights:{river:0, ridge:0, snow:0, coast:0}, orders:[],
    shovelAuto:true, shovelCycleMs:450,
    ops:{serial:1, job:{kind:0, stop:0, startedAt:75, due:109, checked:null, crew:false}},
    log:[], offline:null,
  };
}

function similar(a, b, name) {
  const error = Math.abs(a-b);
  assert.ok(Number.isFinite(a) && Number.isFinite(b) && error <= Math.max(1e-8, 1e-9*Math.abs(b)),
    name + ': ' + a + ' vs ' + b);
}

function action(s, button) {
  assert.ok(button?.enabled, button?.reason || 'action unavailable');
  const result = act(s, button.type, button.id, s.last);
  assert.ok(result.ok, result.message);
}

function workshop(s) { return view(s).workshop; }

test('v2 migration retains the booked train and job; workshop starts at migration time', () => {
  const old = oldSave();
  const restored = restore(JSON.stringify(old), old.last);
  assert.equal(restored.version, 4);
  assert.deepEqual(restored.stock, old.stock);
  assert.deepEqual(restored.trip, old.trip);
  assert.deepEqual(restored.ops, old.ops);
  assert.equal(restored.shovelCycleMs, old.shovelCycleMs);
  assert.deepEqual(restored.workshop, newGame(old.last).workshop);

  const time = old.last + 12*hour;
  const late = restore(JSON.stringify(old), time);
  assert.equal(late.stops, 1);
  assert.equal(late.trip, null);
  assert.equal(late.offline.seconds, 8*3600);
  assert.ok(view(late).operations.readyToCollect);
  assert.deepEqual(late.workshop, newGame(time).workshop);
  const reread = restore(JSON.stringify(late), time);
  assert.deepEqual(reread.workshop, late.workshop);
  assert.deepEqual(reread.stock, late.stock);
});

test('v1 migration converts coal exactly once and initializes the same fresh workshop', () => {
  const v1 = {
    version:1, last:start, elapsed:52, stops:0, track:'haul',
    stock:stock(31,5,2), cars:['tender'], orders:[], log:[],
    upgrades:{shovel:1,mill:0,boiler:0,yard:0},
    freights:{river:0,ridge:0,snow:0,coast:0},
    trip:{total:136,left:63.3,signals:1,award:stock(20,9,13)},
  };
  const first = restore(v1, start);
  const again = restore(JSON.stringify(first), start);
  assert.equal(first.version, 4);
  assert.deepEqual(again.stock, stock(31*24,5,2));
  assert.deepEqual(again.trip.award, v1.trip.award);
  assert.equal(again.trip.left, v1.trip.left);
  assert.deepEqual(first.workshop, newGame(start).workshop);
  assert.deepEqual(again.workshop, first.workshop);
});

function tier(s, id) {
  return workshop(s).tiers.find(machine => machine.id === id);
}

function buyWhenReady(s, id, batch='1') {
  for (let attempts=0; attempts<240; attempts++) {
    const button=tier(s,id).actions[batch];
    if (button.enabled) {
      action(s,button);
      return;
    }
    advance(s,s.last+60_000);
  }
  assert.fail('Failed to buy '+id+' ×'+batch+' after four production hours');
}

function installChain(s) {
  for (const id of ['lathe','assembly','line']) buyWhenReady(s,id);
}

function compareWorkshop(a,b) {
  const left=workshop(a);
  const right=workshop(b);
  for (const name of ['parts','earned','lifetime','perSecond','generation','blueprints','multiplier','railMultiplier']) {
    similar(left[name],right[name],name);
  }
  for (const machine of left.tiers) {
    const other=tier(b,machine.id);
    similar(machine.owned,other.owned,machine.id+' machines');
    assert.equal(machine.purchased,other.purchased);
  }
}

test('batch quotes buy exactly the affordable machines at the successive single-unit prices', () => {
  const s=newGame(start);
  buyWhenReady(s,'lathe');
  for (let minutes=0; minutes<240 && !tier(s,'lathe').actions['10'].enabled; minutes++) {
    advance(s,s.last+60_000);
  }
  assert.ok(tier(s,'lathe').actions['10'].enabled,'ten purchases attainable');
  for (const batch of ['10','max']) {
    const many=restore(JSON.stringify(s),s.last);
    const single=restore(JSON.stringify(s),s.last);
    const before=tier(many,'lathe').purchased;
    const budget=workshop(many).parts;
    const quote=tier(many,'lathe').actions[batch];
    action(many,quote);
    const count=tier(many,'lathe').purchased-before;
    assert.equal(quote.quantity,count);
    similar(budget-workshop(many).parts,quote.cost,'charged quoted '+batch+' price');
    if(batch==='10') assert.equal(count,10);
    else assert.ok(count>=10);
    let cost=0;
    for (let n=0;n<count;n++) {
      cost+=tier(single,'lathe').unitCost;
      action(single,tier(single,'lathe').actions['1']);
    }
    similar(workshop(many).parts,budget-cost,'total price '+batch);
    compareWorkshop(many,single);
    if(batch==='max') assert.equal(tier(many,'lathe').actions['1'].enabled,false);
  }
});

test('higher machines generate lower machines, and earned machines do not raise purchase prices', () => {
  const s=newGame(start);
  installChain(s);
  const purchased=workshop(s).tiers.map(t=>t.purchased);
  const prices=workshop(s).tiers.map(t=>t.unitCost);
  const previous=Object.fromEntries(workshop(s).tiers.map(t=>[t.id,t.owned]));
  const earned=workshop(s).earned;
  advance(s,s.last+300_000);
  assert.ok(tier(s,'lathe').owned>previous.lathe);
  assert.ok(tier(s,'assembly').owned>previous.assembly);
  assert.equal(tier(s,'line').owned,previous.line);
  assert.ok(workshop(s).earned>earned);
  assert.deepEqual(workshop(s).tiers.map(t=>t.purchased),purchased);
  assert.deepEqual(workshop(s).tiers.map(t=>t.unitCost),prices);
  compareWorkshop(restore(JSON.stringify(s),s.last),s);
});

test('eight-hour offline production across arrival equals small online steps through the same station', () => {
  const s=newGame(start);
  installChain(s);
  action(s,view(s).actions.depart);
  const saved=JSON.stringify(s);
  const online=restore(saved,s.last);
  const end=s.last+8*hour;
  for(let t=s.last+53_111;t<end;t+=53_111) advance(online,t);
  advance(online,end);
  const capped=restore(saved,end+5*hour);
  assert.equal(capped.stops,1);
  assert.equal(capped.trip,null);
  assert.equal(capped.offline.seconds,8*3600);
  compareWorkshop(capped,online);
  for(const key of Object.keys(online.stock)) similar(capped.stock[key],online.stock[key],key);
  const again=restore(JSON.stringify(capped),capped.last);
  compareWorkshop(capped,again);
  assert.deepEqual(again.stock,capped.stock);
});

test('prestige preserves railway progress, pays once, and applies capped bonuses to future trips', () => {
  const s=newGame(start);
  // Budget this test's eight-hour windows through production, including the machine unlocks.
  installChain(s);
  advance(s,s.last+8*hour);
  action(s,tier(s,'lathe').actions.max);
  advance(s,s.last+8*hour);

  const initial=newGame(start);
  const baseRoute=view(initial).leg;
  const noShopRates=view(initial).rates;
  const before=workshop(s);
  assert.ok(before.prestige.enabled);
  action(s,view(s).actions.depart);
  const job=view(s).operations.actions.find(button=>button.enabled);
  action(s,job);
  advance(s,s.last+3_311);
  const booked=structuredClone(s.trip);
  const ongoingJob=structuredClone(s.ops);
  const stockBefore={...s.stock},railCycle=s.shovelCycleMs;
  const expected=workshop(s).prestige.gain;
  const lifetime=workshop(s).lifetime;
  action(s,workshop(s).prestige);
  assert.deepEqual(s.trip,booked);
  assert.deepEqual(s.ops,ongoingJob);
  assert.deepEqual(s.stock,stockBefore);
  assert.equal(s.shovelCycleMs,railCycle);
  assert.equal(s.stops,0);
  const w=workshop(s);
  assert.equal(w.blueprints,before.blueprints+expected);
  assert.equal(w.generation,before.generation+1);
  assert.equal(w.earned,0);
  similar(w.lifetime,lifetime,'lifetime production survives prestige');
  assert.deepEqual(w.tiers.map(t=>t.purchased),workshop(initial).tiers.map(t=>t.purchased));
  assert.equal(act(s,'workshop',w.prestige.id,s.last).ok,false);
  assert.equal(workshop(s).blueprints,w.blueprints);
  compareWorkshop(restore(JSON.stringify(s),s.last),s);

  assert.ok(before.bestLathe>=25 && w.blueprints>=10, 'fixture reaches both resource bonus caps');
  assert.equal(w.bestLathe,before.bestLathe);
  assert.equal(w.railMultiplier,3);
  assert.equal(w.trainSpeedPercent,15);
  const upgraded=view(s);
  similar(upgraded.rates.steel,noShopRates.steel*w.railMultiplier,'rail steel bonus');
  similar(upgraded.rates.tickets,noShopRates.tickets,'unchanged ticket flow');
  assert.ok(Math.abs(upgraded.autoStoke.amount-view(initial).autoStoke.amount*w.railMultiplier)<0.0011);
  assert.equal(upgraded.leg.total,booked.total);
  const future=upgraded.routes.find(r=>!r.selected);
  const baseline=view(initial).routes.find(r=>r.id===future.id);
  const etaCap=Math.min(15,w.blueprints*2.5);
  similar(future.speedBonus-baseline.speedBonus,etaCap,'future speed percentage');
  assert.ok(future.total<baseline.total);
  assert.equal(baseRoute.total,booked.total);
});
