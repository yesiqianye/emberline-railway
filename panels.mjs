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

function duration(seconds) {
  const whole = Math.max(0, Math.ceil(seconds));
  return String(Math.floor(whole / 60)).padStart(2, '0') + '分' +
    String(whole % 60).padStart(2, '0') + '秒';
}

function routeEconomy(route) {
  return Object.keys(resNames).map(key => {
    const rounded = Math.round(route.netPerMinute[key] * 10) / 10;
    const signed = rounded > 0 ? '+' + numbers.format(rounded) : numbers.format(rounded);
    return '<span class="' + (rounded > 0 ? 'erp-gain' : '') + '">' +
      escape(resNames[key]) + ' ' + signed + '</span>';
  }).join('');
}

function routeDifference(route, other) {
  if (!other) return '';
  const delta = route.total - other.total;
  let deltaGoods = [];
  if (route.id === 'haul') {
    for (const key of ['coal', 'steel']) {
      const gain = route.net[key] - other.net[key];
      if (gain > 0) deltaGoods.push(numbers.format(gain) + ' ' + resNames[key]);
    }
  }
  const ticketAdvantage = route.netPerMinute.tickets - other.netPerMinute.tickets;
  const parts = [];
  if (delta) parts.push('比另一线' + (delta < 0 ? '快 ' : '慢 ') + duration(Math.abs(delta)));
  if (deltaGoods.length) parts.push('每趟净增 ' + deltaGoods.join('、'));
  else if (ticketAdvantage > .05) parts.push('每分多得 ' + numbers.format(ticketAdvantage) + ' 运票');
  return parts.join(' · ');
}

