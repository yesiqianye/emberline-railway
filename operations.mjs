import { GOODS, ROUTE_FUEL, STOPS } from './data.mjs?v=5'

const blankCost = () => ({coal:0, steel:0, tickets:0})
const load = (coal=0, steel=0, tickets=0) => ({coal, steel, tickets})
const describe = amount => Object.keys(GOODS).filter(key => amount[key] > 0).map(key => amount[key] + ' ' + GOODS[key]).join(' · ')

// Prices and settlements are determined by the dispatch station, even if the
// train arrives before the work is settled.
const work = [
  { names:['分拣河港邮袋','转运矿区快件','分拣暖棚邮袋','转运船期急件'], seconds:34, coal:95, steel:3, tickets:5, steelSeconds:24, ticketSeconds:52,
    brief:'给短途货件配车。回款快，留货可换取少量钢材。' },
  { names:['回炉旧桥钢件','轧制矿用钢轨','锻造防雪扣件','铸造码头吊钩'], seconds:64, coal:430, steel:17, tickets:7, steelSeconds:56, ticketSeconds:30,
    brief:'用锅炉余热和燃煤开动小轧机。适合补充钢材。' },
  { names:['整理渡口货垛','编组矿石敞车','换装林场木材','拆分远洋船货'], seconds:49, coal:260, steel:8, tickets:12, steelSeconds:36, ticketSeconds:56,
    brief:'按货主的清单重新编组整批货车。交付可获得较高运费。' },
  { names:['承包河谷修桥料','承包隧道铆件','承包冰湖护栏','承包港区栈桥料'], seconds:54, coal:190, deposit:true, steel:23, tickets:14, steelSeconds:60, ticketSeconds:64,
    brief:'预付承包费押下这批工程料，可把成品留给机务段。' },
]

function jobAward(rate,ratedSeconds) {
  return Math.max(1,Math.floor(rate*ratedSeconds))
}

export function newOperations() { return {serial:0,job:null} }

export function resetStopOperations(ops) {
  delete ops.jobsStarted
  delete ops.marketBought
}

export function restoreOperations(raw) {
  if (raw === undefined) return newOperations()
  function fail(){throw new Error('车上作业存档无效。')}
  if (!raw || typeof raw !== 'object' || !Number.isSafeInteger(raw.serial) || raw.serial<0) fail()
  const ops={serial:raw.serial,job:null}
  if(raw.jobsStarted!==undefined) {
    if(!Number.isInteger(raw.jobsStarted) || raw.jobsStarted<1 || raw.jobsStarted>2) fail()
    ops.jobsStarted=raw.jobsStarted
  }
  if(raw.marketBought!==undefined) {
    if(!Array.isArray(raw.marketBought) || raw.marketBought.length>2 || new Set(raw.marketBought).size!==raw.marketBought.length ||
        !raw.marketBought.every(key=>key==='steel' || key==='coal')) fail()
    ops.marketBought=[...raw.marketBought]
  }
  const j=raw.job
  if (j === null) return ops
  if (!raw.serial || !j || typeof j!=='object' || !Number.isInteger(j.stop) || j.stop<0 || j.stop>=STOPS.length ||
      !Number.isInteger(j.kind) || !work[j.kind] || !Number.isFinite(j.startedAt) || j.startedAt<0 ||
      !Number.isFinite(j.due) || j.due<=j.startedAt || j.due>j.startedAt+work[j.kind].seconds ||
      typeof j.crew!=='boolean' || ![null,true,false].includes(j.checked)) fail()
  ops.job={kind:j.kind,stop:j.stop,startedAt:j.startedAt,due:j.due,crew:j.crew,checked:j.checked}
  if(j.reward!==undefined) {
    if(!j.reward || !['steel','tickets'].every(key=>Number.isSafeInteger(j.reward[key]) && j.reward[key]>=1 && j.reward[key]<=10000)) fail()
    ops.job.reward={steel:j.reward.steel,tickets:j.reward.tickets}
  }
  return ops
}

function option(s, kind, id, label, description, info, cost=blankCost(), gain=blankCost(), extra={}) {
  const shortages=Object.fromEntries(Object.keys(GOODS).map(key=>[key, Math.ceil(cost[key]-s.stock[key])]))
  const missing=describe(shortages)
  return {type:'operation',kind,id,label,description,info,cost,gain,enabled:!missing,reason:missing?'还需 '+missing:'',...extra}
}

