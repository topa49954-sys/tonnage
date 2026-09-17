/* =====================================================================
   ТОННАЖ — интерфейс
   ===================================================================== */

import { EX, PATTERNS, GROUPS, groupOf } from './exercises.js';
import { planWorkout, journey, layoffAdvice, position, WEEKS, e1rm, lastPerformance, WORKOUTS_PER_BLOCK } from './engine.js';
import { store, todayKey } from './store.js';
import { ADAPTERS, adapterById } from './adapters/index.js';
import { makeFigure, releaseFigures, attachFigure, detachFigure } from './figure.js';
import { lineChart, barChart } from './charts.js';

/* ------------------------------- хелперы ------------------------------- */

const $ = (s, r = document) => r.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const fmtDate = k => { const [, m, d] = k.split('-'); return `${d}.${m}`; };
const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const DOW = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) {
    if (k === null || k === undefined || k === false) continue;
    n.appendChild(typeof k === 'object' ? k : document.createTextNode(String(k)));
  }
  return n;
}
const icon = d => el('span', { html: `<svg viewBox="0 0 24 24" aria-hidden="true" style="width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round">${d}</svg>` });

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}

/* ------------------------------- звук ------------------------------- */
/* iOS не даёт запустить звук без жеста пользователя, поэтому аудио-контекст
   открываем на первом касании экрана, а не в момент сигнала таймера. */
let actx = null;
function primeAudio() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    g.gain.value = 0.0001; o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + 0.02);
  } catch { actx = null; }
}
['pointerdown', 'touchstart', 'keydown'].forEach(ev =>
  document.addEventListener(ev, primeAudio, { once: true, passive: true }));

function beep() {
  if (!store.state.settings.sound) return;
  try { navigator.vibrate && navigator.vibrate([180, 90, 180]); } catch {}
  try {
    primeAudio();
    if (!actx) return;
    if (actx.state === 'suspended') actx.resume();
    [0, 0.22, 0.44].forEach((d, i) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'sine'; o.frequency.value = i === 2 ? 1046 : 784;
      g.gain.setValueAtTime(0.0001, actx.currentTime + d);
      g.gain.exponentialRampToValueAtTime(0.3, actx.currentTime + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d + 0.18);
      o.connect(g); g.connect(actx.destination);
      o.start(actx.currentTime + d); o.stop(actx.currentTime + d + 0.2);
    });
  } catch {}
}

/* ------------------------------- таймер ------------------------------- */
/* Считается от метки времени окончания, а не тиками: когда телефон гасит
   экран, интервалы тормозят, и отсчёт «по тикам» врёт на десятки секунд. */
let timer = { on: false, endAt: 0, total: 0, iv: null, fired: false };
const timeLeft = () => Math.max(0, Math.round((timer.endAt - Date.now()) / 1000));

function startTimer(sec, label) {
  timer = { on: true, total: sec, endAt: Date.now() + sec * 1000, iv: null, fired: false };
  $('#tLab').textContent = label || 'Отдых между подходами';
  $('#timerbar').hidden = false;
  paintTimer();
  timer.iv = setInterval(tickTimer, 250);
}
function tickTimer() {
  if (!timer.on) return;
  paintTimer();
  if (timeLeft() <= 0 && !timer.fired) { timer.fired = true; beep(); stopTimer(); }
}
function stopTimer() { timer.on = false; clearInterval(timer.iv); $('#timerbar').hidden = true; }
function paintTimer() {
  const m = timeLeft();
  $('#tLeft').textContent = Math.floor(m / 60) + ':' + pad(m % 60);
  const C = 2 * Math.PI * 16;
  $('#ringFg').setAttribute('stroke-dasharray', C);
  $('#ringFg').setAttribute('stroke-dashoffset', (C * (1 - m / (timer.total || 1))).toFixed(1));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) tickTimer(); });

/* ------------------------------- блины ------------------------------- */

const PLATES = [
  { w: 25, c: '#c0392b', h: 56 }, { w: 20, c: '#1b5fd9', h: 54 }, { w: 15, c: '#d9a400', h: 50 },
  { w: 10, c: '#2e8b57', h: 44 }, { w: 5, c: '#ffffff', h: 34 }, { w: 2.5, c: '#111418', h: 28 },
  { w: 1.25, c: '#8a94a6', h: 22 }
];
function calcPlates(total, bar) {
  let side = (total - bar) / 2;
  const out = [];
  if (side <= 0) return { out, rest: 0, side: 0 };
  for (const p of PLATES) while (side >= p.w - 1e-9) { out.push(p); side = +(side - p.w).toFixed(3); }
  return { out, rest: +side.toFixed(2), side: (total - bar) / 2 };
}

/* ------------------------------- шторка ------------------------------- */

/* Закрытие шторки доигрывает анимацию и только потом чистит содержимое.
   Если за это время открыли новую шторку (выбрал оценку — сразу показываем
   итог), отложенная чистка обязана отмениться, иначе она сотрёт уже новый
   экран через полсекунды после его появления. */
let sheetCloseTimer = null;

function openSheet(build) {
  clearTimeout(sheetCloseTimer);
  sheetCloseTimer = null;
  const inner = $('#sheetInner');
  inner.innerHTML = '';
  inner.appendChild(el('div', { class: 'sheet-grab' }, el('i', {})));
  inner.appendChild(build());
  $('#scrim').hidden = false; $('#sheet').hidden = false;
  $('#sheet').scrollTop = 0;
  requestAnimationFrame(() => { $('#scrim').classList.add('open'); $('#sheet').classList.add('open'); });
  document.body.style.overflow = 'hidden';
}

function closeSheet() {
  $('#scrim').classList.remove('open'); $('#sheet').classList.remove('open');
  document.body.style.overflow = '';
  clearTimeout(sheetCloseTimer);
  sheetCloseTimer = setTimeout(() => {
    sheetCloseTimer = null;
    $('#scrim').hidden = true; $('#sheet').hidden = true; $('#sheetInner').innerHTML = '';
  }, 220);
}
$('#scrim').addEventListener('click', closeSheet);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

/* =====================================================================
   ЭКРАНЫ
   ===================================================================== */

const TABS = [
  { k: 'today', n: 'Сегодня', t: 'Сегодня', ic: '<path d="M4 7h16M4 12h10M4 17h7"/><circle cx="18" cy="16.5" r="3.5"/>' },
  { k: 'path',  n: 'Путь',    t: 'Пройденный путь', ic: '<path d="M4 19V5M4 19h16"/><path d="M7.5 15l3.5-4 3 2.5 4.5-6"/>' },
  { k: 'lib',   n: 'База',    t: 'База упражнений', ic: '<path d="M5 9v6M19 9v6M2.5 11v2M21.5 11v2M8 7v10M16 7v10M8 12h8"/>' },
  { k: 'more',  n: 'Ещё',     t: 'Питание и настройки', ic: '<circle cx="12" cy="5.5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="18.5" r="1.6"/>' }
];

let screen = 'today';
const go = k => { screen = k; scrollTo({ top: 0 }); render(); };

function render() {
  if (!store.connected) return renderGate();
  $('#gate').hidden = true;
  $('#app').hidden = false;
  $('#tabbarWrap').hidden = false;

  releaseFigures();

  const bar = $('#tabbar');
  bar.innerHTML = '';
  for (const t of TABS) {
    bar.appendChild(el('button', { class: 'tab', role: 'tab', 'aria-selected': screen === t.k, onclick: () => go(t.k) },
      icon(t.ic), el('span', {}, t.n)));
  }
  for (const t of TABS) $('#scr-' + t.k).hidden = t.k !== screen;
  $('#scrTitle').textContent = TABS.find(t => t.k === screen).t;

  renderSyncDot();
  if (screen === 'today') renderToday();
  if (screen === 'path') renderPath();
  if (screen === 'lib') renderLib();
  if (screen === 'more') renderMore();
}

