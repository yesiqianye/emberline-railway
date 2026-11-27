import { renderRailDispatch, renderRailEngineering } from './railworks-ui.mjs?v=5';
import { renderWorkshopSummary, renderWorkshop } from './workshop-ui.mjs?v=5';
import { advance, act, view } from './engine.mjs?v=5';
import { renderPanel, renderOperations } from './panels.mjs?v=5';
import { loadGame, saveGame, setupSettings } from './saves.mjs?v=5';
import { icon } from './icons.mjs?v=3';

const $ = id => document.getElementById(id);
const labels = {cab:['驾驶台','机车驾驶台','gauge'],workshop:['工坊','车载工坊','workshop'],map:['线路图','全线线路图','map'],garage:['车库','机车车库','garage'],freight:['货运站','货运调度站','cargo']};
const names = {coal:'煤炭',steel:'钢材',tickets:'运票'};
const chapters = ['第一章','第二章','第三章','第四章'];
const fmt = new Intl.NumberFormat('zh-CN',{maximumFractionDigits:0});
const safety = value => String(value ?? '').replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let state = loadGame();
let tab = '';
let lastNoticeKey = '';
let nextSection = '';
let timer, lastSave = 0;
const workshopOptions = {quantity:'1', confirmPrestige:false};
const time = (s,hours=false) => {
  s=Math.max(0,Math.floor(s));
  const parts = hours?[Math.floor(s/3600),Math.floor(s%3600/60),s%60]:[Math.floor(s/60),s%60];
  return parts.map(n=>String(n).padStart(2,'0')).join(':');
};
function notify(text) {
  $('toast').textContent=text;
  $('toast').classList.add('on');
  clearTimeout(timer);
  timer=setTimeout(()=>$('toast').classList.remove('on'),3200);
}
function persist() {
  const good=saveGame(state);
  $('save-status').classList.toggle('warn',!good);
  $('save-status').lastChild.textContent=good?'自动存档':'待备份';
  lastSave=Date.now();
}
const settings = setupSettings({getState:()=>state,replaceState(next){state=next;workshopOptions.confirmPrestige=false;render();},notify});
function html(node,value) { if(node.previousValue!==value){node.innerHTML=value;node.previousValue=value;} }
function text(node,value) {if(node.textContent!==value)node.textContent=value;}
// Keep live controls mounted while countdowns, costs and balances are refreshed.
function patchNode(current, next) {
  if (current.isEqualNode(next)) return;
  if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName ||
      (current.tagName === 'BUTTON' && (current.dataset.action !== next.dataset.action || current.dataset.id !== next.dataset.id))) {
    current.replaceWith(next.cloneNode(true));
    return;
  }
  if (current.nodeType !== Node.ELEMENT_NODE) {
    current.nodeValue = next.nodeValue;
    return;
  }
  for (const name of current.getAttributeNames()) {
    if (!next.hasAttribute(name) && !(current.tagName === 'DETAILS' && name === 'open')) current.removeAttribute(name);
  }
  for (const attr of next.attributes) {
    if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
  }
  patchChildren(current, next);
}
function patchChildren(parent, next) {
  while (parent.childNodes.length > next.childNodes.length) parent.lastChild.remove();
  Array.from(next.childNodes).forEach((n, i) => {
    if (parent.childNodes[i]) patchNode(parent.childNodes[i], n);
    else parent.append(n.cloneNode(true));
  });
}
function liveHTML(node, markup) {
  if (markup === node.previousValue) return;
  const template = document.createElement('template');
  template.innerHTML = markup;
  patchChildren(node, template.content);
  node.previousValue = markup;
}
function syncSound() {
  const on=settings.isSoundOn();
  $('sound').setAttribute('aria-pressed',String(on));
  $('sound').title=$('sound').ariaLabel=on?'关闭音效':'开启音效';
  html($('sound'),icon(on?'sound':'mute'));
}
function navFromURL(){let key=location.hash.slice(1);return Object.hasOwn(labels,key)?key:'cab';}
$('nav').innerHTML=Object.entries(labels).map(([key,[label,,symbol]])=>'<button type="button" data-tab="'+key+'">'+icon(symbol)+label+(key==='freight'?'<span id="nav-alert" class="red-light" aria-hidden="true" hidden></span>':'')+'</button>').join('');
$('settings').innerHTML=icon('settings');$('clock-symbol').innerHTML=icon('clock');
$('resources').innerHTML=Object.entries(names).map(([k,n])=>'<div class="res res-'+k+'"><span class="res-icon">'+icon(k==='tickets'?'ticket':k)+'</span><span><span class="res-name">'+n+'</span><span class="res-rate" id="rate-'+k+'"></span></span><strong class="res-val" id="value-'+k+'"></strong></div>').join('');
const cab = `
  <div id="cab-workshop"></div>
  <div class="dashboard">
    <div class="cab-column">
      <section class="cab-card">
        <div class="scene">
          <img id="scene-img" alt="">
          <div class="scene-tags"><span class="state-tag"><i class="lamp"></i><span id="train-state"></span></span></div>
          <div class="scene-caption">
            <div class="scene-loc">${icon('pin')}<span id="location-type"></span></div>
            <h2 id="site-name"></h2><p id="site-desc"></p>
          </div>
        </div>
        <div class="cab-controls">
          <div class="journey-row"><span id="next"></span><span id="distance"></span></div>
          <div id="progress" class="journey-line" hidden><i></i></div>
          <div class="coal-controls">
            <div class="stoker">
              <span class="stoker-icon">${icon('shovel')}</span>
              <div><strong>自动添煤</strong><small id="stoker-rate"></small></div>
              <button type="button" id="auto-coal" data-action="toggleStoke" role="switch" aria-label="自动添煤"><i></i></button>
            </div>
            <button class="cab-btn" id="manual-coal" data-action="stoke" hidden>${icon('shovel')}手动添煤 <small id="stoke-amt"></small></button>
            <button class="cab-btn main" data-action="depart">${icon('train')}<span id="depart-text"></span></button>
          </div>
        </div>
      </section>
      <div id="cab-railworks"></div>
      <div id="cab-operations"></div>
    </div>
    <aside class="side">
      <section class="info-card objective">
        <h2 class="card-title">${icon('flag')}本程目标<span id="goal-alert" class="red-light" aria-hidden="true" hidden></span></h2>
        <h3 id="goal"></h3><p id="goal-desc"></p><div id="goal-link"></div>
      </section>
      <section class="info-card">
        <h2 class="card-title">${icon('path')}行程路线<a href="#map" title="查看全线线路图" aria-label="查看全线线路图">${icon('arrow')}</a></h2>
        <ol class="stops" id="stops"></ol>
      </section>
    </aside>
  </div>
  <details class="journal" open><summary><h2 class="card-title">${icon('book')}行车日志</h2></summary><ul id="journal-list" class="journal-list"></ul></details>`;

