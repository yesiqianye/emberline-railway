const shapes = {
  track: '<path d="M6 3v18M18 3v18M4 6h16M4 12h16M4 18h16"/>',
  junction: '<path d="M6 21V3m0 13c0-7 12-7 12-13M3 6l3-3 3 3m6 0 3-3 3 3"/>',
  engine: '<path d="M4 16V9h9v7m0-8V5h5v11M3 16h18m-17 3h16M7 9V5H5m11 3h2"/>',
  tools: '<path d="m13 6 4 4m-8 3-5 5a1.4 1.4 0 0 0 2 2l5-5M3 4l2-1 3 3-1 2-2-1Zm5 4 4 4m2-1 6 6a1.7 1.7 0 0 1-3 2l-6-7m1-2a5 5 0 0 1 6-6l-3 3 2 2 3-3a5 5 0 0 1-6 6"/>',
  cargo: '<path d="m3 7 9-4 9 4v10l-9 4-9-4Zm0 0 9 4 9-4m-9 4v10M7 5l9 4"/>',
  freight: '<path d="M3 6h18l-2 9H5zm-2 9h22M3 21h18"/><circle cx="7" cy="17.5" r="1.5"/><circle cx="17" cy="17.5" r="1.5"/>',
  ticket: '<path d="M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4Zm12 0v2m0 3v2m0 3v2"/>',
  flag: '<path d="M5 21V4m0 1c5-3 9 3 15 0v9c-6 3-10-3-15 0"/>',
  check: '<path d="m5 12 4.5 4.5L19 7"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M9 10V7a3 3 0 1 1 6 0v3m-3 5v2"/>',
  signal: '<path d="M11 16v5m-3 0h6"/><rect x="7" y="2" width="9" height="14" rx="4"/><path d="M11.5 6v1m0 4v1"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  fire: '<path d="M13 3c1 4-1 6-3 8-1-1-1-2-1-3-4 3-6 7-3 11 3 4 10 4 13-1 2-4 0-8-2-10 0 2-1 3-2 3 1-3 0-5-2-8Z"/>',
  steel: '<path d="m4 10 10-6 7 4-9 6zm0 0v5l8 5 9-6V8m-9 6v6"/>',
  plus: '<path d="M5 12h14m-7-7v14"/>'
};

const icon = (name) => '<svg class="erp-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">' + shapes[name] + '</svg>';
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const numbers = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });
const resNames = { coal:'煤炭', steel:'钢材', tickets:'运票' };
const resIcons = { coal:'fire', steel:'steel', tickets:'ticket' };
const regionNumbers = ['Ⅰ','Ⅱ','Ⅲ','Ⅳ'];

function actionButton(a, tone = '', alternate) {
  if (!a || !a.type) return '';
  const extra = a.id == null ? '' : ' data-id="' + escape(a.id) + '"';
  return '<button type="button" class="erp-btn ' + tone + '" data-action="' + escape(a.type) + '"' + extra +
    (a.enabled === false ? ' disabled' : '') + (a.reason ? ' title="' + escape(a.reason) + '"' : '') + '>' +
    escape(alternate || a.label) + '</button>';
}

function costLine(cost) {
  if (!cost || typeof cost !== 'object') return '';
  const entries = Object.keys(resNames).filter(k => cost[k] > 0);
  if (!entries.length) return '';
  return '<div class="erp-cost">' + entries.map(k => '<span>' + icon(resIcons[k]) + escape(numbers.format(cost[k])) + ' ' + resNames[k] + '</span>').join('') + '</div>';
}

function title(symbol, name, note = '') {
  return '<div class="erp-heading">' + icon(symbol) + '<h3>' + name + '</h3>' + (note ? '<span class="erp-hnote">' + escape(note) + '</span>' : '') + '</div>';
}