function renderSyncDot() {
  const d = $('#syncdot');
  const s = store.status;
  let cls = 'syncdot', txt = store.adapter?.name || 'локально';
  if (s.syncing) { cls += ' busy'; txt = 'сохраняю'; }
  else if (store.adapter?.needsNetwork && !s.online) { cls += ' off'; txt = 'офлайн'; }
  else if (s.error) { cls += ' err'; txt = 'нет связи'; }
  else if (store.hasPending()) { cls += ' busy'; txt = 'ждёт отправки'; }
  d.className = cls;
  d.innerHTML = '';
  d.append(el('i', {}), el('span', {}, txt));
}

/* ------------------------------- ВХОД ------------------------------- */

let gatePick = null;   // выбранное, но ещё не подключённое хранилище

function renderGate() {
  $('#app').hidden = true;
  $('#tabbarWrap').hidden = true;
  $('#gate').hidden = false;
  const box = $('#gateBox');
  box.innerHTML = '';

  box.append(
    el('div', { class: 'gate-logo' }, 'Тоннаж'),
    el('div', { class: 'gate-sub' }, 'Дневник тренировок')
  );

  if (!gatePick) {
    box.append(
      el('div', { class: 'eyebrow', style: 'text-align:center;margin-top:4px' }, 'Где хранить дневник'),
      ...ADAPTERS.map(a => el('button', {
        class: 'lib-item', style: 'align-items:flex-start',
        onclick: () => { gatePick = a.id; renderGate(); }
      },
        el('div', { style: 'min-width:0' },
          el('div', { class: 'exrow-name' }, a.name),
          el('div', { class: 'muted', style: 'font-size:12px;margin-top:3px;line-height:1.4' }, a.tagline))
      )),
      el('div', { class: 'muted', style: 'font-size:11.5px;text-align:center;line-height:1.5;margin-top:4px' },
        'Хранилище можно сменить в любой момент — дневник переедет вместе с тобой.')
    );
    return;
  }

  const a = adapterById(gatePick);
  const inputs = {};
  const err = el('div', { class: 'err' });
  const btn = el('button', { class: 'btn btn-primary btn-wide' }, 'Подключить');

  const connect = async () => {
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Проверяю…';
    try {
      const cfg = {};
      for (const f of a.fields) cfg[f.key] = inputs[f.key].value.trim();
      const res = await store.connect(a.id, cfg);
      gatePick = null;
      render();
      if (res?.warn) toast(res.warn);
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
      btn.textContent = 'Подключить';
    }
  };
  btn.addEventListener('click', connect);

  const saved = store.conn?.adapterId === a.id ? store.conn.cfg : {};

  box.append(
    el('button', { class: 'btn btn-s', style: 'align-self:flex-start', onclick: () => { gatePick = null; renderGate(); } },
      '← Другое хранилище'),
    el('div', { class: 'card stack-s' },
      el('div', { class: 'h2' }, a.name),
      el('div', { class: 'muted', style: 'font-size:12.5px' }, a.tagline),
      a.warn && el('div', { class: 'coach warn', style: 'margin-top:4px' },
        el('div', { class: 'ic' }, '!'), el('div', {}, a.warn))),
    a.help.length && el('div', { class: 'card stack-s' },
      el('div', { class: 'eyebrow' }, 'Что сделать один раз'),
      el('ol', { class: 'cuelist' }, ...a.help.map(h => el('li', {}, el('span', { html: mdBold(h) })))))
  );

  for (const f of a.fields) {
    inputs[f.key] = el('input', {
      type: f.type === 'password' ? 'password' : 'text',
      id: 'cfg-' + f.key, placeholder: f.placeholder || '',
      value: saved[f.key] || '',
      autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false'
    });
    inputs[f.key].addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });
    box.appendChild(el('div', { class: 'field' },
      el('label', { for: 'cfg-' + f.key }, f.label + (f.optional ? ' — необязательно' : '')),
      inputs[f.key]));
  }

  // Telegram: подставляем chat_id сами, чтобы не искать его вручную
  if (a.id === 'telegram') {
    box.appendChild(el('button', {
      class: 'btn btn-s', onclick: async ev => {
        const b = ev.currentTarget;
        err.textContent = '';
        b.disabled = true; b.textContent = 'Ищу…';
        try {
          const r = await a.discoverChat({ token: inputs.token.value.trim() });
          inputs.chatId.value = r.chatId;
          toast('Чат найден' + (r.title ? ': ' + r.title : ''));
        } catch (ex) {
          err.textContent = ex.message;
        }
        b.disabled = false; b.textContent = 'Определить чат';
      }
    }, 'Определить чат'));
  }

  box.append(err, btn);
  if (a.fields.length) setTimeout(() => inputs[a.fields[0].key]?.focus(), 100);
}

/* Минимальная поддержка **жирного** в подсказках — таблицу тегов
   разводить ради этого незачем, а текст без выделения читается хуже. */
const mdBold = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/`(.+?)`/g, '<code style="font-family:var(--mono);font-size:.92em;background:var(--card-2);padding:1px 4px;border-radius:4px">$1</code>');

/* ------------------------------- СЕГОДНЯ ------------------------------- */

