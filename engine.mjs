import { REGIONS, DEPOT, STOPS, GOODS, UPG, CARS, LINES, INCIDENTS } from './data.mjs'

const goods = Object.keys(GOODS)
const zeros = () => ({coal:0,steel:0,tickets:0})
const fromArray = ([coal,steel,tickets]) => ({coal,steel,tickets})
const station = s => STOPS[s.stops-1] || DEPOT
const target = s => STOPS[s.stops] || STOPS.at(-1)
const equipped = (s,id) => s.cars.includes(id)
const slots = s => s.stops>=6 ? 3 : 2
const complete = s => s.stops===STOPS.length
const HOUR = 3600000
const phases = [.23,.51,.77]

export function newGame(now=Date.now()) {
  return {
    version:1,last:now,elapsed:0,stock:{coal:18,steel:6,tickets:0},stops:0,track:'fast',trip:null,
    upgrades:Object.fromEntries(UPG.map(x=>[x.id,0])),cars:['tender'],
    freights:Object.fromEntries(LINES.map(x=>[x.id,0])),orders:[],lastStoke:now-650,
    log:[{time:now,text:'余烬机务段重新开炉。凑齐出发物资，让第一班列车开往煤灰小站。',kind:'info'}],
    offline:null,
  }
}

function addLog(s,kind,text,time=s.last) {
  s.log.unshift({time,text,kind})
  s.log=s.log.slice(0,48)
}
function credit(s,amount,mult=1) {
  for(const k of goods) s.stock[k]=Math.max(0,s.stock[k]+amount[k]*mult)
}
function levelsCost(base,level) {
  return fromArray(base.map(v=>Math.ceil(v*Math.pow(1.65,level))))
}
function costText(amount) {
  return goods.filter(k=>amount[k]>0).map(k=>Math.ceil(amount[k])+' '+GOODS[k]).join(' · ')
}
function missing(s,cost) {
  const short=Object.fromEntries(goods.map(k=>[k,Math.max(0,cost[k]-s.stock[k])]))
  return goods.some(k=>short[k]>0) ? '还需 '+costText(short) : ''
}
function orderCount(s,category) {
  return s.orders.filter(index=>index%3===category).length
}
function rates(s) {
  const u=s.upgrades
  const r={coal:(.19+.12*u.shovel)*(equipped(s,'tender')?1.3:1),steel:(.083+.055*u.mill)*(equipped(s,'shop')?1.35:1),tickets:s.stops>=2?.009:0}
  if (equipped(s,'heater')) r.steel*=1.1
  if(s.trip && target(s).regionIndex===2 && !equipped(s,'heater')) r.steel*=.7
  if(s.trip && equipped(s,'mail')) r.tickets+=.05
  for(const line of LINES) {
    const level=s.freights[line.id]
    if(level) goods.forEach((k,i)=>{r[k]+=line.rate[i]*level*(1+.15*u.yard)})
  }
  r.coal*=1+.05*orderCount(s,0)
  r.steel*=1+.05*orderCount(s,1)
  return r
}
function travelTerms(s,track) {
  const stop=target(s)
  const haul=track==='haul'
  const price=fromArray([Math.ceil(stop.coal*(haul?.85:1)),Math.ceil(stop.steel*(haul?.85:1)),0])
  const traction=equipped(s,'traction')?(stop.regionIndex===1?.15:.05):0
  const speed=1+.035*s.upgrades.boiler+traction+.0125*orderCount(s,2)
  const total=Math.round(stop.min*60*(haul?1.13:1)/speed)
  const cargo=(haul?1.85:1)*(equipped(s,'cargo')?1.45:1)
  const award=fromArray([Math.round((11+stop.index*7)*cargo),Math.round((5+stop.index*2.5)*cargo),Math.round((7+stop.index*2)*cargo*(stop.regionIndex===3?1.25:1))])
  return {price,total,award}
}
function arrive(s,time) {
  const arrived=target(s)
  credit(s,s.trip.award)
  const received=costText(s.trip.award)
  s.stops++
  s.trip=null
  s.track='fast'
  addLog(s,'arrival',complete(s)?'曙光灯塔亮起，全线十二座车站恢复通车。终点交付 '+received+'。':'抵达'+arrived.name+'，交付货运获得 '+received+'。',time)
}