function mapPanel(v) {
  const { leg, regions, stations, routes } = v;
  const arrived = leg.stopsDone ?? stations.filter(s => s.status === 'done' || s.status === 'current').length;
  const selectedRoute = routes.find(r => r.selected);
  const regionMap = regions.map((r, i) => {
    const stops = stations.filter(s => s.regionIndex === r.index);
    return '<section class="erp-zone' + (r.index === v.region.index ? ' is-here' : '') + '">' +
      '<header><b class="erp-numeral">' + (regionNumbers[i] || (i+1)) + '</b><span>' + escape(r.name) + '</span></header>' +
      '<ol>' + stops.map(s => '<li class="erp-stop ' + escape(s.status) + '" title="' + escape(s.description) + '">' +
        '<span class="erp-stop-node">' + (s.status === 'done' ? icon('check') : '') + '</span><div><strong>' + escape(s.name) + '</strong>' +
        '<small>' + escape(numbers.format(s.km)) + ' km' + (s.status === 'current' ? ' · 当前站' : s.status === 'next' ? ' · 下一站' : '') + '</small></div></li>').join('') + '</ol></section>';
  }).join('');
  let dispatch = '';
  if (v.finished) {
    dispatch = '<section class="erp-box erp-ending">' + icon('flag') + '<div><h3>全线贯通</h3><p>列车已抵达终点。沿线车站继续运转，你可以返回车库调整编组，也可以继续经营货运线。</p></div></section>';
  } else {
    const progress = Math.min(100, Math.max(0, (leg.progress || 0) * 100));
    dispatch = '<section class="erp-box">' + title('junction', '区间调度', leg.traveling ? '行车中' : '停站中') +
      '<div class="erp-trip"><div><h4>' + escape(v.station.name) + '<span class="erp-track-arrow" aria-hidden="true">→</span>' + escape(leg.destination) + '</h4>' +
      '<p>' + escape(leg.description) + '</p>' + (!leg.traveling && !v.actions.depart.enabled ? '<small class="erp-depart-reason">' + escape(v.actions.depart.reason) + '</small>':'') + '</div>' + actionButton(v.actions.depart, 'erp-primary') + '</div>' +
      (leg.traveling ? '<div class="erp-journey"><div><span>' + escape(selectedRoute?.name || '行驶进度') + '</span><span>' + Math.floor(progress) + '%</span></div><progress max="100" value="' + progress + '"></progress></div>' : '') +
      (routes.length ? '<div class="erp-forks">' + routes.map((r, i) => '<div class="erp-fork ' + (r.selected ? 'is-picked' : '') + '">' +
        '<div><span class="erp-letter">' + (i===0 ? 'A':'B') + '</span><strong>' + escape(r.name) + '</strong></div><p>' + escape(r.description) + '</p>' +
        '<dl class="erp-route-terms"><dt>行程</dt><dd>' + Math.ceil(r.total/60) + ' 分钟</dd><dt>发车物资</dt><dd>' + costLine(r.cost) + '</dd><dt>到站收获</dt><dd>' + costLine(r.award) + '</dd></dl><div class="erp-fork-bottom">' + actionButton(r.action, '', r.selected ? '已选路线' : undefined) + '</div></div>').join('') + '</div>' : '') + '</section>';
  }
  return '<div class="erp">' + dispatch + '<section class="erp-box">' + title('track','全线站点', arrived + ' / ' + stations.length + ' 站') + '<p class="erp-maprule">' + escape(v.region.rule) + '</p><div class="erp-map">' + regionMap + '</div></section></div>';
}

function lockedReason(item) {
  if (!item.action || item.action.enabled !== false || !item.action.reason) return '';
  if (item.action.reason === item.info || item.action.reason === item.action.label) return '';
  return '<small class="erp-reason">' + escape(item.action.reason) + '</small>';
}

