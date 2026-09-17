/* =====================================================================
   ТОННАЖ — схемы движения
   ---------------------------------------------------------------------
   Фигура собирается не из готовых координат, а из УГЛОВ сегментов —
   так поза описывается пятью числами вместо восемнадцати координат,
   и её видно глазами при чтении кода: «наклон 34°, бедро 80°».

   Соглашение об углах: 0° — вниз, 90° — вправо, 180° — вверх, 270° — влево.
   Фигура смотрит вправо.
   ===================================================================== */

import { EX } from './exercises.js';

const NS = 'http://www.w3.org/2000/svg';
const SEG = { torso: 30, head: 9, thigh: 26, shin: 26, foot: 11, uarm: 17, farm: 17 };
const RAD = a => (a * Math.PI) / 180;
const step = (p, a, l) => ({ x: p.x + Math.sin(RAD(a)) * l, y: p.y + Math.cos(RAD(a)) * l });

function joints(P) {
  const hip = { x: 0, y: 0 };
  const tA = 180 - P.t;
  const neck = step(hip, tA, SEG.torso);
  const head = step(neck, tA, SEG.head);
  const sh = step(hip, tA, SEG.torso * 0.84);
  const el = step(sh, P.u, SEG.uarm);
  const wr = step(el, P.f, SEG.farm);
  const kn = step(hip, P.h, SEG.thigh);
  const an = step(kn, P.s, SEG.shin);
  const toe = { x: an.x + SEG.foot, y: an.y + 2 };
  return { hip, neck, head, sh, el, wr, kn, an, toe };
}

function placed(ex, which) {
  const cfg = ex.pose;
  const P = cfg[which] || cfg.a;
  const j = joints(P);
  let dx = 0, dy = 0;
  if (cfg.ground) { dx = 56 - j.an.x; dy = 108 - j.an.y; }
  else if (cfg.pin) { dx = cfg.pin[0]; dy = cfg.pin[1]; }
  const out = {};
  for (const k in j) out[k] = { x: j[k].x + dx, y: j[k].y + dy };
  return out;
}

const lerpJ = (A, B, t) => {
  const o = {};
  for (const k in A) o[k] = { x: A[k].x + (B[k].x - A[k].x) * t, y: A[k].y + (B[k].y - A[k].y) * t };
  return o;
};

const mk = (t, at) => {
  const n = document.createElementNS(NS, t);
  for (const k in at) n.setAttribute(k, at[k]);
  return n;
};

/* Один общий цикл анимации на все видимые схемы: сто отдельных таймеров
   на экране библиотеки посадили бы батарею телефона. */
const LIVE = new Set();
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let started = false;

function loop(now) {
  if (!reduceMotion) {
    const p = now / 2600;
    for (const f of LIVE) {
      if (f.manual !== undefined || f.paused) continue;
      const x = (p + f.off) % 1;
      const tri = x < 0.5 ? x * 2 : (1 - x) * 2;
      f.draw(tri * tri * (3 - 2 * tri));
    }
  }
  requestAnimationFrame(loop);
}

export function makeFigure(exId, { animate = true, cls = 'fig' } = {}) {
  const ex = EX[exId];
  if (!ex) return document.createElementNS(NS, 'svg');
  if (!started) { started = true; requestAnimationFrame(loop); }

  const svg = mk('svg', { viewBox: '0 0 112 120', class: cls, role: 'img' });
  svg.setAttribute('aria-label', 'Схема движения: ' + ex.n);

  svg.appendChild(mk('line', {
    x1: 2, y1: 112, x2: 110, y2: 112,
    stroke: 'var(--line)', 'stroke-width': 1.6, 'stroke-linecap': 'round'
  }));

  if (ex.props) {
    const g = mk('g', { fill: 'var(--line-soft)', stroke: 'none' });
    g.innerHTML = ex.props;
    svg.appendChild(g);
  }

  let cable = null;
  if (ex.pose.cable) {
    svg.appendChild(mk('circle', { cx: ex.pose.cable[0], cy: ex.pose.cable[1], r: 3.4, fill: 'var(--line)' }));
    cable = mk('line', { stroke: 'var(--ink-3)', 'stroke-width': 1.4, 'stroke-dasharray': '3 2.5' });
    svg.appendChild(cable);
  }

  const body = mk('g', {
    fill: 'none', stroke: 'var(--ink)', 'stroke-width': 4.4,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round'
  });
  const spine = mk('path', {}), leg = mk('path', {}), arm = mk('path', {});
  const head = mk('circle', { r: 7.4, fill: 'var(--ink)', stroke: 'none' });
  body.append(leg, spine, arm, head);
  svg.appendChild(body);

  let load = null;
  if (ex.pose.bar) {
    load = mk('g', {});
    load.appendChild(mk('circle', { r: 9.5, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 4 }));
    load.appendChild(mk('circle', { r: 2.4, fill: 'var(--accent)' }));
    svg.appendChild(load);
  } else if (ex.pose.db) {
    load = mk('g', {});
    load.appendChild(mk('rect', { x: -5, y: -8, width: 10, height: 16, rx: 3, fill: 'var(--accent)' }));
    svg.appendChild(load);
  }

  const A = placed(ex, 'a');
  const B = placed(ex, 'b');
  const bounce = ex.pose.bounce ? 9 : 0;   // икры: движение мелкое, добавляем вертикальный ход
  const D = q => `M${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
  const L = q => `L${q.x.toFixed(1)} ${q.y.toFixed(1)}`;

  function draw(t) {
    rec.lastT = t;
    const j = lerpJ(A, B, t);
    if (bounce) { const dy = -bounce * t; for (const k in j) j[k] = { x: j[k].x, y: j[k].y + dy }; }
    spine.setAttribute('d', D(j.hip) + L(j.neck));
    leg.setAttribute('d', D(j.hip) + L(j.kn) + L(j.an) + L(j.toe));
    arm.setAttribute('d', D(j.sh) + L(j.el) + L(j.wr));
    head.setAttribute('cx', j.head.x);
    head.setAttribute('cy', j.head.y);
    if (load) {
      const at = ex.pose.bar === 'sh' ? j.sh : ex.pose.bar === 'hip' ? j.hip : j.wr;
      load.setAttribute('transform', `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})`);
    }
    if (cable) {
      cable.setAttribute('x1', ex.pose.cable[0]); cable.setAttribute('y1', ex.pose.cable[1]);
      cable.setAttribute('x2', j.wr.x); cable.setAttribute('y2', j.wr.y);
    }
    if (rec.onDraw) rec.onDraw(t);
  }

  const rec = { draw, off: Math.random() * 2, lastT: 0, paused: false };
  svg.figure = rec;
  draw(0);
  if (animate) LIVE.add(rec);

  rec.destroy = () => LIVE.delete(rec);
  return svg;
}

/** Освобождает все анимации — вызывается при смене экрана,
 *  иначе фигуры удалённых узлов продолжали бы считаться вечно. */
export function releaseFigures() { LIVE.clear(); }
export function attachFigure(rec) { LIVE.add(rec); }
export function detachFigure(rec) { LIVE.delete(rec); }