export function advance(s,now=Date.now()) {
  if(!Number.isFinite(now) || now<=s.last) return s
  let dt=Math.min(now-s.last,8*HOUR)/1000
  s.elapsed+=dt
  if(s.trip) {
    const moving=Math.min(dt,s.trip.left)
    credit(s,rates(s),moving)
    s.trip.left-=moving
    dt-=moving
    if(s.trip.left<=0) arrive(s,s.last+moving*1000)
  }
  if(dt>0) credit(s,rates(s),dt)
  s.last=now
  return s
}

function button(type,id,label,reason='') {
  return {type,id,label,enabled:!reason,reason}
}
function gate(s,from) {
  return s.stops<from ? '抵达'+STOPS[from-1].name+'后开放' : ''
}
function availableSignal(s) {
  if(!s.trip) return false
  const n=s.trip.signals
  return n<phases.length && (1-s.trip.left/s.trip.total)>=phases[n]
}
function stationOrder(s,stop) {
  const id='station-'+stop.index
  const done=s.orders.includes(stop.index)
  const from=stop.index+1
  // Later stations commission permanent works large enough to absorb expanded freight output.
  const scale=[1,1.5,2.3,4,6.5,10,15,22,32,46,65,92][stop.index]
  const cost=fromArray([Math.round(25*scale),Math.round(9*scale),0])
  const reward=10+stop.index*3
  const benefit=['全线产煤 +5%','全线产钢 +5%','运行速度 +1.25%'][stop.index%3]
  return {id,kind:'station',name:stop.order,description:stop.task,station:stop.name,info:costText(cost)+' → '+reward+' 运票 · '+benefit,
    benefit,reward,cost,unlocked:s.stops>=from,completed:done,action:button('contract',id,done?'已交付':'交付物资',done?'委托已完成':gate(s,from)||missing(s,cost))}
}
function signals(s) {
  if(!availableSignal(s)) return []
  const stop=target(s)
  const [name,description,supply,skip,load,timeFactor]=INCIDENTS[stop.regionIndex][s.trip.signals]
  const saved=Math.min(Math.ceil(s.trip.total*timeFactor),Math.floor(s.trip.left*.5))
  const award=fromArray([8+stop.index*3,4+stop.index,2+stop.regionIndex].map((v,i)=>Math.ceil(v*load[i])))
  return ['supply','skip'].map((option,i)=>{
    const id='signal-'+stop.index+'-'+s.trip.signals+'-'+option
    return {id,kind:'signal',name:name+' · '+(i?skip:supply),description,station:stop.name,unlocked:true,completed:false,cost:zeros(),saved,award,
      info:i?'优先放行，节约 '+saved+' 秒':'立即获得 '+costText(award),action:button('contract',id,i?skip:supply,i && saved===0?'列车即将到站':'')}
  })
}
function makeView(s) {
  const stop=target(s)
  const done=complete(s)
  const moving=!!s.trip
  const current=station(s)
  const region=REGIONS[stop.regionIndex]
  const routes=['fast','haul'].map(id=>{
    const fast=id==='fast'
    const name=fast?stop.fast:stop.haul
    const {price,total,award}=travelTerms(s,id)
    const selected=s.track===id
    return {id,name,description:fast?'正线优先通车，运行时间较短。':'沿途收货，出发物资较省，到站报酬更高。',info:Math.ceil(total/60)+' 分钟 · 物资 '+costText(price)+' · 报酬 '+costText(award),
      selected,cost:price,total,award,action:button('route',id,selected?'已选择':'选择路线',done?'全线已通车':moving?'列车运行中':selected?'已选择此线':'')}
  })
  const route=routes.find(r=>r.selected)
  const canDepartReason=done?'全线已通车':moving?'正在前往'+stop.name:missing(s,route.cost)
  const depart=button('depart',null,done?'全线通车':moving?'列车运行中':'发车',canDepartReason)
  const stoke=button('stoke',null,'手动添煤',s.last-s.lastStoke<650?'正在装煤':'')
  const upgrades=UPG.map(u=>{
    const level=s.upgrades[u.id],cost=levelsCost(u.base,level),maxed=level>=u.max
    const nextLevelGate=level>=5?9:level>=4?6:level>=2?3:0
    return {...u,level,cost,unlocked:s.stops>=u.from,info:maxed?'已完全升级':costText(cost),
      action:button('upgrade',u.id,maxed?'已满级':'升级',maxed?'已经满级':gate(s,Math.max(nextLevelGate,u.from))||missing(s,cost))}
  })
  const cars=CARS.map(car=>{
    const fitted=equipped(s,car.id)
    return {...car,equipped:fitted,unlocked:s.stops>=car.from,info:gate(s,car.from)||(fitted?'编组中':'待编组'),action:button('car',car.id,fitted?'卸下':'编入',
      gate(s,car.from)||(moving?'到站后可更换编组':!fitted && s.cars.length>=slots(s)?'请先卸下一节车厢':''))}
  })
  const freights=LINES.map(line=>{
    const level=s.freights[line.id],max=3,cost=levelsCost(line.base,level)
    return {...line,level,max,unlocked:s.stops>=line.from,cost,info:(level<max?costText(cost)+' · ':'')+goods.map((k,i)=>'+'+(line.rate[i]*60*(1+s.upgrades.yard*.15)).toFixed(1)+' '+GOODS[k]).join(' / ')+' 每分每级',
      action:button('freight',line.id,level===max?'满负荷':level?'扩充运力':'开通货运',level===max?'货运线已满级':gate(s,line.from)||missing(s,cost))}
  })
  const signalList=signals(s)
  const contracts=[...signalList,...STOPS.map(x=>stationOrder(s,x))]
  const objective=done?{title:'点亮曙光灯塔',description:'全线通车。你仍可交付余下委托、扩建自动货运。',action:depart}:
    moving?(signalList.length?{title:'沿途调度 · '+signalList[0].name.split(' · ')[0],description:signalList[0].description+'可在货运页选择补给或优先通行。',action:signalList[0].action}:
      {title:'开往'+stop.name,description:'列车运行中，车站物资产线继续工作。',action:depart}):
    {title:'开往'+stop.name,description:'备齐 '+costText(route.cost)+'，沿'+route.name+'发车。',action:depart}
  const total=s.trip?.total??route.total
  const left=s.trip?.left??(done?0:total)
  const progress=done?1:moving?1-left/total:0
  const distance=moving?current.km+(stop.km-current.km)*progress:current.km
  return {resources:{...s.stock},rates:rates(s),region,station:current,regions:REGIONS,stations:STOPS.map(x=>({...x,status:x.index===s.stops-1?'current':x.index<s.stops?'done':x.index===s.stops?'next':'locked'})),
    leg:{index:stop.index,name:route.name,description:stop.description,progress,remaining:left,total,destination:stop.name,traveling:moving,ready:depart.enabled,route:s.track,stopsDone:s.stops,cost:route.cost,award:s.trip?.award??route.award},
    objective,actions:{stoke,depart},upgrades,cars,freights,routes,contracts,log:s.log,finished:done,elapsed:s.elapsed,slots:slots(s),distance,offline:s.offline,stokeAmount:2+s.upgrades.shovel}
}
export const view=makeView

