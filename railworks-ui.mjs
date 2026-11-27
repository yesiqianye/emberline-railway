import { icon } from './icons.mjs?v=3';
import { actionButton, escapeHTML as esc, formatWorkshopNumber as format } from './workshop-ui.mjs?v=6';

const exact = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 });

function actionRow(action, label, name, settled = false) {
  const reason = !action.enabled && !settled && action.reason
    ? '<small class="rw-reason">' + esc(action.reason) + '</small>' : '';
  return '<div class="rw-action">' + actionButton(action,label,'',name) + reason + '</div>';
}

export function renderRailDispatch(v) {
  const { parts, cargo, repair } = v.railworks;
  const destination = esc(v.leg.destination);
  const cargoStatus = cargo.loaded ? '备件已装车，抵达' + destination + '时结算。'
    : '发车前或途中均可装一批，抵达' + destination + '时结算。';
  const premium = cargo.blueprintPremium ? ' 报价含蓝图加价 ' + format(cargo.blueprintPremium) + ' 运票。' : '';
  const timeStatus = repair.used ? '本程已快修，到下一站后补充检修机会。'
    : '每程可用一次，按发车时全程的 ' + format(repair.percent) + '% 抵扣剩余时间。';
  const saving = v.leg.traveling && repair.unlocked && repair.saved > 0
    ? '本次提前 ' + exact.format(repair.saved) + ' 秒' : '全程的 ' + format(repair.percent) + '%';
  const cost = (offer, generation = '') => '<span>' + generation + exact.format(offer.cost) + ' 机件</span>' + icon('arrow');
  const generation = '第 ' + repair.requiredGeneration + ' 代起 · ';
  return '<section id="rail-dispatch" tabindex="-1" class="ws ws-card rw-panel rw-dispatch" aria-labelledby="rw-dispatch-title">' +
    '<header class="ws-head"><h2 id="rw-dispatch-title">' + icon('cargo') + '随车备件</h2><a href="#workshop">工坊库存 ' +
    format(Math.floor(parts)) + ' 机件' + icon('arrow') + '</a></header><div class="rw-choices">' +
    '<article class="rw-choice"><h3>' + icon('ticket') + '备件托运</h3><div class="rw-trade">' +
    (cargo.loaded ? '' : cost(cargo)) + '<strong>到站 +' + exact.format(cargo.tickets) +
    ' 运票</strong></div><p>' + cargoStatus + premium + '</p>' + actionRow(cargo.action,cargo.loaded ? '本程已装车' : '装运备件',
      cargo.loaded ? '本程已装车' : '装运备件，花费 ' + cargo.cost + ' 机件，到站加收 ' + cargo.tickets + ' 运票',cargo.loaded) +
    '</article><article class="rw-choice"><h3>' + icon('clock') + '行车快修</h3>' +
    (repair.used ? '' : '<div class="rw-trade">' + cost(repair, generation) + '<strong>' + saving + '</strong></div>') +
    '<p>' + timeStatus + '</p>' + actionRow(repair.action,repair.used ? '本程已快修' : '执行快修',
      repair.used ? '本程已快修' : '执行快修，花费 ' + repair.cost + ' 机件',repair.used) + '</article></div></section>';
}

function projectCard(project) {
  const maxed = project.level >= project.max;
  const status = '<span class="rw-level" aria-label="已安装 ' + project.level + ' 级，上限 ' + project.max + ' 级">' +
    '<i aria-hidden="true">' + Array.from({length: project.max}, (_, index) =>
      '<i class="' + (index < project.level ? 'rw-filled' : '') + '"></i>').join('') + '</i>' +
    project.level + ' / ' + project.max + '</span>';
  const effect = '<div class="rw-change"><span>当前</span><b>' + esc(project.effect) + '</b>' +
    (maxed ? '' : '<span>下一级</span><strong>' + esc(project.nextEffect) + '</strong>') + '</div>';
  const label = maxed ? '已完全安装' : (project.level ? '升级' : '安装') + ' · ' + project.cost + ' 张蓝图';
  return '<article class="rw-project"><header><h3>' + esc(project.name) + '</h3>' + status + '</header>' +
    '<p>' + esc(project.description) + '</p>' + effect +
    actionRow(project.action,label,project.name + '，' + label,maxed) + '</article>';
}

function railwayQuote(v) {
  const route = v.routes.find(option => option.selected);
  const { coal, tickets } = route.savings;
  return '<div class="rw-quote"><span>' + (v.leg.traveling ? '本程已发车' : '下趟预算') + ' · ' + esc(route.name) + '</span>' +
    '<div>发车用煤 <b>' + exact.format(route.cost.coal) + '</b>' + (coal ? '<em>改装省 ' + exact.format(coal) + '</em>' : '') +
    '</div><div>到站运票 <b>' + exact.format(route.award.tickets) + '</b>' + (tickets ? '<em>改装 +' + exact.format(tickets) + '</em>' : '') +
    (route.cargoTickets ? '<em>托运 +' + exact.format(route.cargoTickets) + '</em>' : '') + '</div></div>';
}

export function renderRailEngineering(v) {
  const r = v.railworks;
  const guide = r.projects.every(project => project.level === project.max)
    ? '三项工程均已安装至第 5 级。累计超过 18 张蓝图后，每多一张，环运托运每批多赚一张运票。'
    : '每项工程可升 5 级，依次花费 1、3、9、27、81 张蓝图。';
  return '<section id="rail-engineering" tabindex="-1" class="ws ws-card rw-panel rw-engineering" aria-labelledby="rw-engineering-title">' +
    '<header class="ws-head"><h2 id="rw-engineering-title">' + icon('book') + '铁路工程图</h2><a href="#workshop">前往工坊' +
    icon('arrow') + '</a></header><div class="rw-ledger"><div><span>可用蓝图</span><strong>' + format(r.available) +
    ' <small>张</small></strong></div><p>' + guide +
    '<small>累计获得 ' + format(r.blueprints) + ' 张 · 已投入 ' + format(r.spent) + ' 张</small></p></div>' +
    railwayQuote(v) + '<div class="rw-projects">' + r.projects.map(projectCard).join('') + '</div></section>';
}
