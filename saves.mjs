import { newGame, restore } from './engine.mjs?v=3';

const KEY = 'emberline.railway.save.v1';
const BACKUP = KEY + '.previous';
const SOUND = 'emberline.railway.sound';
let baseline;
let baselineValid = false;
let backupAt = 0;
let issue = '';
let recovered = false;
let report = () => {};

function setIssue(value) {
  const changed = issue !== value;
  issue = value;
  if (changed && value) report(value);
}

const issueMessages = {
  conflict: '另一窗口已更新存档。请在设置中载入最新进度。',
  blocked: '本机存档暂时不可用。可在设置中导出进度。',
  damaged: '本机存档无法读取。请导入备份或重新启程。',
};

export function loadGame() {
  issue = '';
  recovered = false;
  baselineValid = false;
  try {
    baseline = localStorage.getItem(KEY);
    if (baseline !== null) {
      try {
        const state = restore(baseline);
        baselineValid = true;
        return state;
      } catch {
        // A previous known-good snapshot can recover an interrupted or damaged save.
      }
    }
    const previous = localStorage.getItem(BACKUP);
    if (previous) {
      try {
        const state = restore(previous);
        recovered = true;
        return state;
      } catch {
        // Keep both snapshots untouched until the player chooses a replacement.
      }
    }
    if (baseline !== null || previous !== null) setIssue('damaged');
  } catch {
    baseline = undefined;
    setIssue('blocked');
  }
  return newGame();
}

function persist(state, explicitReplacement = false) {
  if (issue === 'conflict' || (issue === 'damaged' && !explicitReplacement)) return false;
  try {
    const current = localStorage.getItem(KEY);
    if (baseline === undefined && current !== null || baseline !== undefined && current !== baseline) {
      setIssue('conflict');
      return false;
    }
    const next = JSON.stringify(state);
    if (next !== current) {
      const now = Date.now();
      if (baselineValid && current && (explicitReplacement || now - backupAt >= 60000)) {
        try {
          localStorage.setItem(BACKUP, current);
          backupAt = now;
        } catch {
          // A full store may still have space to replace the primary snapshot.
        }
      }
      localStorage.setItem(KEY, next);
    }
    baseline = next;
    baselineValid = true;
    setIssue('');
    return true;
  } catch {
    setIssue('blocked');
    return false;
  }
}

export function saveGame(state) {
  return persist(state);
}

function getSound() {
  try { return localStorage.getItem(SOUND) === 'on'; } catch { return false; }
}