export function act(s,type,id=null,now=Date.now()) {
  advance(s,now)
  const v=view(s)
  const actionLists={upgrade:v.upgrades,car:v.cars,freight:v.freights,route:v.routes,contract:v.contracts}
  const item=Object.hasOwn(actionLists,type)?actionLists[type].find(x=>x.id===id):null
  const a=item?.action??(Object.hasOwn(v.actions,type)?v.actions[type]:null)
  if(!a?.enabled) return {ok:false,message:a?.reason || '未知操作'}
  let message=''
  if(type==='stoke') {
    s.stock.coal+=v.stokeAmount
    s.lastStoke=s.last
    return {ok:true,message:'添煤 +'+v.stokeAmount}
  }
  if(type==='depart') {
    const {total,award,price}=travelTerms(s,s.track)
    credit(s,price,-1)
    s.trip={total,left:total,award,signals:0}
    message='列车沿'+v.leg.name+'出发，下一站 '+v.leg.destination+'。'
  } else if(type==='route') {
    s.track=id
    message='已切换至'+item.name+'。'
  } else if(type==='car') {
    s.cars=item.equipped?s.cars.filter(x=>x!==id):[...s.cars,id]
    message=item.name+(item.equipped?'已卸下。':'已编入列车。')
  } else if(type==='upgrade' || type==='freight') {
    credit(s,item.cost,-1)
    if(type==='upgrade') s.upgrades[id]++
    else s.freights[id]++
    message=item.name+'升至 '+(item.level+1)+' 级。'
    if(type==='upgrade' && id==='boiler' && s.trip) message+='新速度从下一程生效。'
  } else if(type==='contract' && item.kind==='station') {
    credit(s,item.cost,-1)
    s.stock.tickets+=item.reward
    s.orders.push(Number(id.slice(8)))
    message='完成「'+item.name+'」，获得 '+item.reward+' 运票，'+item.benefit+'。'
  } else if(type==='contract') {
    if(id.endsWith('skip')) s.trip.left-=item.saved
    else credit(s,item.award)
    s.trip.signals++
    message=item.action.label+' · '+item.info+'。'
  }
  addLog(s,type==='depart'?'dispatch':type==='contract'?'contract':type==='route'?'info':'upgrade',message)
  return {ok:true,message}
}