function showStoker(v) {
  const feeder = v.autoStoke;
  const manual = $('manual-coal');
  manual.hidden = feeder.enabled;
  manual.disabled = !v.actions.stoke.enabled;
  text($('stoke-amt'), '+' + feeder.amount.toLocaleString('zh-CN',{maximumFractionDigits:1}));
  $('auto-coal').setAttribute('aria-checked', String(feeder.enabled));
  const rate = feeder.perMinute.toLocaleString('zh-CN', {maximumFractionDigits:1});
  text($('stoker-rate'), feeder.enabled ? '+' + rate + ' 煤 / 分 · 已计入产量' : '已停机 · 可手动添煤');
}
function pendingNotice(v) {
  const signal = v.contracts.find(c => c.kind === 'signal');
  if (signal) return {key:signal.id, label:signal.name.split(' · ')[0], action:'处理沿途信号'};
  if (v.operations?.readyToCollect) return {key:'work-ready', label:'车组作业待结算', action:'结算车组作业'};
  return null;
}
function showNotices(notice) {
  const navButton = $('nav-alert').closest('button');
  $('nav-alert').hidden = !notice;
  navButton.setAttribute('aria-label', notice ? '货运站，有待处理事项：' + notice.label : '货运站');
  if (notice && notice.key !== lastNoticeKey) notify(notice.label + '，可在驾驶台或货运站处理。');
  lastNoticeKey = notice?.key || '';
}
function focusOperations() {
  const area = $('rail-operations');
  if (!area) return;
  const target = area.querySelector('.erp-live-event button:enabled') || area.querySelector('button:enabled') || area;
  if (target === area) area.tabIndex = -1;
  target.focus({preventScroll:true});
  target.scrollIntoView({block:'center'});
}
function showCab(v, notice) {
  const {leg,finished,station,region,objective}=v;
  liveHTML($('cab-workshop'), renderWorkshopSummary(v));
  const scene='./art/region-'+(region.index+1)+'.webp';
  if($('scene-img').getAttribute('src')!==scene){$('scene-img').src=scene;$('scene-img').alt=region.name+'铁路风景';}
  text($('train-state'),leg.traveling?(leg.circuit?'环运班列运行中':'区间运行'):finished?'全线通车':'站内整备');
  text($('location-type'),leg.traveling?'当前区间':'当前位置');
  text($('site-name'),leg.traveling?leg.name:station.name);
  text($('site-desc'),leg.traveling || leg.circuit?leg.description:station.description);
  html($('next'),leg.circuit?'海湾环运 · <b>曙光总站往返</b>':(leg.traveling?'即将抵达':'下一站')+'　<b>'+safety(leg.destination)+'</b>');
  text($('distance'),leg.traveling?'剩余 '+time(Math.ceil(leg.remaining)):leg.circuit?'已完成 '+v.railworks.circuits+' 班':Math.floor(v.distance)+' / '+v.stations.at(-1).km+' km');
  $('progress').hidden=!leg.traveling;
  if(leg.traveling)$('progress').firstChild.style.width=leg.progress*100+'%';
  showStoker(v);
  const depart=$('depart-text').closest('button');
  text($('depart-text'),v.actions.depart.label);
  depart.disabled=!v.actions.depart.enabled;
  depart.title=v.actions.depart.reason || '备齐物资，驶向下一站';
  text($('goal'),objective.title);
  let description=objective.description;
  if(v.elapsed<75 && !leg.traveling && !leg.stopsDone)description+=' 钢材会自动入库，备齐即可发车。';
  text($('goal-desc'),description);
  $('goal-alert').hidden = !notice;
  if (notice) {
    html($('goal-link'), '<button class="text-btn" type="button" data-focus-operations>' + notice.action + icon('arrow') + '</button>');
  } else {
    html($('goal-link'), '<a class="text-btn" href="#map">' + (leg.circuit ? '查看环运线路' : '查看线路') + icon('arrow') + '</a>');
  }
  liveHTML($('cab-railworks'), renderRailDispatch(v));
  liveHTML($('cab-operations'), renderOperations(v,{compact:true}));
  const start=region.index*3;
  const prior=start===0?{name:'余烬机务段',km:0,status:leg.stopsDone===0?'current':'done'}:v.stations[start-1];
  html($('stops'),[prior,...v.stations.slice(start,start+3)].map(s=>'<li class="'+s.status+'"><span>'+safety(s.name)+'</span><small>'+s.km+' km</small></li>').join(''));
  html($('journal-list'),v.log.slice(0,5).map(l=>'<li><time>'+new Date(l.time).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})+'</time><span>'+safety(l.text)+'</span></li>').join(''));
}
function render() {
  const v=view(state);
  const target=navFromURL();
  if(target!==tab) {
    tab=target;
    workshopOptions.confirmPrestige=false;
    $('resources').hidden=tab==='workshop';
    $('content').previousValue = null;
    $('nav').querySelectorAll('button').forEach(b=>{if(b.dataset.tab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    text($('heading'),labels[tab][1]);
    $('content').innerHTML=tab==='cab'?cab:'';
  }
  text($('chapter'),chapters[v.region.index]+'　/　'+v.region.name);
  text($('clock'),time(v.elapsed,true));
  for(const k of Object.keys(names)){
    text($('value-'+k),fmt.format(Math.floor(v.resources[k])));
    text($('rate-'+k),'+'+(v.rates[k]*60).toLocaleString('zh-CN',{maximumFractionDigits:1})+' / 分');
  }
  syncSound();
  const notice = pendingNotice(v);
  showNotices(notice);
  if(tab==='cab') showCab(v, notice);
  else if(tab==='workshop') liveHTML($('content'),renderWorkshop(v,workshopOptions));
  else if(tab==='garage') liveHTML($('content'),renderRailEngineering(v)+renderPanel(tab,v));
  else liveHTML($('content'),renderPanel(tab,v));
}
function update() {advance(state);render();if(Date.now()-lastSave>=5000)persist();}
function focusRailSection(id) {
  const section = document.getElementById(id);
  if (!section) return;
  section.focus({preventScroll:true});
  section.scrollIntoView({block:'start'});
}
window.addEventListener('hashchange',()=>{
  render();
  if(nextSection) focusRailSection(nextSection);
  else window.scrollTo(0,0);
  nextSection='';
});
document.addEventListener('click',e=>{
  const link = e.target.closest('a[data-rail-focus]');
  if(link && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
    if(link.hash === location.hash) {
      e.preventDefault();
      focusRailSection(link.dataset.railFocus);
    } else nextSection = link.dataset.railFocus;
    return;
  }
  const b=e.target.closest('button');
  if(!b||b.disabled)return;
  if(b.id==='settings'){settings.open();return;}
  if(b.id==='sound'){settings.toggleSound();syncSound();return;}
  if(b.hasAttribute('data-focus-operations')){focusOperations();return;}
  if(b.dataset.tab){
    if(b.dataset.tab==='freight' && tab==='freight' && !$('nav-alert').hidden) focusOperations();
    else location.hash=b.dataset.tab;
    return;
  }
  if (b.hasAttribute('data-workshop-quantity')) {
    workshopOptions.quantity=b.dataset.workshopQuantity;
    render();
    return;
  }
  if (b.hasAttribute('data-workshop-confirm')) {
    workshopOptions.confirmPrestige=b.dataset.workshopConfirm==='open';
    render();
    document.querySelector(workshopOptions.confirmPrestige?'[data-workshop-confirm="cancel"]':'[data-workshop-confirm="open"]')?.focus({preventScroll:true});
    return;
  }
  if(b.dataset.action){
    const type=b.dataset.action;
    if(type==='workshop' && b.dataset.id==='prestige') {
      if(!workshopOptions.confirmPrestige) return;
      workshopOptions.confirmPrestige=false;
    }
    const result=act(state,type,b.dataset.id);
    if(result.ok){settings.play(type);persist();}
    notify(result.message);render();
  }
});
document.addEventListener('visibilitychange',()=>{if(document.hidden){advance(state);persist();}else update();});
window.addEventListener('pagehide',()=>{advance(state);persist();});
render();persist();
const off=view(state).offline;
if(off?.seconds>=60)notify('离线调度 '+Math.floor(off.seconds/60)+' 分钟，收回 '+Math.floor(off.coal)+' 煤炭、'+Math.floor(off.steel)+' 钢材、'+Math.floor(off.tickets)+' 运票'+(off.parts>=1?'，工坊生产 '+fmt.format(Math.floor(off.parts))+' 机件。':'。'));
setInterval(()=>{if(!document.hidden)update();},500);