function market(s) {
  if(s.trip) return []
  const next=STOPS[Math.min(s.stops,STOPS.length-1)]
  const tier=Math.floor(Math.max(0,s.stops-1)/3)
  const coal=Math.max(420,Math.round(ROUTE_FUEL[next.index]*.38/10)*10)
  const steel=Math.max(12,Math.round(next.steel*.65))
  return [
    ['steel','订购钢材',load(0,0,[5,7,10,13][tier]),load(0,steel)],
    ['coal','订购燃煤',load(0,0,[4,6,9,12][tier]),load(coal)],
  ].map(([key,label,cost,gain])=>{
    const soldOut=s.ops.marketBought?.includes(key)
    const status=soldOut?{enabled:false,reason:'本次停靠已采购，到站后补货'}:{}
    return option(s,'market','market-'+s.stops+'-'+key,soldOut?'本次已采购':label,'',describe(cost)+' → '+describe(gain),cost,gain,{marketGood:key,...status})
  })
}

// Four offers alternate in pairs. Each pair contains at least one job with
// no ticket deposit, so on-board work is accessible on the first trip.
const pairings = [[0,1],[2,3],[1,2],[0,3]]

function assignments(s,rates) {
  const stop=Math.min(s.stops,STOPS.length-1)
  const {serial}=s.ops
  const tripFactor=Math.min(1,s.trip.total/240)
  return pairings[(s.stops+serial)%pairings.length].map(kind=>{
    const spec=work[kind]
    const reward={steel:jobAward(rates.steel,spec.steelSeconds*tripFactor),tickets:jobAward(rates.tickets,spec.ticketSeconds*tripFactor)}
    const deposit=spec.deposit?Math.max(1,Math.floor(reward.tickets/3)):0
    const cost=load(Math.round(spec.coal*(1+stop*.28)),0,deposit)
    const info=describe(cost)+' · '+spec.seconds+' 秒 · 结算选 '+reward.steel+' 钢材或 '+reward.tickets+' 运票'
    return option(s,'assign','assign-'+s.stops+'-'+serial+'-'+kind,spec.names[Math.floor(stop/3)],spec.brief,info,cost,blankCost(),{jobKind:kind,reward})
  })
}

function manifest(s) {
  const {serial,job}=s.ops
  const seed=(serial*37+job.stop*13+job.kind*7)%997
  const checks=[
    ['货物重','吨','载重','请选能承运的股道中额定载重最小的一条。',16],
    ['整列有','节','容车','请选能容纳全列且空位最少的股道。',5],
    ['货单须在','分钟','用时','延误要扣除奖金。请选择能在时限内送达的班组。',10],
    ['货袋需','格','货格','请选能一次装下全部货袋且余位最少的车厢。',10],
  ]
  const mode=(serial+job.kind+job.stop)%checks.length
  const [cargo,unit,label,rule,base]=checks[mode]
  const target=base+seed%8
  const lower=target-1-seed%3
  const upper=target+1+seed%3
  const values=seed%4<2?[lower,upper]:[upper,lower]
  const correctIndex=values.indexOf(mode===2?lower:upper)
  const prompt=mode===2?cargo+target+' 分钟内送达。':cargo+target+' '+unit+'。'
  return {instruction:prompt+rule,options:values.map((val,i)=>({label:['甲','乙'][i]+(mode===2?'班组':mode===3?'车厢':'股道')+' · '+label+' '+val+' '+unit,correct:i===correctIndex}))}
}