function routeCard(route, other, moving) {
  const assigned = moving && route.selected;
  const note = moving ? '基础运价已在发车时锁定' : routeDifference(route, other);
  const effects = [];
  if (route.savings?.coal) effects.push('喷嘴节省 ' + numbers.format(route.savings.coal) + ' 煤炭');
  if (route.savings?.tickets) effects.push('货架增收 ' + numbers.format(route.savings.tickets) + ' 运票');
  if (route.cargoTickets) effects.push('备件托运 +' + numbers.format(route.cargoTickets) + ' 运票');
  return '<div class="erp-fork ' + (route.selected ? 'is-picked' : '') + '">' +
    '<div><span class="erp-letter">' + (route.id === 'fast' ? 'A' : 'B') + '</span><strong>' + escape(route.name) +
    '</strong><span class="erp-hnote">' + (route.id === 'fast' ? '正线' : '货运支线') + '</span></div>' +
    '<p>' + escape(route.description) + '</p>' +
    '<dl class="erp-route-terms"><dt>计划时长</dt><dd>' + duration(route.total) +
    (route.speedBonus ? '<span class="erp-speed">车速 +' + numbers.format(route.speedBonus) + '%</span>' : '') +
    '</dd><dt>发车物资</dt><dd>' + costLine(route.cost) + '</dd><dt>到站收获</dt><dd>' + costLine(route.award) +
    '</dd><dt>每分净得</dt><dd class="erp-net">' + routeEconomy(route) + '</dd></dl>' +
    (effects.length ? '<p class="erp-maprule">本程已计入 · ' + escape(effects.join('，')) + '</p>' : '') +
    '<div class="erp-fork-bottom"><small class="erp-delta">' + escape(note) + '</small>' +
    actionButton(route.action, '', assigned ? '行驶中' : route.selected ? '已选路线' : undefined) + '</div></div>';
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
  const progress = Math.min(100, Math.max(0, (leg.progress || 0) * 100));
  const dispatch = '<section class="erp-box">' + title('junction', leg.circuit ? '海湾环运班列' : '区间调度', leg.circuit ? '全线贯通 · 已完成 ' + v.railworks.circuits + ' 班' : leg.traveling ? '行车中' : '停站中') +
    '<div class="erp-trip"><div><h4>' + escape(v.station.name) + '<span class="erp-track-arrow" aria-hidden="true">→</span>' + (leg.circuit ? '海湾沿岸 → ' : '') + escape(leg.destination) + '</h4>' +
    '<p>' + escape(leg.description) + '</p>' + (!leg.traveling && !v.actions.depart.enabled ? '<small class="erp-depart-reason">' + escape(v.actions.depart.reason) + '</small>':'') + '</div>' + actionButton(v.actions.depart, 'erp-primary') + '</div>' +
    (leg.traveling ? '<div class="erp-journey"><div><span>' + escape(selectedRoute?.name || '行驶进度') + '</span><span>' + Math.floor(progress) + '%</span></div><progress max="100" value="' + progress + '"></progress></div>' : '') +
    '<div class="erp-forks' + (leg.traveling ? ' erp-enroute' : '') + '">' +
    (leg.traveling ? routes.filter(r => r.selected) : routes).map(r => routeCard(r, routes.find(other => other.id !== r.id), leg.traveling)).join('') +
    '</div><p class="erp-economy-note">每分净得按到站收获减去发车物资，再除以计划时长计算。</p>'  + '</section>';
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

function operationChoices(actions, compact) {
  if (!actions.length) return '';
  return '<div class="erp-op-choices">' + actions.map(a => '<div class="erp-op-choice">' +
    (a.description && !compact ? '<p>' + escape(a.description) + '</p>' : '') +
    (a.info ? '<small>' + escape(a.info) + '</small>' : '') + actionButton(a) +
    (a.reason && !a.enabled ? '<small class="erp-op-disabled">' + escape(a.reason) + '</small>' : '') +
    '</div>').join('') + '</div>';
}

function pendingSignal(signals) {
  if (!signals.length) return '';
  const event = signals[0];
  const name = event.name.split(' · ')[0];
  return '<div class="erp-op-block erp-live-event"><h4>' + icon('signal') + escape(name) +
    '<small>沿途信号</small></h4><p>' + escape(event.description) +
    '</p><div class="erp-op-choices">' + signals.map(c => '<div class="erp-op-choice"><small>' + escape(c.info) +
    '</small>' + actionButton(c.action) + '</div>').join('') + '</div></div>';
}

export function renderOperations(v, {compact = false} = {}) {
  const ops = v.operations;
  const signals = v.contracts.filter(c => c.kind === 'signal');
  if (!ops && !signals.length) return '';
  const phase = ops?.phase;
  const waiting = phase === 'working';
  const market = ops?.market || [];
  const job = ops && phase !== 'station' ? '<div class="erp-op-block' + (phase === 'ready' ? ' erp-live-event' : '') +
    '"><h4>' + icon('tools') + escape(ops.title) + '</h4><p>' + escape(ops.description) + '</p>' +
    (waiting ? '<div class="erp-op-progress"><progress aria-label="作业进度" value="' +
      Math.max(0, ops.duration - ops.remaining) + '" max="' + ops.duration + '"></progress><small>剩余 ' + duration(ops.remaining) + '</small></div>' : '') +
    (ops.instruction ? '<p class="erp-op-instruction">' + escape(ops.instruction) + '</p>' : '') +
    operationChoices(ops.actions || [], compact) + '</div>' : '';
  const shop = market.length ? '<div class="erp-op-block"><h4>' + icon('ticket') + '站内采购</h4>' +
    '<p>每次停靠，燃煤和钢材各可采购一批。到站后补货。</p>' +
    operationChoices(market, compact) + '</div>' : '';
  const pass = v.priorityPass;
  const priority = pass ? '<div class="erp-op-block"><h4>' + icon('signal') + '优先通行</h4>' +
    '<div class="erp-dispatch-service"><p>' + escape(pass.used ? '本程已购买优先通行。' : pass.info + (pass.reason ? ' · ' + pass.reason : '')) + '</p>' +
    actionButton(pass) + '</div></div>' : '';
  const body = pendingSignal(signals) + job + priority + shop;
  if (!body) return '';
  return '<section id="rail-operations" tabindex="-1" class="erp erp-operations' + (compact ? ' erp-compact' : '') + '">' +
    '<div class="erp-box">' + title('junction','调度作业') + body + '</div></section>';
}

function freightPanel(v) {
  const stationOrders = v.contracts.filter(c => c.kind !== 'signal');
  const done = stationOrders.filter(c => c.completed).length;
  const current = stationOrders.filter(c => c.unlocked && !c.completed);
  const upcoming = stationOrders.find(c => !c.unlocked && !c.completed);
  const shown = [...current, ...(upcoming ? [upcoming] : [])];
  const contracts = '<section class="erp-box">' + title('ticket','车站委托', done + ' / ' + stationOrders.length + ' 已交付') +
    '<div class="erp-items">' + shown.map(c => '<div class="erp-row' + (c.unlocked===false ? ' erp-locked' : '') + '"><span class="erp-item-icon">' +
      icon(c.unlocked===false?'lock':'ticket') + '</span><div class="erp-rowbody"><h4>' + escape(c.name) + '</h4><p>' + escape(c.description) +
      '</p>' + costLine(c.cost) + '<small>报酬 · ' + escape(c.reward) + ' 运票 · ' + escape(c.benefit) + '</small>' + lockedReason(c) + '</div>' + actionButton(c.action) + '</div>').join('') +
      (done ? '<div class="erp-done">' + icon('check') + '<div><strong>已交付委托</strong><p>' + stationOrders.filter(c => c.completed).map(c => escape(c.name)).join(' · ') + '</p></div></div>' : '') + '</div></section>';
  const freight = '<section class="erp-box">' + title('cargo','常设货运线') + '<div class="erp-items">' + v.freights.map(f => '<div class="erp-row' + (f.unlocked===false?' erp-locked':'') + '"><span class="erp-item-icon ' + (f.level?'is-active':'') + '">' +
    icon(f.unlocked===false?'lock':'cargo') + '</span><div class="erp-rowbody"><h4>' + escape(f.name) + (f.level ? '<span class="erp-level">Lv. ' + escape(f.level) + ' / ' + escape(f.max) + '</span>':'') + '</h4>' +
    '<p>' + escape(f.description) + '</p>' + (f.info?'<small>' + escape(f.info.includes('+') ? f.info.slice(f.info.indexOf('+')) : f.info) + '</small>':'') + (f.level<f.max ? costLine(f.cost):'') + lockedReason(f) + '</div>' + actionButton(f.action) + '</div>').join('') + '</div></section>';
  return '<div class="erp">' + renderOperations(v) + '<div class="erp erp-two">' + contracts + freight + '</div></div>';
}

export function renderPanel(tab, v) {
  if (tab === 'map') return mapPanel(v);
  if (tab === 'garage') return garagePanel(v);
  if (tab === 'freight') return freightPanel(v);
  return '';
}