function renderToday() {
  const root = $('#scr-today');
  root.innerHTML = '';
  const d = new Date();
  $('#scrSub').textContent = `${DOW[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;

  root.appendChild(store.state.current ? activeWorkout() : workoutPreview());
}

function currentPlan() {
  return store.state.current?.plan || planWorkout(store.state.sessions, store.state.sessions.length);
}

function workoutPreview() {
  const box = el('div', { class: 'stack' });
  const plan = planWorkout(store.state.sessions, store.state.sessions.length);
  const j = journey(store.state.sessions);
  const layoff = layoffAdvice(store.state.sessions);

  const bars = [];
  for (let i = 0; i < WORKOUTS_PER_BLOCK; i++) {
    bars.push(el('i', { class: i < j.inBlock ? 'done' : i === j.inBlock ? 'now' : '' }));
  }

  box.appendChild(el('div', { class: 'hero' },
    el('div', { class: 'eyebrow' }, `Блок ${plan.block} · неделя ${plan.week} из 4 · день ${plan.dayKey}`),
    el('div', { class: 'hero-title' }, plan.title),
    el('div', { class: 'hero-sub' }, plan.sub),
    el('div', { class: 'hero-stats' },
      el('div', { class: 'hero-stat' }, el('b', {}, String(plan.exercises.length)), el('span', {}, 'упражнений')),
      el('div', { class: 'hero-stat' }, el('b', {}, String(plan.totalSets)), el('span', {}, 'подходов')),
      el('div', { class: 'hero-stat' }, el('b', {}, '~' + plan.estMinutes), el('span', {}, 'минут')),
      el('div', { class: 'hero-stat' }, el('b', {}, `${j.inBlock}/${WORKOUTS_PER_BLOCK}`), el('span', {}, 'блок пройден'))
    ),
    el('div', { class: 'blockbar' }, ...bars),
    el('button', { class: 'btn btn-wide', onclick: () => startWorkout(plan) }, 'Начать тренировку')
  ));

  box.appendChild(el('div', { class: 'card stack-s' },
    el('div', { class: 'eyebrow' }, `Неделя ${plan.week}: ${plan.weekSpec.name}`),
    el('div', { style: 'font-size:13.5px;line-height:1.5' }, plan.weekSpec.intent),
    el('hr', { class: 'sep' }),
    el('div', { class: 'eyebrow' }, `Блок ${plan.block}: ${plan.focus.name}`),
    el('div', { style: 'font-size:13.5px;line-height:1.5' }, plan.focus.note)
  ));

  if (layoff) box.appendChild(el('div', { class: 'coach warn' }, el('div', { class: 'ic' }, '!'), el('div', {}, layoff.text)));

  box.appendChild(el('div', { class: 'card stack-s' },
    el('div', { class: 'eyebrow' }, 'Разминка · 8 минут'),
    el('div', { style: 'font-size:13.5px;line-height:1.5' },
      '5 минут велотренажёра или дорожки до лёгкой испарины, затем суставная разминка сверху вниз. ',
      'В первом упражнении сделай 2 разминочных подхода: пустой гриф ×10 и 50–60% рабочего веса ×5. ',
      'Разминочные подходы в дневник не пишутся.')
  ));

  box.appendChild(el('div', { class: 'eyebrow', style: 'padding-left:2px;margin-top:4px' }, 'Что сегодня и с каким весом'));
  for (const item of plan.exercises) box.appendChild(previewRow(item));

  return box;
}

function previewRow(item) {
  const ex = EX[item.id];
  const wLabel = item.weight != null ? `${fmtKg(item.weight)} кг` : ex.unit === 'time' ? `${item.target} с` : 'подбери вес';
  return el('div', { class: 'exrow' },
    el('button', { class: 'exrow-head', onclick: () => openExercise(item.id, item) },
      el('div', { class: 'exrow-fig' }, makeFigure(item.id)),
      el('div', { style: 'min-width:0' },
        el('div', { class: 'exrow-name' }, ex.n),
        el('div', { class: 'exrow-meta' }, `${item.sets} × ${item.repLo}–${item.repHi} · ${wLabel}`)),
      el('span', { class: 'badge' + (item.role === 'main' ? ' acc' : ''), style: 'margin-left:auto' },
        item.role === 'main' ? 'база' : 'подсобка')
    ),
    el('div', { class: 'exrow-body', style: 'padding-top:10px' },
      el('div', { class: 'coach' }, el('div', { class: 'ic' }, '?'), el('div', {}, item.why)))
  );
}

const fmtKg = v => (Math.round(v * 100) / 100).toString().replace(/\.0+$/, '').replace('.', ',');

function startWorkout(plan) {
  const entries = {};
  for (const item of plan.exercises) {
    entries[item.id] = Array.from({ length: item.sets }, () => ({ w: '', r: '', done: false }));
  }
  const d = new Date();
  store.state.current = {
    id: `s-${todayKey()}-${pad(d.getHours())}${pad(d.getMinutes())}`,
    date: todayKey(),
    dayKey: plan.dayKey, block: plan.block, week: plan.week,
    plan, entries, startedAt: Date.now()
  };
  store.saveCurrent();
  render();
}

const openCards = {};

function activeWorkout() {
  const cur = store.state.current;
  const plan = cur.plan;
  const box = el('div', { class: 'stack' });

  const doneSets = Object.values(cur.entries).flat().filter(s => s.done).length;
  const mins = Math.round((Date.now() - cur.startedAt) / 60000);
  const tonnage = Object.values(cur.entries).flat()
    .filter(s => s.done).reduce((a, s) => a + (+s.w || 0) * (+s.r || 0), 0);

  box.appendChild(el('div', { class: 'hero' },
    el('div', { class: 'eyebrow' }, `Идёт тренировка · блок ${plan.block}, неделя ${plan.week}`),
    el('div', { class: 'hero-title' }, plan.title),
    el('div', { class: 'hero-stats' },
      el('div', { class: 'hero-stat' }, el('b', {}, `${doneSets}/${plan.totalSets}`), el('span', {}, 'подходов')),
      el('div', { class: 'hero-stat' }, el('b', {}, mins + ' мин'), el('span', {}, 'в зале')),
      el('div', { class: 'hero-stat' }, el('b', {}, Math.round(tonnage).toLocaleString('ru-RU')), el('span', {}, 'кг тоннаж'))
    ),
    el('div', { class: 'row', style: 'margin-top:16px;gap:8px' },
      el('button', { class: 'btn', style: 'flex:1;background:var(--paper);color:var(--ink);border-color:transparent', onclick: askFeedback }, 'Завершить'),
      el('button', {
        class: 'btn btn-ghost', onclick: () => {
          if (!confirm('Отменить тренировку? Записанные подходы не сохранятся.')) return;
          store.state.current = null; store.saveCurrent(); stopTimer(); render();
        }
      }, 'Отмена')
    )
  ));

  for (const item of plan.exercises) box.appendChild(exerciseCard(item));
  box.appendChild(el('button', { class: 'btn btn-primary btn-wide', onclick: askFeedback }, 'Завершить тренировку'));
  return box;
}

function exerciseCard(item) {
  const ex = EX[item.id];
  const cur = store.state.current;
  const arr = cur.entries[item.id];
  const open = openCards[item.id] !== false;
  const card = el('div', { class: 'exrow' });

  card.appendChild(el('button', {
    class: 'exrow-head', onclick: () => { openCards[item.id] = !open; render(); }
  },
    el('div', { class: 'exrow-fig' }, makeFigure(item.id)),
    el('div', { style: 'min-width:0' },
      el('div', { class: 'exrow-name' }, ex.n),
      el('div', { class: 'exrow-meta' }, `${item.sets} × ${item.repLo}–${item.repHi}${item.weight != null ? ' · ' + fmtKg(item.weight) + ' кг' : ''}`)),
    el('div', { class: 'exrow-state' },
      el('div', { class: 'dots' }, ...arr.map(s => el('i', { class: 'dot' + (s.done ? ' done' : '') }))),
      icon(`<path d="M6 9l6 6 6-6" transform="rotate(${open ? 180 : 0} 12 12)"/>`))
  ));

  if (!open) return card;

  const body = el('div', { class: 'exrow-body' });

  body.appendChild(el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
    el('button', { class: 'btn btn-s', onclick: () => openExercise(item.id, item) }, 'Техника'),
    ex.unit === 'kg' && el('button', { class: 'btn btn-s', onclick: () => openPlates(item.weight || 60) }, 'Блины'),
    el('span', { class: 'badge acc' }, 'отдых ' + item.rest + ' с'),
    el('span', { class: 'badge' }, item.repLo + '–' + item.repHi + ' повт.')
  ));

  body.appendChild(el('div', { class: 'coach' }, el('div', { class: 'ic' }, '→'), el('div', {}, item.why)));

  const isTime = ex.unit === 'time';
  const noWeight = ex.unit === 'time' || ex.unit === 'bw';

  body.appendChild(el('div', { class: 'setcap' },
    el('span', {}, '#'), el('span', {}, noWeight ? '—' : 'кг'),
    el('span', {}, isTime ? 'секунды' : 'повторы'), el('span', {}, '')));

  arr.forEach((setv, i) => {
    const line = el('div', { class: 'setline' + (setv.done ? ' done' : '') });
    const wPlaceholder = item.weight != null ? fmtKg(item.weight) : '—';
    const rPlaceholder = String(item.target ?? item.repLo);

    const wIn = el('input', {
      type: 'number', inputmode: 'decimal', step: '0.5', min: '0',
      id: `w-${item.id}-${i}`, value: setv.w === '' ? '' : setv.w,
      placeholder: wPlaceholder, disabled: noWeight || undefined,
      oninput: e => { setv.w = e.target.value === '' ? '' : parseFloat(e.target.value); store.saveCurrent(); }
    });
    const rIn = el('input', {
      type: 'number', inputmode: 'numeric', step: '1', min: '0',
      id: `r-${item.id}-${i}`, value: setv.r === '' ? '' : setv.r,
      placeholder: rPlaceholder,
      oninput: e => { setv.r = e.target.value === '' ? '' : parseInt(e.target.value, 10); store.saveCurrent(); }
    });

    line.append(el('div', { class: 'sn' }, String(i + 1)), wIn, rIn,
      el('button', {
        class: 'tick', 'aria-label': `Отметить подход ${i + 1}`,
        onclick: () => {
          if (!setv.done) {
            if (setv.w === '' || setv.w === undefined) setv.w = noWeight ? 0 : (item.weight ?? 0);
            if (setv.r === '' || setv.r === undefined) setv.r = item.target ?? item.repLo;
            setv.done = true;
            store.saveCurrent();
            const more = arr.some(s => !s.done);
            if (more) startTimer(item.rest, ex.n);
            else stopTimer();
          } else { setv.done = false; store.saveCurrent(); }
          render();
        }
      }, icon('<path d="M4 12.5l5 5L20 6.5"/>')));

    body.appendChild(line);
  });

  const allDone = arr.every(s => s.done);
  if (allDone && ex.unit === 'kg') {
    const hitTop = arr.every(s => (+s.r || 0) >= item.repHi);
    body.appendChild(el('div', { class: 'coach ' + (hitTop ? 'ok' : '') },
      el('div', { class: 'ic' }, hitTop ? '↑' : '=' ),
      el('div', {}, hitTop
        ? `Все подходы по ${item.repHi} — в следующий раз движок поставит +${ex.step} кг.`
        : `Держим этот вес, пока все подходы не выйдут на ${item.repHi} повторов.`)));
  }

  card.appendChild(body);
  return card;
}

/* --------------------- завершение и обратная связь --------------------- */

const FEEDBACK = [
  { k: 'easy', t: 'Легко', s: 'В запасе оставалось 3+ повтора', ic: '↑' },
  { k: 'ok',   t: 'Нормально', s: 'Тяжело, но все подходы закрыл', ic: '=' },
  { k: 'hard', t: 'Тяжело', s: 'Еле дожал последние подходы', ic: '↓' },
  { k: 'fail', t: 'Не добил', s: 'Подход сорвался или бросил', ic: '✕' }
];

function askFeedback() {
  const cur = store.state.current;
  const done = Object.values(cur.entries).flat().filter(s => s.done).length;
  if (!done) {
    if (!confirm('Не отмечено ни одного подхода. Всё равно завершить? Тренировка не запишется.')) return;
    store.state.current = null; store.saveCurrent(); stopTimer(); render();
    return;
  }

  openSheet(() => {
    const box = el('div', { class: 'stack' });
    box.append(
      el('h2', { class: 'screen-title' }, 'Как прошло?'),
      el('div', { class: 'muted', style: 'font-size:13px;margin-top:-6px' },
        'Ответ важнее, чем кажется: движок по нему решает, прибавлять вес в следующий раз, держать или откатить.')
    );
    for (const f of FEEDBACK) {
      box.appendChild(el('button', {
        class: 'lib-item', onclick: () => { closeSheet(); finishWorkout(f.k); }
      },
        el('div', { class: 'coach', style: 'background:transparent;padding:0' }, el('div', { class: 'ic' }, f.ic)),
        el('div', {},
          el('div', { class: 'exrow-name' }, f.t),
          el('div', { class: 'muted', style: 'font-size:12px' }, f.s))
      ));
    }
    box.appendChild(el('button', { class: 'btn btn-wide', onclick: closeSheet }, 'Ещё не закончил'));
    return box;
  });
}

function finishWorkout(feedback) {
  const cur = store.state.current;
  const entries = {};
  for (const [id, sets] of Object.entries(cur.entries)) {
    const kept = sets.filter(s => s.done).map(s => ({ w: +s.w || 0, r: +s.r || 0 }));
    if (kept.length) entries[id] = kept;
  }

  // Записываем, какая схема была задана: движок сравнивает прошлый
  // результат с ТЕМ диапазоном, а не с сегодняшним. Между блоками
  // диапазон меняется, и без этого 7 повторов в схеме 5–7 читались бы
  // как недобор до 8.
  const targets = {};
  for (const e of cur.plan.exercises) {
    if (entries[e.id]) targets[e.id] = { sets: e.sets, repLo: e.repLo, repHi: e.repHi, weight: e.weight };
  }

  const session = {
    id: cur.id, date: cur.date, dayKey: cur.dayKey,
    block: cur.block, week: cur.week, feedback,
    entries, targets, startedAt: cur.startedAt, finishedAt: Date.now()
  };

  store.commitSession(session);
  store.state.current = null;
  store.saveCurrent();
  stopTimer();

  showSummary(session);
}

function showSummary(session) {
  const j = journey(store.state.sessions);
  const nextPlan = planWorkout(store.state.sessions, store.state.sessions.length);
  const tonnage = Object.values(session.entries).flat().reduce((a, s) => a + s.w * s.r, 0);
  const sets = Object.values(session.entries).flat().length;

  openSheet(() => {
    const box = el('div', { class: 'stack' });
    box.append(
      el('div', { class: 'eyebrow' }, 'Тренировка записана'),
      el('h2', { class: 'screen-title' }, 'Готово'),
      el('div', { class: 'grid3' },
        el('div', { class: 'tile' }, el('b', {}, String(sets)), el('span', {}, 'подходов')),
        el('div', { class: 'tile' }, el('b', {}, Math.round(tonnage).toLocaleString('ru-RU')), el('span', {}, 'кг тоннаж')),
        el('div', { class: 'tile' }, el('b', {}, `${j.inBlock}/${WORKOUTS_PER_BLOCK}`), el('span', {}, 'блок'))
      )
    );

    if (j.inBlock === 0) {
      box.appendChild(el('div', { class: 'coach ok' }, el('div', { class: 'ic' }, '✓'),
        el('div', {}, `Блок ${j.block - 1} полностью закрыт. Начинается блок ${j.block}: ${j.focus.name}. Подсобка сменится, схемы подходов тоже — однообразия не будет.`)));
    } else if (j.week !== position(store.state.sessions.length - 1).week) {
      box.appendChild(el('div', { class: 'coach' }, el('div', { class: 'ic' }, '→'),
        el('div', {}, `Неделя ${j.week}: ${j.weekSpec.name}. ${j.weekSpec.intent}`)));
    }

    box.append(
      el('div', { class: 'card stack-s' },
        el('div', { class: 'eyebrow' }, 'Следующая тренировка'),
        el('div', { class: 'h2' }, nextPlan.title),
        el('div', { class: 'muted', style: 'font-size:12.5px' }, nextPlan.sub),
        el('hr', { class: 'sep' }),
        ...nextPlan.exercises.filter(e => e.role === 'main').map(e =>
          el('div', { class: 'spread', style: 'padding:4px 0' },
            el('span', { style: 'font-size:13px' }, EX[e.id].n),
            el('span', { class: 'num muted', style: 'font-size:12.5px' },
              e.weight != null ? `${fmtKg(e.weight)} кг × ${e.repLo}–${e.repHi}` : `${e.repLo}–${e.repHi}`)))
      ),
      el('button', { class: 'btn btn-primary btn-wide', onclick: () => { closeSheet(); go('path'); } }, 'Посмотреть путь'),
      el('button', { class: 'btn btn-wide', onclick: () => { closeSheet(); render(); } }, 'Закрыть')
    );
    return box;
  });
  render();
}

/* ------------------------------- ПУТЬ ------------------------------- */

let pathExercise = null;

function renderPath() {
  const root = $('#scr-path');
  root.innerHTML = '';
  const sessions = store.state.sessions;
  const j = journey(sessions);
  $('#scrSub').textContent = sessions.length
    ? `${sessions.length} тренировок · блок ${j.block}, неделя ${j.week}`
    : 'Дневник пока пустой';

  const box = el('div', { class: 'stack' });

  if (!sessions.length) {
    box.append(
      el('div', { class: 'card stack-s' },
        el('div', { class: 'h2' }, 'Путь начинается с первой тренировки'),
        el('div', { class: 'muted', style: 'font-size:13px;line-height:1.5' },
          'Как только отметишь первую — здесь появятся блок, неделя, рост силы и графики. Движок начнёт вести программу от твоих реальных цифр.'),
        el('button', { class: 'btn btn-primary btn-wide', onclick: () => go('today') }, 'К тренировке')),
      bodyWeightCard()
    );
    root.appendChild(box);
    return;
  }

  /* положение в программе */
  const bars = [];
  for (let i = 0; i < WORKOUTS_PER_BLOCK; i++) {
    bars.push(el('i', { class: i < j.inBlock ? 'done' : i === j.inBlock ? 'now' : '' }));
  }
  box.appendChild(el('div', { class: 'hero' },
    el('div', { class: 'eyebrow' }, `Блок ${j.block} · ${j.focus.name}`),
    el('div', { class: 'hero-title' }, `Неделя ${j.week}: ${j.weekSpec.name}`),
    el('div', { class: 'hero-sub' }, j.weekSpec.intent),
    el('div', { class: 'blockbar' }, ...bars),
    el('div', { class: 'hero-stats' },
      el('div', { class: 'hero-stat' }, el('b', {}, `${j.inBlock}/${WORKOUTS_PER_BLOCK}`), el('span', {}, 'блок пройден')),
      el('div', { class: 'hero-stat' }, el('b', {}, String(j.done)), el('span', {}, 'всего тренировок')),
      el('div', { class: 'hero-stat' }, el('b', {}, Math.round(j.totalTonnage / 1000) + ' т'), el('span', {}, 'поднято за всё время'))
    )
  ));

  box.appendChild(el('div', { class: 'coach' }, el('div', { class: 'ic' }, '→'),
    el('div', {}, `Дальше: неделя ${j.nextWeek.n} — ${j.nextWeek.name}. ${j.nextWeek.intent}`)));

  /* сила */
  if (j.strength > 0) {
    box.appendChild(el('div', { class: 'card stack-s' },
      el('div', { class: 'spread' },
        el('div', { class: 'eyebrow' }, 'Сумма базовых движений'),
        el('span', { class: 'badge' + (j.strengthTotalDelta > 0 ? ' on' : '') },
          (j.strengthTotalDelta > 0 ? '+' : '') + j.strengthTotalDelta + ' кг')),
      el('div', { class: 'num', style: 'font-family:var(--display);font-size:30px;font-weight:700;letter-spacing:-.02em' },
        j.strength + ' кг'),
      el('div', { class: 'muted', style: 'font-size:12.5px;line-height:1.5' },
        'Расчётные максимумы в приседе, тяге, жиме и тяге к поясу, сложенные вместе. Это самый честный показатель того, что ты становишься сильнее — вес тела и зеркало врут, эта цифра нет.'),
      j.strengthBlockDelta !== 0 && el('div', { class: 'hint' },
        `За текущий блок: ${j.strengthBlockDelta > 0 ? '+' : ''}${j.strengthBlockDelta} кг`)
    ));

    const pts = [];
    let running = 0;
    sessions.forEach(s => {
      const best = Object.entries(s.entries || {}).reduce((acc, [id, sets]) => {
        if (!EX[id] || EX[id].unit !== 'kg') return acc;
        return Math.max(acc, ...sets.map(x => e1rm(x.w, x.r)));
      }, 0);
      running = Math.max(running, best);
      if (best > 0) pts.push({ x: s.date, y: Math.round(best) });
    });
    if (pts.length > 1) {
      box.appendChild(el('div', { class: 'card stack-s' },
        el('div', { class: 'eyebrow' }, 'Лучший расчётный максимум за тренировку, кг'),
        lineChart(pts, { unit: ' кг' })));
    }
  }

  /* тоннаж по неделям */
  const weeks = {};
  for (const s of sessions) {
    const dt = new Date(s.date);
    const m = new Date(dt); m.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    const k = `${m.getFullYear()}-${pad(m.getMonth() + 1)}-${pad(m.getDate())}`;
    weeks[k] = (weeks[k] || 0) + Object.values(s.entries || {}).flat().reduce((a, x) => a + x.w * x.r, 0);
  }
  const wk = Object.entries(weeks).sort().slice(-10).map(([x, y]) => ({ x, y: Math.round(y) }));
  if (wk.length) {
    box.appendChild(el('div', { class: 'card stack-s' },
      el('div', { class: 'eyebrow' }, 'Тоннаж по неделям, кг'),
      barChart(wk, { unit: ' кг', label: p => 'Неделя ' + fmtDate(p.x) }),
      el('div', { class: 'muted', style: 'font-size:12px' },
        'Вес × повторы за всю тренировку. На разгрузочной неделе он падает — так и задумано.')));
  }

  /* прогресс по упражнению */
  const used = [...new Set(sessions.flatMap(s => Object.keys(s.entries || {})))].filter(id => EX[id] && EX[id].unit === 'kg');
  if (used.length) {
    if (!pathExercise || !used.includes(pathExercise)) pathExercise = used[0];
    const pts = [];
    for (const s of sessions) {
      const arr = (s.entries || {})[pathExercise];
      if (!arr?.length) continue;
      const top = arr.reduce((a, b) => (e1rm(b.w, b.r) > e1rm(a.w, a.r) ? b : a));
      pts.push({ x: s.date, y: Math.round(e1rm(top.w, top.r)), raw: `${fmtKg(top.w)}×${top.r}` });
    }
    const c = el('div', { class: 'card stack-s' },
      el('div', { class: 'eyebrow' }, 'Прогресс по упражнению'),
      el('div', { class: 'chiprow' }, ...used.map(id =>
        el('button', { class: 'chip', 'aria-pressed': id === pathExercise, onclick: () => { pathExercise = id; renderPath(); } }, EX[id].n))));
    c.appendChild(pts.length > 1
      ? lineChart(pts, { unit: ' кг' })
      : el('div', { class: 'muted', style: 'font-size:12.5px' }, 'Нужно минимум две тренировки с этим упражнением.'));
    box.appendChild(c);
  }

  /* вехи */
  box.appendChild(el('div', { class: 'card stack-s' },
    el('div', { class: 'eyebrow' }, 'Вехи'),
    ...j.milestones.map(m => el('div', { class: 'mile' + (m.ok ? ' on' : '') },
      el('div', { class: 'm' }, m.icon),
      el('div', {}, el('div', { class: 't' }, m.title), el('div', { class: 's' }, m.note))))
  ));

  box.appendChild(bodyWeightCard());

  /* журнал */
  box.appendChild(el('div', { class: 'stack-s' },
    el('div', { class: 'eyebrow', style: 'padding-left:2px' }, 'Журнал'),
    ...sessions.slice().reverse().slice(0, 15).map(s => {
      const t = Object.values(s.entries || {}).flat().reduce((a, x) => a + x.w * x.r, 0);
      const n = Object.values(s.entries || {}).flat().length;
      const fb = FEEDBACK.find(f => f.k === s.feedback);
      return el('button', { class: 'lib-item', onclick: () => openSession(s) },
        el('div', { style: 'min-width:0' },
          el('div', { class: 'exrow-name' }, `Блок ${s.block || '—'} · неделя ${s.week || '—'} · день ${s.dayKey || ''}`),
          el('div', { class: 'muted', style: 'font-size:12px' },
            `${fmtDate(s.date)} · ${n} подходов${fb ? ' · ' + fb.t.toLowerCase() : ''}`)),
        el('div', { style: 'text-align:right;flex:none;margin-left:auto' },
          el('div', { class: 'num', style: 'font-weight:600' }, Math.round(t).toLocaleString('ru-RU')),
          el('div', { class: 'muted', style: 'font-size:11px' }, 'кг')));
    })));

  root.appendChild(box);
}

function bodyWeightCard() {
  const entries = Object.entries(store.state.body)
    .map(([d, v]) => ({ x: d, y: typeof v === 'number' ? v : v.kg }))
    .sort((a, b) => (a.x < b.x ? -1 : 1));
  const last = entries[entries.length - 1];
  const delta = entries.length > 1 ? entries[entries.length - 1].y - entries[0].y : 0;

  const card = el('div', { class: 'card stack-s' });
  card.appendChild(el('div', { class: 'spread' },
    el('div', { class: 'eyebrow' }, 'Вес тела, кг'),
    el('span', { class: 'badge' + (delta > 0 ? ' on' : '') },
      last ? `${last.y} кг${entries.length > 1 ? ` (${delta > 0 ? '+' : ''}${delta.toFixed(1)})` : ''}` : 'нет данных')));

  if (entries.length > 1) card.appendChild(lineChart(entries, { unit: ' кг' }));
  else card.appendChild(el('div', { class: 'muted', style: 'font-size:12.5px;line-height:1.5' },
    `Взвешивайся утром натощак 2–3 раза в неделю. Здоровый набор — примерно ${(store.state.settings.profile.weight * 0.0035).toFixed(2)} кг в неделю; быстрее означает лишний жир.`));

  const input = el('input', { type: 'number', inputmode: 'decimal', step: '0.1', id: 'bwIn', placeholder: String(store.state.settings.profile.weight) });
  card.appendChild(el('div', { class: 'row', style: 'gap:8px' },
    el('div', { class: 'field', style: 'flex:1' }, input),
    el('button', {
      class: 'btn btn-primary', onclick: () => {
        const v = parseFloat(input.value);
        if (!v) return;
        store.setBodyWeight(todayKey(), v);
        store.state.settings.profile.weight = v;
        store.saveSettings();
        toast('Вес записан');
        render();
      }
    }, 'Записать')));
  return card;
}

function openSession(s) {
  openSheet(() => {
    const box = el('div', { class: 'stack' });
    const fb = FEEDBACK.find(f => f.k === s.feedback);
    box.append(
      el('div', { class: 'eyebrow' }, `${fmtDate(s.date)} · блок ${s.block || '—'}, неделя ${s.week || '—'}`),
      el('h2', { class: 'screen-title' }, 'День ' + (s.dayKey || '')),
      fb && el('div', { class: 'coach' }, el('div', { class: 'ic' }, fb.ic), el('div', {}, 'Оценка: ' + fb.t.toLowerCase() + ' — ' + f_lower(fb.s)))
    );
    for (const [id, sets] of Object.entries(s.entries || {})) {
      if (!EX[id]) continue;
      box.appendChild(el('div', { class: 'card stack-s' },
        el('div', { class: 'h2' }, EX[id].n),
        el('div', { class: 'num', style: 'font-size:13px' },
          sets.map(x => EX[id].unit === 'time' ? `${x.r} с` : EX[id].unit === 'bw' ? `${x.r}` : `${fmtKg(x.w)}×${x.r}`).join('   ·   '))));
    }
    box.append(
      el('button', {
        class: 'btn btn-danger btn-wide', onclick: () => {
          if (!confirm('Удалить эту тренировку из дневника?')) return;
          store.deleteSession(s.id); closeSheet(); render(); toast('Удалено');
        }
      }, 'Удалить тренировку'),
      el('button', { class: 'btn btn-wide', onclick: closeSheet }, 'Закрыть'));
    return box;
  });
}
const f_lower = s => s.charAt(0).toLowerCase() + s.slice(1);

/* ------------------------------- БАЗА ------------------------------- */

let libGroup = 'Все', libQuery = '';

function renderLib() {
  const root = $('#scr-lib');
  root.innerHTML = '';
  const list = Object.entries(EX).filter(([, e]) => {
    const g = PATTERNS[e.pattern].group;
    const okG = libGroup === 'Все' || g === libGroup;
    const q = libQuery.trim().toLowerCase();
    const okQ = !q || e.n.toLowerCase().includes(q) || e.tgt.toLowerCase().includes(q) || PATTERNS[e.pattern].n.toLowerCase().includes(q);
    return okG && okQ;
  });
  $('#scrSub').textContent = `${list.length} упражнений с разбором техники`;

  const box = el('div', { class: 'stack' });
  const search = el('input', {
    type: 'search', id: 'libSearch', placeholder: 'Поиск: жим, спина, бицепс…', value: libQuery,
    oninput: e => {
      libQuery = e.target.value;
      const p = e.target.selectionStart;
      renderLib();
      const n = $('#libSearch'); n.focus(); try { n.setSelectionRange(p, p); } catch {}
    }
  });
  box.appendChild(el('div', { class: 'field' }, search));
  box.appendChild(el('div', { class: 'chiprow' },
    ...['Все', ...GROUPS].map(g =>
      el('button', { class: 'chip', 'aria-pressed': g === libGroup, onclick: () => { libGroup = g; renderLib(); } }, g))));

  box.appendChild(el('div', { class: 'stack-s' }, ...list.map(([id, e]) =>
    el('button', { class: 'lib-item', onclick: () => openExercise(id) },
      el('div', { class: 'lib-fig' }, makeFigure(id)),
      el('div', { style: 'min-width:0' },
        el('div', { class: 'exrow-name' }, e.n),
        el('div', { class: 'muted', style: 'font-size:11.5px;margin-top:2px' }, e.tgt)),
      el('span', { class: 'badge', style: 'margin-left:auto' }, groupOf(id))))));

  if (!list.length) box.appendChild(el('div', { class: 'card muted', style: 'text-align:center' }, 'Ничего не нашлось.'));
  root.appendChild(box);
}

function openExercise(id, item) {
  const ex = EX[id];
  openSheet(() => {
    const box = el('div', { class: 'stack' });
    box.appendChild(el('div', {},
      el('div', { class: 'row', style: 'gap:7px;flex-wrap:wrap' },
        el('span', { class: 'badge acc' }, PATTERNS[ex.pattern].n),
        el('span', { class: 'badge' }, ex.eq),
        ex.tier === 'anchor' && el('span', { class: 'badge hot' }, 'базовое')),
      el('h2', { class: 'screen-title', style: 'margin-top:8px' }, ex.n),
      el('div', { class: 'muted', style: 'font-size:13px;margin-top:4px' }, ex.tgt)));

    /* схема с прокруткой по фазам */
    const fig = makeFigure(id, { animate: false });
    const rec = fig.figure;
    const scrub = el('input', {
      class: 'scrub', type: 'range', min: '0', max: '100', value: '0', 'aria-label': 'Прокрутка движения',
      oninput: e => { rec.manual = +e.target.value / 100; rec.draw(rec.manual); }
    });
    let playing = true;
    const playBtn = el('button', {
      class: 'btn btn-s', style: 'position:absolute;top:16px;right:16px',
      onclick: () => {
        playing = !playing;
        if (playing) { delete rec.manual; attachFigure(rec); playBtn.textContent = 'Пауза'; }
        else { rec.manual = rec.lastT; detachFigure(rec); playBtn.textContent = 'Играть'; }
      }
    }, 'Пауза');
    rec.onDraw = t => { if (playing) scrub.value = Math.round(t * 100); };
    attachFigure(rec);

    box.append(
      el('div', { class: 'figbox' }, fig, scrub, playBtn),
      el('div', { class: 'muted', style: 'font-size:11.5px;text-align:center;margin-top:-4px' },
        'Потяни ползунок, чтобы разобрать движение по фазам'),
      el('a', {
        class: 'btn btn-primary btn-wide', target: '_blank', rel: 'noopener',
        href: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(ex.en)
      }, icon('<rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="M10.5 9.5l5 2.5-5 2.5z"/>'), 'Смотреть видео техники')
    );

    if (item) box.appendChild(el('div', { class: 'card stack-s' },
      el('div', { class: 'eyebrow' }, 'Сегодня по плану'),
      el('div', { style: 'font-weight:600' },
        `${item.sets} × ${item.repLo}–${item.repHi}` + (item.weight != null ? ` · ${fmtKg(item.weight)} кг` : '')),
      el('div', { class: 'coach' }, el('div', { class: 'ic' }, '→'), el('div', {}, item.why))));

    box.append(
      el('div', { class: 'card stack-s' }, el('div', { class: 'eyebrow' }, 'Зачем это упражнение'),
        el('div', { style: 'font-size:13.5px;line-height:1.5' }, ex.why)),
      el('div', { class: 'card stack-s' }, el('div', { class: 'eyebrow' }, 'Как делать'),
        el('ol', { class: 'cuelist' }, ...ex.cues.map(c => el('li', {}, el('span', {}, c))))),
      el('div', { class: 'card stack-s' }, el('div', { class: 'eyebrow' }, 'Частые ошибки'),
        el('ul', { class: 'errlist' }, ...ex.err.map(c => el('li', {}, el('span', {}, c)))))
    );

    if (ex.note) box.appendChild(el('div', { class: 'coach' }, el('div', { class: 'ic' }, 'i'), el('div', {}, ex.note)));
    if (ex.safe) box.appendChild(el('div', { class: 'coach warn' }, el('div', { class: 'ic' }, '!'), el('div', {}, ex.safe)));

    const best = bestSet(id);
    if (best) box.appendChild(el('div', { class: 'card spread' },
      el('div', {}, el('div', { class: 'eyebrow' }, 'Твой рекорд'),
        el('div', { class: 'num', style: 'font-size:20px;font-weight:600;margin-top:3px' }, `${fmtKg(best.w)} кг × ${best.r}`)),
      el('div', { style: 'text-align:right' }, el('div', { class: 'eyebrow' }, '≈ 1ПМ'),
        el('div', { class: 'num', style: 'font-size:20px;font-weight:600;margin-top:3px' }, Math.round(e1rm(best.w, best.r)) + ' кг'))));

    box.appendChild(el('button', { class: 'btn btn-wide', onclick: closeSheet }, 'Закрыть'));
    return box;
  });
}

function bestSet(exId) {
  let best = null;
  for (const s of store.state.sessions) {
    for (const x of (s.entries || {})[exId] || []) {
      if (x.w > 0 && (!best || x.w > best.w || (x.w === best.w && x.r > best.r))) best = { ...x, date: s.date };
    }
  }
  return best;
}

function openPlates(start) {
  openSheet(() => {
    const box = el('div', { class: 'stack' });
    box.appendChild(el('h2', { class: 'screen-title' }, 'Какие блины вешать'));
    const view = el('div', { class: 'card' });
    const wIn = el('input', { type: 'number', inputmode: 'decimal', step: '2.5', value: start || 60, id: 'plTotal' });
    const bIn = el('select', { id: 'plBar' },
      ...[20, 15, 10, 7.5].map(b => el('option', { value: b, selected: store.state.settings.bar === b || undefined }, b + ' кг')));

    const paint = () => {
      const total = parseFloat(wIn.value) || 0;
      const bar = +bIn.value;
      const { out, rest, side } = calcPlates(total, bar);
      view.innerHTML = '';
      view.appendChild(el('div', { class: 'eyebrow' }, 'На каждую сторону'));
      const row = el('div', { class: 'plateview' }, el('div', { class: 'sleeve' }));
      if (!out.length) row.appendChild(el('div', { class: 'muted', style: 'font-size:13px;padding:0 8px' },
        total < bar ? 'Меньше веса грифа' : 'Только гриф'));
      for (const p of out) row.appendChild(el('div', {
        class: 'plate',
        style: `width:11px;height:${p.h}px;background:${p.c};${p.w === 5 ? 'color:#111418;border:1px solid var(--line)' : ''}`
      }, String(p.w)));
      view.appendChild(row);
      const counts = {};
      for (const p of out) counts[p.w] = (counts[p.w] || 0) + 1;
      view.appendChild(el('div', { class: 'num', style: 'text-align:center;font-size:14px;font-weight:600' },
        Object.entries(counts).map(([w, c]) => `${c} × ${w}`).join('  +  ') || '—'));
      view.appendChild(el('div', { class: 'muted', style: 'text-align:center;font-size:12px;margin-top:6px' },
        `Сторона: ${fmtKg(side)} кг` + (rest > 0 ? ` · не хватает ${fmtKg(rest)} кг, округли вес` : '')));
    };
    wIn.addEventListener('input', paint);
    bIn.addEventListener('change', () => { store.state.settings.bar = +bIn.value; store.saveSettings(); paint(); });

    box.append(
      el('div', { class: 'card grid2' },
        el('div', { class: 'field' }, el('label', { for: 'plTotal' }, 'Общий вес'), wIn),
        el('div', { class: 'field' }, el('label', { for: 'plBar' }, 'Гриф'), bIn)),
      view,
      el('div', { class: 'card stack-s' }, el('div', { class: 'eyebrow' }, 'Цвета блинов'),
        el('div', { class: 'muted', style: 'font-size:12.5px' },
          'Соревновательная раскраска: красный 25, синий 20, жёлтый 15, зелёный 10, белый 5, чёрный 2,5, серый 1,25 кг. В обычном зале блины чаще чёрные — смотри на цифры.')),
      el('button', { class: 'btn btn-wide', onclick: closeSheet }, 'Закрыть'));
    paint();
    return box;
  });
}

/* ------------------------------- ЕЩЁ ------------------------------- */

function renderMore() {
  const root = $('#scr-more');
  root.innerHTML = '';
  $('#scrSub').textContent = 'Питание, данные, настройки';
  const p = store.state.settings.profile;
  const box = el('div', { class: 'stack' });

  const bmr = p.sex === 'm'
    ? 10 * p.weight + 6.25 * p.height - 5 * p.age + 5
    : 10 * p.weight + 6.25 * p.height - 5 * p.age - 161;
  const tdee = bmr * p.act;
  const surplus = { easy: 0.08, steady: 0.13, fast: 0.2 }[p.pace] ?? 0.13;
  const kcal = Math.round((tdee * (1 + surplus)) / 10) * 10;
  const prot = Math.round(p.weight * 2);
  const fat = Math.round(p.weight * 0.9);
  const carb = Math.max(0, Math.round((kcal - prot * 4 - fat * 9) / 4));
  const gain = p.weight * (surplus < 0.1 ? 0.0025 : surplus < 0.16 ? 0.0035 : 0.005);

  box.appendChild(el('div', { class: 'hero' },
    el('div', { class: 'eyebrow' }, 'Норма на массу'),
    el('div', { class: 'hero-title', style: 'font-size:38px' }, kcal.toLocaleString('ru-RU'),
      el('span', { style: 'font-size:16px;font-weight:600;margin-left:6px' }, 'ккал/день')),
    el('div', { class: 'hero-sub' }, `Поддержка ${Math.round(tdee)} ккал · профицит +${Math.round(kcal - tdee)} ккал`),
    el('div', { class: 'hero-stats' },
      el('div', { class: 'hero-stat' }, el('b', {}, prot + ' г'), el('span', {}, 'белок')),
      el('div', { class: 'hero-stat' }, el('b', {}, fat + ' г'), el('span', {}, 'жиры')),
      el('div', { class: 'hero-stat' }, el('b', {}, carb + ' г'), el('span', {}, 'углеводы')),
      el('div', { class: 'hero-stat' }, el('b', {}, '+' + gain.toFixed(2)), el('span', {}, 'кг в неделю')))));

  box.appendChild(el('div', { class: 'card' },
    el('div', { class: 'eyebrow' }, 'Как распределяются калории'),
    el('div', { class: 'bar-track' },
      el('i', { style: `width:${(prot * 4 / kcal) * 100}%;background:var(--accent)` }),
      el('i', { style: `width:${(fat * 9 / kcal) * 100}%;background:var(--signal)` }),
      el('i', { style: `width:${(carb * 4 / kcal) * 100}%;background:var(--good)` })),
    el('div', { class: 'row', style: 'gap:14px;margin-top:9px;font-size:11.5px;flex-wrap:wrap' },
      legend('var(--accent)', 'Белок'), legend('var(--signal)', 'Жиры'), legend('var(--good)', 'Углеводы'))));

  const num = (label, key, attrs = {}) => el('div', { class: 'field' },
    el('label', { for: 'f-' + key }, label),
    el('input', {
      id: 'f-' + key, type: 'number', inputmode: 'numeric', value: p[key], ...attrs,
      oninput: e => { const v = parseFloat(e.target.value); if (v) { p[key] = v; store.saveSettings(); renderMore(); } }
    }));

  box.appendChild(el('div', { class: 'card stack' },
    el('div', { class: 'eyebrow' }, 'Твои данные'),
    el('div', { class: 'grid2' }, num('Возраст', 'age'), num('Рост, см', 'height')),
    el('div', { class: 'grid2' },
      num('Вес, кг', 'weight', { step: '0.1' }),
      el('div', { class: 'field' }, el('label', { for: 'f-sex' }, 'Пол'),
        el('select', { id: 'f-sex', onchange: e => { p.sex = e.target.value; store.saveSettings(); renderMore(); } },
          el('option', { value: 'm', selected: p.sex === 'm' || undefined }, 'Мужской'),
          el('option', { value: 'f', selected: p.sex === 'f' || undefined }, 'Женский')))),
    el('div', { class: 'field' }, el('label', { for: 'f-act' }, 'Активность вне зала'),
      el('select', { id: 'f-act', onchange: e => { p.act = +e.target.value; store.saveSettings(); renderMore(); } },
        opt(1.2, 'Сидячая работа, мало хожу', p.act),
        opt(1.375, 'Обычный день + 3 тренировки', p.act),
        opt(1.55, 'Много хожу + 4–5 тренировок', p.act),
        opt(1.725, 'Физическая работа', p.act))),
    el('div', { class: 'field' }, el('label', { for: 'f-pace' }, 'Темп набора'),
      el('select', { id: 'f-pace', onchange: e => { p.pace = e.target.value; store.saveSettings(); renderMore(); } },
        opt('easy', 'Аккуратный — минимум жира', p.pace),
        opt('steady', 'Рабочий — оптимально для новичка', p.pace),
        opt('fast', 'Быстрый — быстрее вес, больше жира', p.pace)))));

  box.appendChild(el('div', { class: 'card stack-s' },
    el('div', { class: 'eyebrow' }, 'Что это значит на практике'),
    el('div', { class: 'nut-row' }, el('span', {}, 'Белок в день'), el('b', {}, prot + ' г')),
    el('div', { class: 'muted', style: 'font-size:12.5px;margin-top:-4px' },
      `Примерно ${Math.round(prot / 25)} порций по 25 г: 120 г куриной грудки, 150 г творога 5%, 3 яйца или порция протеина — каждая даёт около 25 г.`),
    el('hr', { class: 'sep' }),
    el('div', { class: 'nut-row' }, el('span', {}, 'Приёмов пищи'), el('b', {}, '4–5')),
    el('div', { class: 'muted', style: 'font-size:12.5px;margin-top:-4px' },
      `По ${Math.round(kcal / 5 / 10) * 10}–${Math.round(kcal / 4 / 10) * 10} ккал и 30–40 г белка за приём.`),
    el('hr', { class: 'sep' }),
    el('div', { class: 'nut-row' }, el('span', {}, 'Вода'), el('b', {}, (p.weight * 0.035).toFixed(1) + ' л')),
    el('div', { class: 'muted', style: 'font-size:12.5px;margin-top:-4px' }, 'Плюс 0,5–1 л в день тренировки.')));

  box.appendChild(el('div', { class: 'card stack-s' },
    el('div', { class: 'eyebrow' }, 'Проверка раз в две недели'),
    el('div', { style: 'font-size:13.5px;line-height:1.5' },
      'Смотри на среднее за неделю, а не на одно взвешивание. Вес не вырос за 2 недели — добавь 200 ккал в день. ',
      'Растёт быстрее ', el('b', {}, (p.weight * 0.006).toFixed(2) + ' кг в неделю'), ' — убери 150 ккал.')));

  /* --- хранилище --- */
  const a = store.adapter;
  box.appendChild(el('div', { class: 'card stack-s' },
    el('div', { class: 'spread' },
      el('div', { class: 'eyebrow' }, 'Хранилище'),
      el('span', { class: 'badge' + (store.status.error ? '' : ' on') }, a?.name || '—')),
    el('div', { class: 'muted', style: 'font-size:12.5px;line-height:1.5' },
      store.status.error
        ? `Последняя попытка не удалась: ${store.status.error}. Записи в очереди и уйдут сами, когда связь вернётся.`
        : store.status.lastSync
          ? `Сохранено ${new Date(store.status.lastSync).toLocaleString('ru-RU')}.` +
            (store.hasPending() ? ' Есть несохранённые изменения — отправлю при первой возможности.' : '')
          : 'Ещё ни разу не сохранялось в хранилище.'),
    a?.warn && el('div', { class: 'coach warn' }, el('div', { class: 'ic' }, '!'), el('div', {}, a.warn)),
    el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
      el('button', { class: 'btn btn-s', onclick: () => { store.sync(true); toast('Сохраняю…'); } }, 'Сохранить сейчас'),
      el('button', {
        class: 'btn btn-s', onclick: () => {
          if (!confirm('Сменить хранилище? Дневник останется на этом устройстве и переедет в новое место при подключении.')) return;
          store.disconnect(); gatePick = null; render();
        }
      }, 'Сменить хранилище'))));

  box.appendChild(el('div', { class: 'card stack-s' },
    el('div', { class: 'eyebrow' }, 'Копия файлом'),
    el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
      el('button', { class: 'btn btn-s', onclick: downloadBackup }, 'Скачать копию'),
      el('button', { class: 'btn btn-s', onclick: () => $('#importFile').click() }, 'Восстановить из файла')),
    el('div', { class: 'muted', style: 'font-size:11.5px;line-height:1.5' },
      'Обычный JSON-файл. Это последняя линия обороны на случай, если что-то случится и с телефоном, и с хранилищем. При восстановлении записи сливаются, а не затирают друг друга.')));

  box.appendChild(el('div', { class: 'card stack-s' },
    el('div', { class: 'eyebrow' }, 'Настройки'),
    el('div', { class: 'spread' },
      el('span', { style: 'font-size:13.5px' }, 'Звук и вибрация таймера'),
      el('button', {
        class: 'chip', 'aria-pressed': store.state.settings.sound,
        onclick: () => {
          store.state.settings.sound = !store.state.settings.sound;
          store.saveSettings();
          if (store.state.settings.sound) beep();
          renderMore();
        }
      }, store.state.settings.sound ? 'Включён' : 'Выключен')),
    el('hr', { class: 'sep' }),
    el('div', { class: 'spread' },
      el('span', { style: 'font-size:13.5px' }, 'Тема'),
      el('div', { class: 'row', style: 'gap:6px' },
        ...[['auto', 'Авто'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(([k, t]) =>
          el('button', {
            class: 'chip', 'aria-pressed': (store.state.settings.theme || 'auto') === k,
            onclick: () => { store.state.settings.theme = k; store.saveSettings(); applyTheme(); renderMore(); }
          }, t)))),
    el('hr', { class: 'sep' }),
    el('button', {
      class: 'btn btn-s btn-danger', style: 'align-self:flex-start', onclick: () => {
        if (store.hasPending() && !confirm('Есть несохранённые записи — они пропадут. Всё равно выйти?')) return;
        if (!confirm('Выйти и стереть дневник с этого устройства? В хранилище он останется и вернётся при следующем подключении.')) return;
        store.disconnect(); store.wipeLocal(); gatePick = null; render();
      }
    }, 'Выйти с этого устройства')));

  box.appendChild(el('div', { class: 'card stack-s' },
    el('div', { class: 'eyebrow' }, 'На экран iPhone'),
    el('div', { style: 'font-size:13px;line-height:1.55' },
      'Открой этот адрес в Safari, нажми «Поделиться» и выбери «На экран „Домой"». ',
      'Приложение запустится без адресной строки и будет работать в зале без связи — записи отправятся на сервер, когда интернет вернётся.')));

  box.appendChild(el('div', { class: 'muted', style: 'font-size:11.5px;line-height:1.5;padding:0 2px 8px' },
    'Расчёт по формуле Миффлина–Сан Жеора — это оценка, а не медицинская рекомендация. При хронических заболеваниях, травмах или приёме лекарств сначала посоветуйся с врачом.'));

  root.appendChild(box);
}

const legend = (c, t) => el('span', { class: 'row', style: 'gap:5px' },
  el('i', { style: `width:9px;height:9px;border-radius:3px;background:${c};display:block` }), t);
const opt = (v, t, cur) => el('option', { value: v, selected: String(cur) === String(v) || undefined }, t);

function downloadBackup() {
  const blob = new Blob([store.exportJSON()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tonnage-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Копия сохранена');
}

$('#importFile').addEventListener('change', async e => {
  const f = e.target.files?.[0];
  if (!f) return;
  try {
    const n = store.importJSON(await f.text());
    toast(`Восстановлено тренировок: ${n}`);
    render();
  } catch (ex) {
    alert('Не получилось прочитать файл: ' + ex.message);
  }
  e.target.value = '';
});

/* ------------------------------- тема ------------------------------- */

function applyTheme() {
  const t = store.state.settings.theme || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

/* ------------------------------- запуск ------------------------------- */

$('#tSkip').addEventListener('click', stopTimer);
$('#tPlus').addEventListener('click', () => {
  timer.endAt += 30000;
  timer.total = Math.max(timer.total, timeLeft());
  paintTimer();
});
addEventListener('scroll', () => { $('#topbar').classList.toggle('scrolled', scrollY > 6); }, { passive: true });

store.onChange(() => { if (!$('#app').hidden) renderSyncDot(); });

applyTheme();
render();
if (store.connected) store.sync(true);

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
