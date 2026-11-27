import { STOPS } from './data.mjs?v=2'

const maxLevel=3
const nozzlePercent=level=>8*level
const rackPercent=level=>15*level
const repairPercent=level=>8+4*level
const projects=[
  {id:'nozzle',name:'节煤喷嘴',description:'安装后，下次发车就能少备一部分燃煤。两条路线均适用。',effect:level=>level?'发车耗煤 −'+nozzlePercent(level)+'%':'标准耗煤'},
  {id:'rack',name:'快卸货架',description:'安装后，下次发车的基础运票报酬提高。备件托运按本站报价另行结算。',effect:level=>level?'到站基础运票 +'+rackPercent(level)+'%':'标准运费'},
  {id:'arm',name:'检修机臂',description:'安装后立即增强行车快修，可用于本程尚未执行的快修。',effect:level=>'快修抵扣全程 '+repairPercent(level)+'%'},
]
// Each station posts a fixed parts contract. Switching tracks never changes the agreed fare.
const stationFares=[4,4,6,13,20,26,34,41,47,66,75,86]
const invested=levels=>projects.reduce((sum,{id})=>sum+levels[id]*(levels[id]+1)/2,0)

export function newRailworks() {
  return {levels:{nozzle:0,rack:0,arm:0},cargo:null,repairUsed:false,circuits:0}
}

export function restoreRailworks(raw,stops,moving,blueprints) {
  function fail(){throw new Error('铁路工务存档无效。')}
  if(!raw || typeof raw!=='object' || !raw.levels || typeof raw.repairUsed!=='boolean' || (raw.repairUsed && !moving)) fail()
  if(!Number.isSafeInteger(raw.circuits) || raw.circuits<0 || (stops<STOPS.length && raw.circuits!==0)) fail()
  const levels={}
  for(const {id} of projects) {
    const level=raw.levels[id]
    if(!Number.isInteger(level) || level<0 || level>maxLevel) fail()
    levels[id]=level
  }
  if(invested(levels)>blueprints) fail()
  const cargo=raw.cargo
  if(cargo!==null && (!cargo || typeof cargo!=='object' || cargo.stop!==stops || !Number.isSafeInteger(cargo.tickets) || cargo.tickets<=0 || cargo.tickets>1e6)) fail()
  return {levels,cargo:cargo && {stop:cargo.stop,tickets:cargo.tickets},repairUsed:raw.repairUsed,circuits:raw.circuits}
}

export function applyRailProjects(railworks,price,award) {
  // Apply designs after both route quotes have been composed, before the trip is booked.
  const savings={coal:Math.round(price.coal*nozzlePercent(railworks.levels.nozzle)/100),tickets:Math.round(award.tickets*rackPercent(railworks.levels.rack)/100)}
  price.coal-=savings.coal
  award.tickets+=savings.tickets
  return savings
}

export function savedSeconds(trip,fraction) {
  return Math.min(Math.round(trip.total*fraction*1000)/1000,trip.left)
}

function action(id,label,reason) {
  return {type:'railworks',id,label,enabled:!reason,reason}
}

export function railworksView(s) {
  const {parts,blueprints}=s.workshop
  const {levels,cargo,repairUsed}=s.railworks
  const available=blueprints-invested(levels)
  const offers=projects.map(p=>{
    const level=levels[p.id],full=level>=maxLevel,cost=full?0:level+1
    const reason=full?'已达最高等级':available<cost?'还需 '+(cost-available)+' 张可用蓝图':''
    return {id:p.id,name:p.name,description:p.description,level,max:maxLevel,cost,effect:p.effect(level),nextEffect:full?null:p.effect(level+1),
      action:action(p.id,full?'已完成':level?'升级':'安装',reason)}
  })
  const circuit=s.stops===STOPS.length
  const index=circuit?8:s.stops
  const cargoCost=40*3**index,repairCost=60*3**index
  const baseFare=circuit?19:stationFares[index]
  const circuitPremium=circuit?Math.max(0,blueprints-18):0
  const cargoFare=cargo?.tickets??(baseFare+circuitPremium)
  const lacking=cost=>parts>=cost?'':'还需 '+Math.ceil(cost-parts)+' 机件'
  const cargoReason=cargo?'本程已装运':lacking(cargoCost)
  const repairReason=!s.trip?'发车后可快修':repairUsed?'本程已快修':lacking(repairCost)
  const percent=repairPercent(levels.arm)
  return {parts,blueprints,available,circuits:s.railworks.circuits,projects:offers,
    cargo:{cost:cargoCost,tickets:cargoFare,blueprintPremium:circuit?cargoFare-baseFare:0,loaded:!!cargo,action:action('cargo',cargo?'已装运':'装运备件',cargoReason)},
    repair:{cost:repairCost,percent,saved:s.trip?savedSeconds(s.trip,percent/100):0,used:repairUsed,action:action('repair',repairUsed?'已快修':'行车快修',repairReason)}}
}

export function runRailwork(s,id) {
  const board=railworksView(s)
  const item=id==='repair'?board.repair:id==='cargo'?board.cargo:board.projects.find(o=>o.id===id)
  if(!item?.action.enabled) return {ok:false,message:item?.action.reason || '未知铁路工务操作。'}
  if(id==='cargo') {
    s.workshop.parts-=item.cost
    s.railworks.cargo={stop:s.stops,tickets:item.tickets}
    return {ok:true,message:'已装运 '+item.cost+' 机件，抵达'+(STOPS[s.stops]??STOPS.at(-1)).name+'后额外获得 '+item.tickets+' 运票。'}
  }
  if(id==='repair') {
    s.workshop.parts-=item.cost
    s.railworks.repairUsed=true
    return {ok:true,saved:item.saved,message:'快修消耗 '+item.cost+' 机件，本程缩短 '+item.saved+' 秒。'}
  }
  s.railworks.levels[id]++
  return {ok:true,message:'投入 '+item.cost+' 张蓝图，'+item.name+'已升至 '+(item.level+1)+' 级。'+item.nextEffect+'。'}
}