function garagePanel(v) {
  const equipped = v.cars.filter(c => c.equipped);
  const slotCount = v.slots;
  const slots = Array.from({length:slotCount}, (_, i) => {
    const car = equipped[i];
    return '<div class="erp-coupler ' + (car ? 'occupied':'vacant') + '">' + icon(car ? 'freight':'plus') + '<span>' + escape(car?.name || '空挂位') + '</span></div>';
  }).join('');
  const consist = '<section class="erp-box">' + title('engine','列车编组',equipped.length + ' / ' + slotCount + ' 挂位') +
    '<div class="erp-consist"><div class="erp-coupler erp-loco">' + icon('engine') + '<span>机车</span></div>' + slots + '</div>' +
    '<div class="erp-items">' + v.cars.map(c =>
      '<div class="erp-row' + (c.unlocked === false ? ' erp-locked':'') + '"><span class="erp-item-icon ' + (c.equipped?'is-active':'') + '">' + icon(c.unlocked===false?'lock':'freight') + '</span><div class="erp-rowbody"><h4>' +
      escape(c.name) + (c.equipped ? '<span class="erp-equipped">已挂载</span>' : '') + '</h4><p>' + escape(c.description) + '</p>' +
      (!c.unlocked && c.info ? '<small>' + escape(c.info) + '</small>' : '') + lockedReason(c) + '</div>' + actionButton(c.action) + '</div>').join('') + '</div></section>';
  const upgrades = '<section class="erp-box">' + title('tools','机车改装') + '<div class="erp-items">' + v.upgrades.map(u => '<div class="erp-row"><span class="erp-item-icon">' + icon('tools') + '</span><div class="erp-rowbody"><h4>' + escape(u.name) +
    '<span class="erp-level">Lv. ' + escape(u.level) + ' / ' + escape(u.max) + '</span></h4><p>' + escape(u.description) + '</p>' +
    (u.level<u.max ? costLine(u.cost):'') + lockedReason(u) + '</div>' + actionButton(u.action) + '</div>').join('') + '</div></section>';
  return '<div class="erp erp-two">' + consist + upgrades + '</div>';
}

function freightPanel(v) {
  const stationOrders = v.contracts.filter(c => c.kind !== 'signal');
  const signals = v.contracts.filter(c => c.kind === 'signal');
  const done = stationOrders.filter(c => c.completed).length;
  const current = stationOrders.filter(c => c.unlocked && !c.completed);
  const upcoming = stationOrders.find(c => !c.unlocked && !c.completed);
  const shown = [...current, ...(upcoming ? [upcoming] : [])];
  const signalBox = signals.length ? '<section class="erp-box erp-signal">' + title('signal', '沿途信号') +
    signals.map(c => '<div class="erp-row"><div class="erp-rowbody"><h4>' + escape(c.name) + '</h4><p>' + escape(c.description) +
    '</p><small>' + escape(c.info) + '</small></div>' + actionButton(c.action) + '</div>').join('') + '</section>' : '';
  const contracts = '<section class="erp-box">' + title('ticket','车站委托', done + ' / ' + stationOrders.length + ' 已交付') +
    '<div class="erp-items">' + shown.map(c => '<div class="erp-row' + (c.unlocked===false ? ' erp-locked' : '') + '"><span class="erp-item-icon">' +
      icon(c.unlocked===false?'lock':'ticket') + '</span><div class="erp-rowbody"><h4>' + escape(c.name) + '</h4><p>' + escape(c.description) +
      '</p>' + costLine(c.cost) + '<small>报酬 · ' + escape(c.reward) + ' 运票 · ' + escape(c.benefit) + '</small>' + lockedReason(c) + '</div>' + actionButton(c.action) + '</div>').join('') +
      (done ? '<div class="erp-done">' + icon('check') + '<div><strong>已交付委托</strong><p>' + stationOrders.filter(c => c.completed).map(c => escape(c.name)).join(' · ') + '</p></div></div>' : '') + '</div></section>';
  const freight = '<section class="erp-box">' + title('cargo','常设货运线') + '<div class="erp-items">' + v.freights.map(f => '<div class="erp-row' + (f.unlocked===false?' erp-locked':'') + '"><span class="erp-item-icon ' + (f.level?'is-active':'') + '">' +
    icon(f.unlocked===false?'lock':'cargo') + '</span><div class="erp-rowbody"><h4>' + escape(f.name) + (f.level ? '<span class="erp-level">Lv. ' + escape(f.level) + ' / ' + escape(f.max) + '</span>':'') + '</h4>' +
    '<p>' + escape(f.description) + '</p>' + (f.info?'<small>' + escape(f.info.includes('+') ? f.info.slice(f.info.indexOf('+')) : f.info) + '</small>':'') + (f.level<f.max ? costLine(f.cost):'') + lockedReason(f) + '</div>' + actionButton(f.action) + '</div>').join('') + '</div></section>';
  return '<div class="erp">' + signalBox + '<div class="erp erp-two">' + contracts + freight + '</div></div>';
}

export function renderPanel(tab, v) {
  if (tab === 'map') return mapPanel(v);
  if (tab === 'garage') return garagePanel(v);
  if (tab === 'freight') return freightPanel(v);
  return '';
}
