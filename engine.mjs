import { newOperations, restoreOperations, operationsView, runOperation } from './operations.mjs?v=2'
import { REGIONS, DEPOT, STOPS, GOODS, ROUTE_FUEL, ROUTE_VALUE, UPG, CARS, LINES, INCIDENTS } from './data.mjs?v=2'

const goods = Object.keys(GOODS)
const zeros = () => ({coal:0,steel:0,tickets:0})
const fromArray = ([coal,steel,tickets]) => ({coal,steel,tickets})
const station = s => STOPS[s.stops-1] || DEPOT
const target = s => STOPS[s.stops] || STOPS.at(-1)
const equipped = (s,id) => s.cars.includes(id)
const slots = s => s.stops>=6 ? 3 : 2
const complete = s => s.stops===STOPS.length
const HOUR = 3600000
const SHOVEL_MS = 650
const LEGACY_COAL_SCALE = 24
const HAUL_TIME = 1.22
const phases = [.23,.51,.77]

export function newGame(now=Date.now()) {
  return {
    version:2,last:now,elapsed:0,stock:{coal:18,steel:6,tickets:0},stops:0,track:'fast',trip:null,
    upgrades:Object.fromEntries(UPG.map(x=>[x.id,0])),cars:['tender'],
    freights:Object.fromEntries(LINES.map(x=>[x.id,0])),orders:[],shovelAuto:true,shovelCycleMs:0,ops:newOperations(),
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
function scoop(s) {
  const base=6+3*s.upgrades.shovel
  const tender=equipped(s,'tender')?1.3:1
  return Math.round(base*tender*(1+.05*orderCount(s,0))*1000)/1000
}
function passiveRates(s) {
  const u=s.upgrades
  const r={coal:(.72+.25*u.shovel)*(equipped(s,'tender')?1.3:1),steel:(.083+.055*u.mill)*(equipped(s,'shop')?1.35:1),tickets:s.stops>=2?.009:0}
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
function basketValue(basket) {
  return goods.reduce((sum,k)=>sum+basket[k]*ROUTE_VALUE[k],0)
}
function travelTerms(s,track) {
  const stop=target(s)
  const traction=equipped(s,'traction')?(stop.regionIndex===1?.15:.05):0
  const speedBonus=.035*s.upgrades.boiler+traction+.0125*orderCount(s,2)
  const directTime=Math.round(stop.min*60/(1+speedBonus))
  const price=fromArray([ROUTE_FUEL[stop.index],stop.steel,0])
  const load=equipped(s,'cargo')?1.45:1
  const coalFreight=Math.round(price.coal*.28)
  const steelFreight=Math.round(7+stop.steel*.65)
  // Freight contracts reimburse the operating budget in a mix of cargo and fare.
  // Maintain a positive margin even for late-region trains with large fuel reserves.
  const fareFloor=Math.ceil((basketValue(price)*1.12-coalFreight-steelFreight*ROUTE_VALUE.steel)/ROUTE_VALUE.tickets)
  const fare=Math.max(9+stop.index*4,fareFloor)*(stop.regionIndex===3?1.25:1)
  const award=fromArray([coalFreight,steelFreight,fare].map(v=>Math.round(v*load)))
  if(track==='fast') return {price,total:directTime,award,speedBonus:speedBonus*100}

  // Both lines earn and consume an equivalent basket per minute at the same loadout.
  // Freight reserves more fuel and less repair steel, pays in bulk goods instead of express fees.
  const total=Math.round(directTime*HAUL_TIME)
  const ratio=total/directTime
  const valueIn=Math.round(basketValue(price)*ratio)
  const valueOut=Math.round(basketValue(award)*ratio)
  price.steel=Math.ceil(price.steel*ratio*.86)
  price.coal=valueIn-ROUTE_VALUE.steel*price.steel
  award.steel=Math.round(award.steel*ratio*1.08)
  award.tickets=Math.max(1,Math.round(award.tickets*ratio*.90))
  award.coal=valueOut-ROUTE_VALUE.steel*award.steel-ROUTE_VALUE.tickets*award.tickets
  return {price,total,award,speedBonus:speedBonus*100}
}

function produce(s,millis) {
  if(millis<=0) return
  credit(s,passiveRates(s),millis/1000)
  const accumulated=s.shovelCycleMs+millis
  if(s.shovelAuto) {
    s.stock.coal+=Math.floor(accumulated/SHOVEL_MS)*scoop(s)
    s.shovelCycleMs=accumulated%SHOVEL_MS
  } else {
    // A player can hold one ready scoop in manual mode, never a queue of missed clicks.
    s.shovelCycleMs=Math.min(SHOVEL_MS,accumulated)
  }
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
  let millis=Math.min(now-s.last,8*HOUR)
  s.elapsed+=millis/1000
  if(s.trip) {
    const leftMs=Math.round(s.trip.left*1000)
    const moving=Math.min(millis,leftMs)
    produce(s,moving)
    s.trip.left=(leftMs-moving)/1000
    millis-=moving
    if(s.trip.left===0) arrive(s,s.last+moving)
  }
  produce(s,millis)
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
  const publicWorksCoal=[600,2400,5500,11000,18000,27500,38000,47500,56000,65000,84000,112000]
  const cost=fromArray([publicWorksCoal[stop.index],Math.round(9*scale),0])
  const reward=10+stop.index*3
  const benefit=['全线产煤 +5%','全线产钢 +5%','运行速度 +1.25%'][stop.index%3]
  return {id,kind:'station',name:stop.order,description:stop.task,station:stop.name,info:costText(cost)+' → '+reward+' 运票 · '+benefit,
    benefit,reward,cost,unlocked:s.stops>=from,completed:done,action:button('contract',id,done?'已交付':'交付物资',done?'委托已完成':gate(s,from)||missing(s,cost))}
}
function savedSeconds(trip,fraction) {
  return Math.min(Math.round(trip.total*fraction*1000)/1000,trip.left)
}
function applyTimeSaving(s,saved) {
  s.trip.left=Math.round((s.trip.left-saved)*1000)/1000
  if(s.trip.left<=0) arrive(s,s.last)
}
function priorityService(s) {
  if(!s.trip) return null
  const {trip}=s
  const cost=fromArray([0,0,Math.max(6,Math.ceil(.65*trip.award.tickets))])
  const saved=savedSeconds(trip,.08)
  const info='支付 '+cost.tickets+' 运票 · 发车时全程的 8% · 本次抵扣 '+saved+' 秒'+(saved===trip.left?'，可立即到站':'')
  const action=button('priority',null,trip.priorityUsed?'本程已购买':'购买优先通行',trip.priorityUsed?'每程限购一次':missing(s,cost))
  return {...action,info,cost,percent:8,saved,used:trip.priorityUsed}
}
function signals(s) {
  if(!availableSignal(s)) return []
  const stop=target(s)
  const [name,description,supply,skip,load,timeFactor]=INCIDENTS[stop.regionIndex][s.trip.signals]
  const percent=Number((timeFactor*100).toFixed(3))
  const saved=savedSeconds(s.trip,timeFactor)
  const award=fromArray([70+stop.index*31,4+stop.index,2+stop.regionIndex].map((v,i)=>Math.ceil(v*load[i])))
  return ['supply','skip'].map((option,i)=>{
    const id='signal-'+stop.index+'-'+s.trip.signals+'-'+option
    return {id,kind:'signal',name:name+' · '+(i?skip:supply),description,station:stop.name,unlocked:true,completed:false,cost:zeros(),saved,percent,award,
      info:i?'按发车时全程的 '+percent+'% 提速，本次抵扣 '+saved+' 秒':'立即获得 '+costText(award),action:button('contract',id,i?skip:supply,i && saved===0?'列车即将到站':'')}
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
    const selected=s.track===id
    const locked=moving && selected
    const {price,total,award,speedBonus}=locked?s.trip:travelTerms(s,id)
    const net=Object.fromEntries(goods.map(k=>[k,award[k]-price[k]]))
    const perMinute=basket=>Object.fromEntries(goods.map(k=>[k,basket[k]*60/total]))
    const netPerMinute=perMinute(net)
    const grossPerMinute=perMinute(award)
    return {id,name,description:fast?'直达正线较快，偏重运票，所需燃煤较少。':'支线约延时 22%，每分钟多耗煤、少用检修钢，偏重实物回报。',info:Math.ceil(total/60)+' 分钟 · 物资 '+costText(price)+' · 报酬 '+costText(award),
      selected,cost:price,total,award,net,netPerMinute,grossPerMinute,netValuePerMinute:basketValue(netPerMinute),speedBonus,locked,action:button('route',id,selected?'已选择':'选择路线',done?'全线已通车':moving?'列车运行中':selected?'已选择此线':'')}
  })
  const route=routes.find(r=>r.selected)
  const canDepartReason=done?'全线已通车':moving?'正在前往'+stop.name:missing(s,route.cost)
  const depart=button('depart',null,done?'全线通车':moving?'列车运行中':'发车',canDepartReason)
  const stoke=button('stoke',null,'手动添煤',s.shovelAuto?'自动添煤运行中':s.shovelCycleMs<SHOVEL_MS?'正在装煤':'')
  const toggleStoke=button('toggleStoke',null,s.shovelAuto?'切换手动':'开启自动')
  const amount=scoop(s)
  const autoStoke={enabled:s.shovelAuto,intervalMs:SHOVEL_MS,amount,perSecond:amount*1000/SHOVEL_MS,perMinute:amount*60000/SHOVEL_MS,cycleMs:s.shovelCycleMs,action:toggleStoke}
  const rates=passiveRates(s)
  if(s.shovelAuto) rates.coal+=autoStoke.perSecond
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
  return {resources:{...s.stock},rates,autoStoke,operations:operationsView(s),priorityPass:priorityService(s),region,station:current,regions:REGIONS,stations:STOPS.map(x=>({...x,status:x.index===s.stops-1?'current':x.index<s.stops?'done':x.index===s.stops?'next':'locked'})),
    leg:{index:stop.index,name:route.name,description:stop.description,progress,remaining:left,total,destination:stop.name,traveling:moving,ready:depart.enabled,route:s.track,stopsDone:s.stops,cost:route.cost,award:s.trip?.award??route.award},
    objective,actions:{stoke,depart,toggleStoke},upgrades,cars,freights,routes,contracts,log:s.log,finished:done,elapsed:s.elapsed,slots:slots(s),distance,offline:s.offline,stokeAmount:amount}
}
export const view=makeView

export function act(s,type,id=null,now=Date.now()) {
  advance(s,now)
  if(type==='operation') {
    const result=runOperation(s,id)
    if(result.ok) addLog(s,'contract',result.message)
    return result
  }
  const v=view(s)
  const actionLists={upgrade:v.upgrades,car:v.cars,freight:v.freights,route:v.routes,contract:v.contracts}
  const item=Object.hasOwn(actionLists,type)?actionLists[type].find(x=>x.id===id):null
  if(type==='priority') {
    const pass=v.priorityPass
    if(!pass?.enabled) return {ok:false,message:pass?.reason || '发车后可购买优先通行。'}
    credit(s,pass.cost,-1)
    s.trip.priorityUsed=true
    addLog(s,'dispatch',pass.info+'。')
    applyTimeSaving(s,pass.saved)
    return {ok:true,message:pass.info+'。'}
  }
  const a=item?.action??(Object.hasOwn(v.actions,type)?v.actions[type]:null)
  if(!a?.enabled) return {ok:false,message:a?.reason || '未知操作'}
  let message=''
  if(type==='stoke') {
    s.stock.coal+=v.stokeAmount
    s.shovelCycleMs=0
    return {ok:true,message:'添煤 +'+v.stokeAmount}
  }
  if(type==='toggleStoke') {
    s.shovelAuto=!s.shovelAuto
    if(s.shovelAuto && s.shovelCycleMs===SHOVEL_MS) {
      // Transfer the single ready stroke to the feeder when returning to automatic control.
      s.stock.coal+=scoop(s)
      s.shovelCycleMs=0
    }
    return {ok:true,message:s.shovelAuto?'已开启自动添煤，每 0.65 秒一铲。':'已切换为手动添煤。'}
  }
  if(type==='depart') {
    const {total,award,price,speedBonus}=travelTerms(s,s.track)
    credit(s,price,-1)
    s.trip={total,left:total,award,price,speedBonus,signals:0,priorityUsed:false}
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
    s.trip.signals++
    if(id.endsWith('skip')) {
      applyTimeSaving(s,item.saved)
    } else credit(s,item.award)
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
  if(!record(x)||![1,2].includes(x.version)||!int(x.stops,0,STOPS.length)||!finite(x.last,0,9e15)||!finite(x.elapsed)||!validStock(x.stock)||!['fast','haul'].includes(x.track)) fail()
  if(!validLevels(x.upgrades,UPG,d=>d.max)||!validLevels(x.freights,LINES,()=>3)) fail()
  if(!Array.isArray(x.cars)||x.cars.length>slots(x)||new Set(x.cars).size!==x.cars.length||!x.cars.every(id=>CARS.some(c=>c.id===id && c.from<=x.stops))) fail()
  if(!Array.isArray(x.orders)||x.orders.length>STOPS.length||new Set(x.orders).size!==x.orders.length||!x.orders.every(i=>int(i,0,x.stops-1))) fail()
  const t=x.trip
  if(t!==null && (complete(x)||!record(t)||!finite(t.total,1,86400)||!finite(t.left,0,t.total)||!int(t.signals,0,3)||!validStock(t.award))) fail()
  const legacy=x.version===1
  if(!legacy && (typeof x.shovelAuto!=='boolean' || !finite(x.shovelCycleMs,0,SHOVEL_MS) || (x.shovelAuto && x.shovelCycleMs===SHOVEL_MS) || !record(x.ops))) fail()
  if(t && !legacy && (!validStock(t.price)||!finite(t.speedBonus,0,200) || (t.priorityUsed!==undefined && typeof t.priorityUsed!=='boolean'))) fail()
  const s=newGame(now)
  Object.assign(s,{last:Math.min(x.last,now),elapsed:x.elapsed,stops:x.stops,track:x.track,cars:[...x.cars],orders:[...x.orders],log:cleanLog(x.log),shovelAuto:legacy?true:x.shovelAuto,shovelCycleMs:legacy?0:x.shovelCycleMs,ops:legacy?newOperations():restoreOperations(x.ops)})
  for(const k of goods) s.stock[k]=x.stock[k]
  for(const u of UPG) s.upgrades[u.id]=x.upgrades[u.id]
  for(const f of LINES) s.freights[f.id]=x.freights[f.id]
  if(legacy) {
    s.stock.coal*=LEGACY_COAL_SCALE
    addLog(s,'info','铁路补给改制：原有煤炭按 1:24 折算，自动添煤已开启。已发车的到站报酬按原约定结算。')
  }
  if(t) {
    const stop=target(s)
    const oldPriceFactor=s.track==='haul'?.85:1
    const price=legacy?fromArray([Math.ceil(stop.coal*oldPriceFactor),Math.ceil(stop.steel*oldPriceFactor),0]):fromArray(goods.map(k=>t.price[k]))
    const oldTime=stop.min*60*(s.track==='haul'?1.13:1)
    const speedBonus=legacy?Math.max(0,(oldTime/t.total-1)*100):t.speedBonus
    s.trip={total:t.total,left:t.left,signals:t.signals,award:fromArray(goods.map(k=>t.award[k])),price,speedBonus,priorityUsed:legacy?false:(t.priorityUsed??false)}
  }
  const dt=Math.max(0,Math.min(now-s.last,8*HOUR))/1000
  const before={...s.stock}
  advance(s,now)
  if(dt>=60) s.offline={seconds:dt,...Object.fromEntries(goods.map(k=>[k,s.stock[k]-before[k]]))}
  return s
}