function activeJob(s) {
  const {job,serial}=s.ops
  const spec=work[job.kind]
  const name=spec.names[Math.floor(job.stop/3)]
  const remaining=Math.max(0,Math.ceil(job.due-s.elapsed))
  const duration=job.due-job.startedAt
  const bonus=job.checked===true?1.25:1
  if(!remaining) {
    const legacySize=1+job.stop*.28
    const payout=key=>job.reward?Math.round(job.reward[key]*bonus):Math.ceil(Math.round(spec[key]*legacySize)*bonus)
    const actions=[['steel','留用物资',load(0,payout('steel'))],['tickets','交付收票',load(0,0,payout('tickets'))]].map(([key,label,gain])=>
      option(s,'collect','collect-'+serial+'-'+key,label,key==='steel'?'将成品钢材留给列车使用。':'向货主交付成品并收取运票。','获得 '+describe(gain),blankCost(),gain))
    return {title:name+' · 待结算',description:'作业已经完成，请选择如何结算。'+(job.checked===true?'货单核对正确，25% 报酬加成已按整数计入。':''),phase:'ready',duration,remaining,actions}
  }
  const actions=[]
  let instruction=''
  if(job.checked===null) {
    const check=manifest(s)
    instruction=check.instruction
    for(const [i,answer] of check.options.entries()) {
      actions.push(option(s,'check','check-'+serial+'-'+i,answer.label,'核对货单，每单可签发一次。','正确调度：本单结算 +25%',blankCost(),blankCost(),{choice:i}))
    }
  }
  if(!job.crew && remaining>1) {
    const price=job.reward?Math.max(1,Math.round(job.reward.tickets*.2)):3+Math.floor(job.stop/2)
    const cost=load(0,0,price)
    const saved=Math.ceil(remaining/2)
    actions.push(option(s,'crew','crew-'+serial,'雇用替班组','两班并行，本次作业的剩余用时减半。',describe(cost)+' · 节省约 '+saved+' 秒',cost))
  }
  const feedback=job.checked===true?'货单核对正确，本单结算 +25%。':job.checked===false?'已按普通货位装载，本单按标准价结算。':'可在开工期间核对货单，提高本单结算额。'
  return {title:name+' · 作业中',description:feedback+(job.crew?' 替班组已到岗。':''),phase:'working',duration,remaining,instruction,actions}
}

export function operationsView(s,rates) {
  const base={instruction:'',market:market(s),actions:[],remaining:0,duration:0}
  let board
  if(s.ops.job) board=activeJob(s)
  else if(!s.trip) board={phase:'station',title:'车上作业',description:'列车发车后可在途中安排作业。'}
  else {
    const started=s.ops.jobsStarted??0
    if(started>=2) board={phase:'closed',title:'车上作业',description:'本程两单均已结算，下一程开放新作业。'}
    else if(started===1 && s.trip.left>s.trip.total/2) board={phase:'between',title:'车上作业',description:'本程首单已结算，行程过半后可接第二单。'}
    else board={phase:'offer',title:'车上作业',description:'每程可接两单，完工后自选钢材或运票。',actions:assignments(s,rates)}
  }
  return {...base,...board,readyToCollect:board.phase==='ready'}
}

export function runOperation(s,id,rates) {
  const board=operationsView(s,rates)
  const action=[...board.actions,...board.market].find(a=>a.id===id)
  if(!action || !action.enabled) return {ok:false,message:action?.reason||'该作业已处理或当前不可用。'}
  const {job}=s.ops
  let message
  for(const key of Object.keys(GOODS)) s.stock[key]+=action.gain[key]-action.cost[key]
  if(action.kind==='assign') {
    const stop=Math.min(s.stops,STOPS.length-1)
    const duration=work[action.jobKind].seconds
    s.ops.serial++
    s.ops.jobsStarted=(s.ops.jobsStarted??0)+1
    s.ops.job={kind:action.jobKind,stop,startedAt:s.elapsed,due:s.elapsed+duration,checked:null,crew:false,reward:action.reward}
    message='已安排「'+action.label+'」，预计 '+duration+' 秒完工。'
  } else if(action.kind==='check') {
    job.checked=manifest(s).options[action.choice].correct
    message=job.checked?'货单签发正确，本次作业结算增加 25%。':'货位安排需要调整，本单按标准价结算。'
  } else if(action.kind==='crew') {
    job.due=s.elapsed+(job.due-s.elapsed)/2
    job.crew=true
    message='替班组已到岗，剩余作业用时减半。'
  } else if(action.kind==='collect') {
    s.ops.job=null
    message='车上作业结算，获得 '+describe(action.gain)+'。'
  } else {
    s.ops.marketBought=[...(s.ops.marketBought??[]),action.marketGood]
    message='已用 '+describe(action.cost)+' 换取 '+describe(action.gain)+'。'
  }
  return {ok:true,message}
}
