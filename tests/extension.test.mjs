import test from 'node:test';
import assert from 'node:assert/strict';
import { act, advance, newGame, restore, view } from '../engine.mjs';

const start=1700000000000;
function use(s,action) {
  assert.ok(action?.enabled,action?.reason || 'action unavailable');
  const result=act(s,action.type,action.id,s.last);
  assert.ok(result.ok,result.message);
}
const item=(s,group,id)=>view(s)[group].find(option=>option.id===id);

test('all 30 stations offer complete routes and orders; regional systems and the final circuit work', () => {
  let s=newGame(start);
  s.stock={coal:2e7,steel:2e6,tickets:20000};
  s.upgrades.boiler=6;
  s.freights.river=3;
  const nextBoiler=item(s,'upgrades','boiler');
  assert.match(nextBoiler.action.reason,/曙光总站/);
  assert.equal(nextBoiler.max,15);
  assert.equal(view(s).stations.length,30);
  assert.equal(view(s).regions.length,10);
  assert.equal(view(s).contracts.filter(contract=>contract.kind==='station').length,30);
  while(!view(s).finished) {
    const n=s.stops;
    const ready=view(s);
    assert.equal(ready.leg.circuit,false);
    assert.ok(ready.routes.every(route=>Object.values(route.netPerMinute).every(Number.isFinite)));
    if(n===12) {
      use(s,item(s,'upgrades','boiler').action);
      use(s,item(s,'freights','river').action);
    }
    if(n===13) {
      use(s,item(s,'cars','dry').action);
      use(s,item(s,'freights','islands').action);
    }
    if(n===19) {
      const price=ready.railworks.repair.cost;
      use(s,item(s,'cars','service').action);
      assert.equal(view(s).railworks.repair.cost,Math.ceil(price*.85));
    }
    if(n===21) use(s,item(s,'freights','river').action);
    if(n===25) {
      const duration=ready.leg.total;
      use(s,item(s,'cars','relay').action);
      assert.ok(view(s).leg.total<duration);
    }
    if(n===28) use(s,item(s,'freights','stars').action);
    use(s,view(s).actions.depart);
    if(n>=12) {
      const job=view(s).operations.actions.find(a=>a.enabled);
      assert.ok(!job.label.includes('undefined'));
      use(s,job);
      advance(s,s.last+Math.ceil(s.trip.total*250));
      const signal=view(s).contracts.find(c=>c.kind==='signal'&&c.id.endsWith('-supply'));
      use(s,signal.action);
      s=restore(JSON.stringify(s),s.last);
      use(s,view(s).operations.actions.find(a=>a.id.endsWith('-steel')));
    }
    advance(s,s.last+Math.round(s.trip.left*1000));
    assert.equal(s.stops,n+1);
    assert.ok(view(s).contracts.find(c=>c.id==='station-'+n).action.enabled);
  }
  assert.equal(s.stops,30);
  assert.equal(view(s).station.name,'星港枢纽');
  assert.equal(view(s).leg.loop,'星港环运');
  assert.equal(view(s).slots,5);
  assert.equal(s.upgrades.boiler,7);
  assert.equal(s.freights.river,5);
  use(s,view(s).actions.depart);
  const atTerminal=restore(JSON.stringify(s),s.last+Math.round(s.trip.left*1000));
  assert.equal(atTerminal.stops,30);
  assert.equal(view(atTerminal).railworks.circuits,1);
  assert.ok(view(atTerminal).actions.depart.enabled);
});
