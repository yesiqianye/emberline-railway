// Machines accrue continuously. Manual purchases alone advance the price ladder.
const MACHINES = [
  {id:'lathe',name:'车床',output:'机件',description:'将钢坯加工成机件，每台基础产出 1 机件／秒。',rate:1,base:12,growth:1.30},
  {id:'assembly',name:'装配台',output:'车床',description:'连续组装车床，每台基础产出 0.015 车床／秒。',rate:.015,base:850,growth:1.48},
  {id:'line',name:'自动产线',output:'装配台',description:'连续制造装配台，每条基础产出 0.0018 装配台／秒。',rate:.0018,base:65000,growth:1.65},
]
const MILESTONES = [
  [500,1.40,'首批标准件'],[5000,1.50,'连续加工'],[50000,1.60,'精密量规'],
  [500000,1.65,'互换件标准'],[5e6,1.70,'联动生产'],[5e7,1.75,'分厂协作'],
  [5e8,1.80,'整线改造'],[5e9,1.85,'总厂扩建'],[5e10,1.90,'全面电气化'],
].map(([target,multiplier,name])=>({target,multiplier,name}))
const INVENTORY_LIMIT=1e90
const PURCHASE_LIMIT=400
const BLUEPRINT_LIMIT=128
const OFFLINE_LIMIT=8*3600
const partStock=()=>({lathe:0,assembly:0,line:0})
const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max
const finite=(x,min,max)=>Number.isFinite(x)&&x>=min&&x<=max
const stationFactor=stops=>1+.08*Math.max(0,Math.min(12,Number(stops)||0))
const blueprintFactor=blueprints=>1+.65*blueprints
const bounded=(x)=>Math.min(INVENTORY_LIMIT,x)

export function newWorkshop() {
  return {parts:12,earned:0,lifetime:0,owned:partStock(),purchased:partStock(),blueprints:0,generation:1,bestLathe:0}
}
export function restoreWorkshop(raw) {
  if(raw===undefined) return newWorkshop()
  function fail(){throw new Error('工坊存档无效。')}
  if(!raw || typeof raw!=='object' || !raw.owned || !raw.purchased) fail()
  if(!['parts','earned','lifetime'].every(k=>finite(raw[k],0,INVENTORY_LIMIT))) fail()
  if(raw.earned>raw.lifetime || !integer(raw.blueprints,0,BLUEPRINT_LIMIT) || !integer(raw.generation,1,BLUEPRINT_LIMIT+1) || !integer(raw.bestLathe,0,PURCHASE_LIMIT)) fail()
  const w=newWorkshop()
  for(const m of MACHINES) {
    const bought=raw.purchased[m.id],owned=raw.owned[m.id]
    if(!integer(bought,0,PURCHASE_LIMIT)||!finite(owned,bought,INVENTORY_LIMIT)) fail()
    w.owned[m.id]=owned
    w.purchased[m.id]=bought
  }
  if(raw.bestLathe<w.purchased.lathe) fail()
  for(const k of ['parts','earned','lifetime','blueprints','generation','bestLathe']) w[k]=raw[k]
  return w
}
function railFactor(blueprints,bestLathe) {
  return 1+.15*Math.min(10,blueprints)+.10*Math.min(5,Math.floor(bestLathe/5))
}
export function industryMultiplier(w) {
  return railFactor(w.blueprints,w.bestLathe)
}
function factor(w,stops) {
  return MILESTONES.reduce((m,step)=>w.earned>=step.target?m*step.multiplier:m, stationFactor(stops)*blueprintFactor(w.blueprints))
}

// With a fixed multiplier, assembly production is linear, lathe production
// quadratic, and cumulative parts are cubic in time. Split only at output milestones.
function production(w,m) {
  const assemblyRate=w.owned.line*MACHINES[2].rate*m
  const latheUnit=MACHINES[1].rate*m
  return {
    assemblyRate,
    latheRate:w.owned.assembly*latheUnit,
    latheGrowth:assemblyRate*latheUnit,
    partRate:(1+w.owned.lathe)*m,
    partGrowth:w.owned.assembly*latheUnit*m,
    partAcceleration:assemblyRate*latheUnit*m,
  }
}
const partGain=(p,t)=>t*(p.partRate+t*(p.partGrowth/2+t*p.partAcceleration/6))
function produceFor(w,p,seconds,gain) {
  w.owned.assembly=bounded(w.owned.assembly+p.assemblyRate*seconds)
  w.owned.lathe=bounded(w.owned.lathe+seconds*(p.latheRate+seconds*p.latheGrowth/2))
  w.parts=bounded(w.parts+gain)
  w.earned=bounded(w.earned+gain)
  w.lifetime=bounded(w.lifetime+gain)
}
export function advanceWorkshop(w,seconds,stops=0) {
  if(!Number.isFinite(seconds)||seconds<=0) return w
  let left=Math.min(seconds,OFFLINE_LIMIT)
  while(left>0) {
    const p=production(w,factor(w,stops))
    const next=MILESTONES.find(m=>m.target>w.earned)
    const total=partGain(p,left)
    if(!next || total<next.target-w.earned) {
      produceFor(w,p,left,total)
      break
    }
    const needed=next.target-w.earned
    let low=0,high=left
    // Solve the monotone cubic for the first instant at which this milestone is reached.
    for(let i=0;i<54;i++) {
      const mid=(low+high)/2
      if(partGain(p,mid)>=needed) high=mid
      else low=mid
    }
    produceFor(w,p,high,needed)
    w.earned=next.target
    left-=high
  }
  return w
}