const finite = (x,min=0,max=1e15) => Number.isFinite(x) && x>=min && x<=max
const int = (x,min,max) => Number.isInteger(x) && x>=min && x<=max
const record = x => !!x && typeof x==='object' && !Array.isArray(x)
const validStock = x => record(x) && goods.every(k=>finite(x[k]))
function validLevels(x,list,maxFor) {
  return record(x) && list.every(def=>int(x[def.id],0,maxFor(def)))
}
function cleanLog(log) {
  if(!Array.isArray(log)) return []
  const kinds=['info','dispatch','arrival','upgrade','contract']
  return log.slice(0,48).filter(l=>record(l)&&finite(l.time,0,9e15)&&typeof l.text==='string').map(l=>({
    time:l.time,kind:kinds.includes(l.kind)?l.kind:'info',text:l.text.slice(0,300).replace(/[<>&]/g,''),
  }))
}
export function restore(raw,now=Date.now()) {
  const x=typeof raw==='string'?JSON.parse(raw):raw
  const fail=()=>{throw new Error('存档格式无效或版本不受支持。')}
  if(!record(x)||x.version!==1||!int(x.stops,0,STOPS.length)||!finite(x.last,0,9e15)||!finite(x.elapsed)||!validStock(x.stock)||!['fast','haul'].includes(x.track)) fail()
  if(!validLevels(x.upgrades,UPG,d=>d.max)||!validLevels(x.freights,LINES,()=>3)) fail()
  if(!Array.isArray(x.cars)||x.cars.length>slots(x)||new Set(x.cars).size!==x.cars.length||!x.cars.every(id=>CARS.some(c=>c.id===id && c.from<=x.stops))) fail()
  if(!Array.isArray(x.orders)||x.orders.length>STOPS.length||new Set(x.orders).size!==x.orders.length||!x.orders.every(i=>int(i,0,x.stops-1))) fail()
  const t=x.trip
  if(t!==null && (complete(x)||!record(t)||!finite(t.total,1,86400)||!finite(t.left,0,t.total)||!int(t.signals,0,3)||!validStock(t.award))) fail()
  const s=newGame(now)
  Object.assign(s,{last:Math.min(x.last,now),elapsed:x.elapsed,stops:x.stops,track:x.track,cars:[...x.cars],orders:[...x.orders],log:cleanLog(x.log),lastStoke:Math.min(now,finite(x.lastStoke,-1e12,9e15)?x.lastStoke:0)})
  for(const k of goods) s.stock[k]=x.stock[k]
  for(const u of UPG) s.upgrades[u.id]=x.upgrades[u.id]
  for(const f of LINES) s.freights[f.id]=x.freights[f.id]
  if(t) s.trip={total:t.total,left:t.left,signals:t.signals,award:fromArray(goods.map(k=>t.award[k]))}
  const dt=Math.max(0,Math.min(now-s.last,8*HOUR))/1000
  const before={...s.stock}
  advance(s,now)
  if(dt>=60) s.offline={seconds:dt,...Object.fromEntries(goods.map(k=>[k,s.stock[k]-before[k]]))}
  return s
}