export function setupSettings({ getState, replaceState, notify }) {
  let enabled = getSound();
  let audioContext;
  let incoming = null;
  let intent = '';
  const dialog = document.createElement('dialog');
  dialog.className = 'rail-settings';
  dialog.setAttribute('aria-labelledby', 'rail-settings-title');
  dialog.innerHTML = `
    <div class="rs-card">
      <header class="rs-head"><h2 id="rail-settings-title">行车设置</h2>
        <button type="button" class="rs-close" aria-label="关闭设置" data-setting="close" autofocus>×</button></header>
      <div class="rs-body">
        <div class="rs-line"><div><h3>机车音效</h3><p>操作提示音与发车汽笛</p></div>
          <button type="button" data-setting="sound" class="rs-switch" role="switch" aria-label="机车音效"><span></span></button></div>
        <div class="rs-block"><h3>行车存档</h3><p data-rs-status></p>
          <div class="rs-actions"><button type="button" data-setting="export">导出备份</button><button type="button" data-setting="import">导入备份</button>
          <button type="button" data-setting="reload" hidden>载入最新进度</button></div>
          <input type="file" hidden data-rs-file accept=".json,application/json,text/plain"></div>
        <div class="rs-line"><div><h3>重新启程</h3><p>从余烬机务段开始新旅程</p></div>
          <button type="button" data-setting="reset" class="rs-danger">重置进度</button></div>
        <div class="rs-confirm" data-rs-confirm hidden><p data-rs-prompt></p>
          <div class="rs-actions"><button type="button" data-setting="cancel">取消</button>
          <button type="button" data-setting="apply" class="rs-primary">确认</button></div></div>
        <p class="rs-feedback" data-rs-feedback role="status"></p>
      </div>
    </div>`;
  document.body.append(dialog);
  const el = selector => dialog.querySelector(selector);
  const setFeedback = message => { el('[data-rs-feedback]').textContent = message; };
  function refresh() {
    el('[data-rs-status]').textContent = issueMessages[issue] || '进度自动保存在此浏览器。换设备时可导出备份。';
    el('[data-setting="reload"]').hidden = issue !== 'conflict';
    el('[data-setting="sound"]').setAttribute('aria-checked', String(enabled));
  }
  report = value => {
    refresh();
    if (issueMessages[value]) notify(issueMessages[value]);
  };
  if (issue) queueMicrotask(() => report(issue));
  else if (recovered) queueMicrotask(() => notify('已从上一份本机备份恢复旅程。'));

  window.addEventListener('storage', event => {
    if (event.key === SOUND || event.key === null) { enabled = getSound(); refresh(); }
    if (event.key === KEY || event.key === null) {
      try {
        if (localStorage.getItem(KEY) !== baseline) setIssue('conflict');
      } catch { setIssue('blocked'); }
    }
  });

  function play(type) {
    if (!enabled) return;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      audioContext ||= new Context();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      const begin = audioContext.currentTime;
      const tones = type === 'depart' ? [[311, 0, 0.24], [392, 0.04, 0.27]]
        : type === 'stoke' ? [[104, 0, 0.06], [155, 0.03, 0.10]]
        : [[330, 0, 0.08], [495, 0.06, 0.12]];
      for (const [frequency, delay, duration] of tones) {
        const start = begin + delay;
        const oscillator = audioContext.createOscillator();
        const volume = audioContext.createGain();
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(frequency, start);
        volume.gain.setValueAtTime(0.0001, start);
        volume.gain.exponentialRampToValueAtTime(0.045, start + 0.015);
        volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(volume).connect(audioContext.destination);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.01);
        oscillator.onended = () => { oscillator.disconnect(); volume.disconnect(); };
      }
    } catch { /* Audio output is optional on muted or unsupported devices. */ }
  }
  function toggleSound() {
    enabled = !enabled;
    try { localStorage.setItem(SOUND, enabled ? 'on' : 'off'); } catch {}
    refresh();
    if (enabled) play('click');
    return enabled;
  }

  function clearIntent() {
    intent = '';
    incoming = null;
    el('[data-rs-confirm]').hidden = true;
  }
  function confirmAction(action, prompt) {
    intent = action;
    setFeedback('');
    el('[data-rs-prompt]').textContent = prompt;
    el('[data-rs-confirm]').hidden = false;
    el('[data-setting="cancel"]').focus();
  }
  function open() {
    clearIntent();
    setFeedback('');
    refresh();
    if (!dialog.open) dialog.showModal();
  }
  function exportBackup() {
    const blob = new Blob([JSON.stringify(getState())], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '余烬铁路-' + new Date().toISOString().slice(0, 10) + '.json';
    dialog.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setFeedback('已生成备份文件。');
  }
  let fileRead = 0;
  dialog.addEventListener('close', () => { ++fileRead; clearIntent(); });
  el('[data-rs-file]').addEventListener('change', async event => {
    const input = event.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const sequence = ++fileRead;
    clearIntent();
    try {
      if (file.size > 1024 * 1024) throw Error();
      const text = await file.text();
      if (sequence !== fileRead || !dialog.open) return;
      restore(text); // The current save stays intact until validation and confirmation both succeed.
      incoming = text;
      confirmAction('import', '使用这份备份替换当前旅程？');
    } catch {
      if (sequence === fileRead) setFeedback('无法读取这份备份，请选择有效的余烬铁路存档。');
    }
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) { dialog.close(); return; }
    const button = event.target.closest('[data-setting]');
    if (!button) return;
    switch (button.dataset.setting) {
      case 'close': dialog.close(); break;
      case 'sound': toggleSound(); break;
      case 'export': exportBackup(); break;
      case 'import': clearIntent(); el('[data-rs-file]').click(); break;
      case 'reset': ++fileRead; confirmAction('reset', '确定清除当前进度并重新启程？可以先导出备份。'); break;
      case 'cancel': clearIntent(); break;
      case 'reload': {
        const latest = loadGame();
        if (issue) { setFeedback(issueMessages[issue]); refresh(); break; }
        replaceState(latest); refresh(); setFeedback('已载入最新进度。'); break;
      }
      case 'apply': {
        if (!intent) break;
        try {
          const state = intent === 'reset' ? newGame() : restore(incoming);
          const ok = persist(state, true);
          if (!ok && issue !== 'blocked') { setFeedback(issueMessages[issue]); break; }
          replaceState(state);
          notify((intent === 'reset' ? '新的旅程已开始。' : '已导入备份。') + (ok ? '' : '本次进度仅保存在当前窗口。'));
          dialog.close();
        } catch { setFeedback('存档校验失败，请重新选择备份。'); }
        break;
      }
    }
  });
  return {open, toggleSound, isSoundOn: () => enabled, play};
}