// Differences of cumulative rounded prices make a bulk purchase cost exactly
// the same as buying its component machines individually.
function ladder(machine,count) {
  return Math.round(machine.base*Math.expm1(count*Math.log(machine.growth))/(machine.growth-1))
}
const batchCost=(machine,bought,count)=>ladder(machine,bought+count)-ladder(machine,bought)
function affordableQuantity(machine,bought,cash) {
  let low=0,high=PURCHASE_LIMIT-bought
  while(low<high) {
    const mid=Math.ceil((low+high)/2)
    if(batchCost(machine,bought,mid)<=cash) low=mid
    else high=mid-1
  }
  return low
}
function tierView(w,m,index) {
  const machine=MACHINES[index],id=machine.id,purchased=w.purchased[id],owned=w.owned[id]
  const unlockReason=index>0 && !w.purchased[MACHINES[index-1].id]?'先购入一台'+MACHINES[index-1].name:''
  const unlocked=!unlockReason
  const unitPerSecond=machine.rate*m,perSecond=owned*unitPerSecond
  const unitCost=batchCost(machine,purchased,1)
  const max=affordableQuantity(machine,purchased,w.parts)
  const actions={}
  for(const mode of ['1','10','max']) {
    const quantity=mode==='max'?max:Number(mode)
    const cost=batchCost(machine,purchased,quantity)
    const deltaPerSecond=quantity*unitPerSecond
    const reason=unlockReason || (quantity+purchased>PURCHASE_LIMIT || purchased>=PURCHASE_LIMIT?'已达购置上限': !quantity || cost>w.parts?'机件不足':'')
    actions[mode]={type:'workshop',id:'buy:'+id+':'+mode,label:mode==='max'?'买最大':'购买 '+mode,enabled:!reason,reason,
      cost,quantity,deltaPerSecond,afterPerSecond:perSecond+deltaPerSecond}
  }
  return {id,name:machine.name,description:machine.description,output:machine.output,owned,purchased,unlocked,unlockReason,perSecond,unitPerSecond,unitCost,actions}
}
function prestigeOffer(w,stops) {
  const threshold=Math.ceil(550000*(1+.22*w.blueprints)**2)
  const potential=w.earned>=threshold?1+Math.floor(2*Math.log10(w.earned/threshold)):0
  const remaining=BLUEPRINT_LIMIT-w.blueprints
  const gain=Math.min(12,remaining,potential)
  const after=w.blueprints+gain
  const nextGainTarget=gain>=12||gain>=remaining?null:threshold*10**(potential/2)
  return {type:'workshop',id:'prestige',label:'工坊换代',enabled:gain>0,reason:!remaining?'图纸已收集齐全':gain?'':'本代产出尚未达标',
    gain,threshold,nextGainTarget,afterMultiplier:stationFactor(stops)*blueprintFactor(after),afterBlueprintMultiplier:blueprintFactor(after),
    afterRailMultiplier:railFactor(after,w.bestLathe),
    description:'清空本代机件、设备和生产里程碑，带着启动机件重新开工。永久保留蓝图、历代产量和车床购置纪录。'}
}
export function workshopView(w,stops=0) {
  const multiplier=factor(w,stops)
  const milestones=MILESTONES.map(x=>({...x,reached:w.earned>=x.target}))
  return {
    parts:w.parts,earned:w.earned,lifetime:w.lifetime,blueprints:w.blueprints,generation:w.generation,bestLathe:w.bestLathe,
    perSecond:(1+w.owned.lathe)*multiplier,multiplier,railMultiplier:industryMultiplier(w),stationMultiplier:stationFactor(stops),blueprintMultiplier:blueprintFactor(w.blueprints),
    tiers:MACHINES.map((_,i)=>tierView(w,multiplier,i)),milestones,nextMilestone:milestones.find(x=>!x.reached)||null,
    prestige:prestigeOffer(w,stops),
  }
}
export function workshopAction(w,stops,id) {
  if(id==='prestige') {
    const offer=prestigeOffer(w,stops)
    if(!offer.enabled) return {ok:false,message:offer.reason}
    const earned=w.lifetime,generation=w.generation+1,blueprints=w.blueprints+offer.gain,bestLathe=w.bestLathe
    Object.assign(w,newWorkshop(),{generation,blueprints,bestLathe,lifetime:earned})
    return {ok:true,message:'工坊进入第 '+generation+' 代，获得 '+offer.gain+' 张永久蓝图。'}
  }
  if(typeof id!=='string') return {ok:false,message:'未知工坊指令。'}
  const match=/^buy:(lathe|assembly|line):(1|10|max)$/.exec(id)
  if(!match) return {ok:false,message:'未知工坊指令。'}
  const index=MACHINES.findIndex(x=>x.id===match[1])
  const tier=tierView(w,factor(w,stops),index)
  const order=tier.actions[match[2]]
  if(!order.enabled) return {ok:false,message:order.reason}
  const previousRail=industryMultiplier(w)
  w.parts-=order.cost
  w.purchased[tier.id]+=order.quantity
  w.owned[tier.id]=bounded(w.owned[tier.id]+order.quantity)
  w.bestLathe=Math.max(w.bestLathe,w.purchased.lathe)
  const rate=new Intl.NumberFormat('zh-CN',{maximumSignificantDigits:4}).format(order.deltaPerSecond)
  const rail=industryMultiplier(w)
  const railNotice=rail>previousRail?' 煤钢产量现为 ×'+Number(rail.toFixed(2))+'。':''
  return {ok:true,message:'购入 '+order.quantity+' 台'+tier.name+'，每秒多产 '+rate+' '+tier.output+'。'+railNotice}
}
