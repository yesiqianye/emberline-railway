import { icon } from './icons.mjs?v=3';

const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const short = new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: 4 });

function format(value) {
  if (value >= 1e12) return value.toExponential(2);
  if (value >= 1e8) return short.format(value / 1e8) + '亿';
  if (value >= 1e4) return short.format(value / 1e4) + '万';
  if (value > 0 && value < 1) return short.format(value);
  return number.format(value);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function actionButton(action, label, style = '', accessibleName = label) {
  return '<button type="button" class="ws-button ' + style + '" data-action="' + esc(action.type) + '" data-id="' +
    esc(action.id) + '" aria-label="' + esc(accessibleName) + '"' + (action.enabled ? '' : ' disabled') + '>' + esc(label) + '</button>';
}

export { actionButton, esc as escapeHTML, format as formatWorkshopNumber };

function garageLink(label) {
  return '<a class="ws-link" href="#garage" data-rail-focus="rail-engineering">' + label + icon('arrow') + '</a>';
}

function railwayUses(v) {
  const { available, projects } = v.railworks;
  const blueprintNote = projects.every(p => p.level === p.max)
    ? '三项铁路工程均已完全安装' : '可用 ' + format(available) + ' 张 · 在车库安装永久改装';
  return '<div class="ws-uses"><div>' + icon('cargo') +
    '<div><strong>机件上车</strong><span>' + (v.finished ? '海湾环运班列可持续托运与快修' : '托运备件赚运票，途中快修缩短行程') +
    '</span></div><a class="ws-link" href="#cab" data-rail-focus="rail-dispatch">去驾驶台' + icon('arrow') + '</a></div>' +
    '<div>' + icon('book') + '<div><strong>铁路蓝图</strong><span>' + blueprintNote + '</span></div>' +
    garageLink('去车库') + '</div></div>';
}

function stage(w) {
  return w.tiers[2].purchased ? 3 : w.tiers[1].purchased ? 2 : 1;
}

function milestoneMeter(w) {
  const next = w.nextMilestone;
  if (!next) return '<div class="ws-goal ws-complete">' + icon('check') + '本代产量里程碑已全部达成</div>';
  const amount = Math.min(next.target, w.earned);
  return '<div class="ws-goal"><div><span>下一里程碑 · ' + esc(next.name) + ' · 工坊产量 ×' + format(next.multiplier) + '</span>' +
    '<small>本代累计 ' + format(amount) + ' / ' + format(next.target) + ' 机件</small></div>' +
    '<progress aria-label="下一产量里程碑" value="' + amount + '" max="' + next.target + '"></progress></div>';
}

function quickPurchase(tier, w) {
  const action = tier.actions['1'];
  const current = tier.id === 'lathe' ? w.perSecond : tier.perSecond;
  const next = current + action.deltaPerSecond;
  const hint = tier.purchased ? '' : '<small>' + esc(tier.id === 'lathe' ? '购入后自动生产机件' :
    '购入后自动制造' + tier.output) + '</small>';
  return '<div class="ws-quick-item"><div><strong>' + esc(tier.name) + '</strong>' + hint +
    '<small class="ws-preview">' + esc(tier.output) + ' / 秒 <b>' + format(current) +
    '</b><span aria-label="购入后为"> → </span><b>' + format(next) + '</b></small></div>' +
    actionButton(action, '购入 · ' + format(action.cost) + ' 机件', action.enabled ? 'ws-primary' : '', '购置'+tier.name+'，'+format(action.cost)+' 机件') + '</div>';
}

export function renderWorkshopSummary(v) {
  const w = v.workshop;
  const activeStage = stage(w);
  const visibleTiers = w.tiers.slice(0, Math.min(3, activeStage + (w.tiers[0].purchased > 0 ? 1 : 0)));
  return '<section class="ws ws-summary" aria-labelledby="ws-cab-title"><header class="ws-head"><h2 id="ws-cab-title">' +
    icon('garage') + '车载工坊</h2><a href="#workshop">进入工坊 ' + icon('arrow') + '</a></header>' +
    '<div class="ws-summary-content"><div class="ws-account"><span>机件库存</span><b>' + format(w.parts) +
    '</b><small>+' + format(w.perSecond) + ' 机件 / 秒</small><a class="ws-link" href="#cab" data-rail-focus="rail-dispatch">托运 / 快修 ' + icon('arrow') + '</a></div><div class="ws-quick-list">' +
    visibleTiers.map(tier => quickPurchase(tier,w)).join('') + '</div></div>' + milestoneMeter(w) + '</section>';
}

function quantitySelector(quantity) {
  return '<div class="ws-quantity" role="group" aria-label="每次购入数量"><small>购入数量</small>' +
    [['1','1 台'],['10','10 台'],['max','最大']].map(([value, label]) =>
      '<button type="button" data-workshop-quantity="' + value + '" aria-pressed="' + (quantity === value) +
      '">' + label + '</button>').join('') + '</div>';
}

function equipment(tier, quantity) {
  const action = tier.actions[quantity];
  const generated = Math.max(0, tier.owned - tier.purchased);
  const effect = '<small>购后 ' + format(action.afterPerSecond) + ' ' + esc(tier.output) + ' / 秒</small>';
  const price = action.quantity > 0 ? action.cost : tier.unitCost;
  const costText = (action.quantity > 0 ? '本批总价' : '下一台') + ' ' + format(price) + ' 机件';
  const buy = action.quantity > 0 ? '购入 ' + format(action.quantity) + ' 台' : '暂不可购';
  return '<article class="ws-equipment"><div class="ws-equip-label"><h3>' + esc(tier.name) + '</h3><p>' +
    esc(tier.description) + '</p><small>持有 <b>' + format(tier.owned) + '</b> 台 · 购入 ' +
    format(tier.purchased) + ' · 自产 ' + format(generated) + '</small></div><div class="ws-equip-flow"><strong>' +
    format(tier.perSecond) + ' <small>' + esc(tier.output) + ' / 秒</small></strong>' + effect +
    '</div><div class="ws-purchase"><small>' + costText + '</small>' + actionButton(action,buy,'',tier.name+' · '+buy) +
    (!action.enabled && action.reason ? '<small class="ws-reason">' + esc(action.reason) + '</small>' : '') +
    '</div></article>';
}

function milestoneSection(w) {
  return '<section class="ws-card"><header class="ws-head"><h2>' + icon('flag') + '产量里程碑</h2></header>' +
    milestoneMeter(w) + '<ol class="ws-milestones">' + w.milestones.map(m =>
      '<li class="' + (m.reached ? 'ws-met' : '') + '"><span class="ws-node">' + (m.reached ? icon('check') : '') +
      '</span><div><strong>' + esc(m.name) + '</strong><small>累计产出 ' + format(m.target) + ' 机件</small></div>' +
      '<b>×' + format(m.multiplier) + '</b></li>').join('') + '</ol></section>';
}

function generations(v, confirm) {
  const w = v.workshop;
  const p = w.prestige;
  const retain = '铁路进度、已装车的备件、永久改装和蓝图一并保留。';
  const ledger = '<dl><div><dt>历代获得蓝图</dt><dd>' + format(w.blueprints) +
    '</dd></div><div><dt>可用于改装</dt><dd>' + format(v.railworks.available) + ' 张</dd></div></dl>';
  const engineering = '<p>每张蓝图增加 65% 基础工坊产量，还可用于改装机车。安装改装后，生产加成继续生效。</p>' +
    garageLink('查看铁路改装');
  const resets = '本代机件、设备和产量里程碑重新开始。';
  if (!p.enabled) {
    const unlock = p.nextGainTarget ? '本代累计产出 ' + format(p.threshold) +
      ' 机件即可换代，获得一张永久蓝图。' : esc(p.reason);
    return '<section class="ws-card ws-generation"><header class="ws-head"><h2>' + icon('book') +
      '蓝图换代</h2><span>第 ' + w.generation + ' 代</span></header><div class="ws-generation-body">' +
      ledger + '<p>' + unlock + '</p>' + engineering + '</div></section>';
  }
  const preview = '<div class="ws-effects"><h3>换代后</h3><dl><div><dt>工坊起步倍率</dt><dd>×' +
    format(p.afterMultiplier) + '</dd></div><div><dt>可用于铁路改装</dt><dd>' + format(v.railworks.available + p.gain) +
    ' 张</dd></div><div><dt>煤钢产量倍率</dt><dd>×' + format(p.afterRailMultiplier) +
    '</dd></div><div><dt>下次发车速度加成</dt><dd>+' + format(p.trainSpeedPercentAfter) + '%</dd></div></dl></div>';
  const panel = confirm && p.enabled ?
    '<div class="ws-confirm" role="group" aria-label="确认工坊换代"><strong>确认开启第 ' + (w.generation + 1) +
    ' 代工坊？</strong><p>' + resets + retain + '</p><div class="ws-confirm-controls"><button class="ws-button" ' +
    'type="button" data-workshop-confirm="cancel">继续本代</button>' + actionButton(p, '确认换代 · +' + format(p.gain) +
    ' 蓝图', 'ws-primary') + '</div></div>' :
    '<button class="ws-button" data-workshop-confirm="open" type="button"' + (p.enabled ? '' : ' disabled') + '>预览换代</button>';
  return '<section class="ws-card ws-generation"><header class="ws-head"><h2>' + icon('book') +
    '蓝图换代</h2><span>第 ' + w.generation + ' 代</span></header><div class="ws-generation-body">' +
    ledger + '<p>本次换代可获得 <strong>' + format(p.gain) + ' 张蓝图</strong>。' +
    (p.nextGainTarget ? '本代累计产出达到 ' + format(p.nextGainTarget) + ' 机件可再多得一张。' : '') + '</p>' +
    engineering + (confirm && p.enabled ? '' : '<p>' + resets + retain + '</p>') + preview + panel + '</div></section>';
}

export function renderWorkshop(v, {quantity = '1', confirmPrestige = false} = {}) {
  const w = v.workshop;
  const q = ['1','10','max'].includes(String(quantity)) ? String(quantity) : '1';
  const level = stage(w);
  const captions = ['车床工位','装配车间','自动生产线'];
  return '<div class="ws ws-page"><section class="ws-card"><div class="ws-art"><img src="./art/workshop-' +
    level + '.webp" alt="' + captions[level-1] + '"><div class="ws-art-text"><span>第 ' + w.generation +
    ' 代工坊</span><h2>' + captions[level-1] + '</h2></div></div>' +
    '<dl class="ws-figures"><div><dt>机件库存</dt><dd>' + format(w.parts) + '</dd></div><div><dt>机件 / 秒</dt><dd>+' +
    format(w.perSecond) + '</dd></div><div><dt>工坊产量倍率</dt><dd>×' + format(w.multiplier) +
    '</dd></div></dl>' + railwayUses(v) + '<p class="ws-rail">' + icon('train') + '煤钢产量 ×' + format(w.railMultiplier) + ' · 发车速度 +' + format(w.trainSpeedPercent) + '% · 每开通一站，工坊基础产速增加 8%。</p></section><section class="ws-card"><header class="ws-head"><h2>' + icon('garage') +
    '设备生产链</h2>' + quantitySelector(q) + '</header><p class="ws-chain">自带工作台每秒生产 1 机件。车床增加机件产量，装配台制造车床，自动产线制造装配台。</p>' +
    w.tiers.map(t => equipment(t, q)).join('') + '</section><div class="ws-sidegrid">' + milestoneSection(w) +
    generations(v,confirmPrestige) + '</div></div>';
}
