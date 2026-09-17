/* =====================================================================
   ТОННАЖ — графики
   ---------------------------------------------------------------------
   Одна серия на график, поэтому легенда не нужна — заголовок называет
   величину. Цвет берётся из токенов темы, подписи — цветом текста, а не
   цветом линии: так график читается и в светлой, и в тёмной теме.
   Последняя точка подписана значением — обычно именно её и ищут.
   ===================================================================== */

const NS = 'http://www.w3.org/2000/svg';
const mk = (t, a) => { const n = document.createElementNS(NS, t); for (const k in a) n.setAttribute(k, a[k]); return n; };
const fmtDate = k => { const [, m, d] = k.split('-'); return `${d}.${m}`; };

function niceTicks(min, max, n = 3) {
  if (!(max > min)) return [min];
  const raw = (max - min) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const stepV = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || mag * 10;
  const out = [];
  for (let v = Math.ceil(min / stepV) * stepV; v <= max + 1e-9; v += stepV) out.push(+v.toFixed(6));
  return out.length ? out : [min, max];
}

function shell() {
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  const tip = document.createElement('div');
  tip.className = 'tip';
  return { wrap, tip };
}

export function lineChart(data, { unit = '', color = 'var(--accent)', fmt } = {}) {
  const W = 320, H = 152, PL = 32, PR = 10, PT = 14, PB = 22;
  const { wrap, tip } = shell();
  if (!data.length) return wrap;

  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart' });
  const ys = data.map(d => d.y);
  const lo = Math.min(...ys), hi = Math.max(...ys);
  const padY = (hi - lo) * 0.18 || Math.max(1, Math.abs(hi) * 0.05) || 1;
  const y0 = lo - padY, y1 = hi + padY;
  const X = i => PL + (data.length < 2 ? (W - PL - PR) / 2 : (i * (W - PL - PR)) / (data.length - 1));
  const Y = v => PT + (H - PT - PB) * (1 - (v - y0) / (y1 - y0 || 1));

  for (const t of niceTicks(y0, y1, 3)) {
    svg.appendChild(mk('line', { x1: PL, x2: W - PR, y1: Y(t), y2: Y(t), stroke: 'var(--line-soft)', 'stroke-width': 1 }));
    const tx = mk('text', { x: PL - 5, y: Y(t) + 3, 'text-anchor': 'end' });
    tx.textContent = Math.round(t);
    svg.appendChild(tx);
  }

  const d = data.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ');
  svg.appendChild(mk('path', {
    d: d + ` L${X(data.length - 1).toFixed(1)} ${Y(y0)} L${X(0).toFixed(1)} ${Y(y0)} Z`,
    fill: color, opacity: 0.1, stroke: 'none'
  }));
  svg.appendChild(mk('path', {
    d, fill: 'none', stroke: color, 'stroke-width': 2,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round'
  }));

  data.forEach((p, i) => {
    const last = i === data.length - 1;
    svg.appendChild(mk('circle', {
      cx: X(i), cy: Y(p.y), r: last ? 4.5 : 3,
      fill: last ? color : 'var(--card)', stroke: color, 'stroke-width': 2
    }));
  });

  const ends = data.length > 1 ? [0, data.length - 1] : [0];
  for (const i of ends) {
    const tx = mk('text', { x: X(i), y: H - 6, 'text-anchor': i === 0 && data.length > 1 ? 'start' : data.length > 1 ? 'end' : 'middle' });
    tx.textContent = fmtDate(data[i].x);
    svg.appendChild(tx);
  }

  const lastLabel = mk('text', {
    x: X(data.length - 1), y: Math.max(10, Y(data[data.length - 1].y) - 9),
    'text-anchor': 'end', fill: 'var(--ink)', 'font-weight': '600'
  });
  lastLabel.textContent = (fmt ? fmt(data[data.length - 1].y) : data[data.length - 1].y) + unit;
  svg.appendChild(lastLabel);

  const cross = mk('line', { stroke: 'var(--ink-3)', 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0 });
  svg.appendChild(cross);
  svg.appendChild(mk('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent' }));

  const at = e => {
    const r = svg.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const px = ((cx - r.left) / r.width) * W;
    let i = 0, best = Infinity;
    data.forEach((p, k) => { const dd = Math.abs(X(k) - px); if (dd < best) { best = dd; i = k; } });
    cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i));
    cross.setAttribute('y1', PT); cross.setAttribute('y2', H - PB);
    cross.setAttribute('opacity', 0.5);
    tip.textContent = `${fmtDate(data[i].x)} · ${fmt ? fmt(data[i].y) : data[i].y}${unit}` + (data[i].raw ? ` (${data[i].raw})` : '');
    tip.style.left = `${(X(i) / W) * 100}%`;
    tip.style.top = `${(Y(data[i].y) / H) * 100}%`;
    tip.classList.add('on');
  };
  svg.addEventListener('mousemove', at);
  svg.addEventListener('touchstart', at, { passive: true });
  svg.addEventListener('touchmove', at, { passive: true });
  const off = () => { tip.classList.remove('on'); cross.setAttribute('opacity', 0); };
  svg.addEventListener('mouseleave', off);
  svg.addEventListener('touchend', off);

  wrap.append(svg, tip);
  return wrap;
}

export function barChart(data, { unit = '', color = 'var(--signal)', label = d => fmtDate(d.x) } = {}) {
  const W = 320, H = 132, PL = 36, PR = 8, PT = 12, PB = 20;
  const { wrap, tip } = shell();
  if (!data.length) return wrap;

  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart' });
  const hi = Math.max(...data.map(d => d.y), 1);
  const Y = v => PT + (H - PT - PB) * (1 - v / hi);
  const slot = (W - PL - PR) / data.length;
  const bw = Math.min(28, slot - 5);

  for (const t of niceTicks(0, hi, 2)) {
    svg.appendChild(mk('line', { x1: PL, x2: W - PR, y1: Y(t), y2: Y(t), stroke: 'var(--line-soft)', 'stroke-width': 1 }));
    const tx = mk('text', { x: PL - 5, y: Y(t) + 3, 'text-anchor': 'end' });
    tx.textContent = t >= 1000 ? Math.round(t / 1000) + 'к' : Math.round(t);
    svg.appendChild(tx);
  }

  data.forEach((p, i) => {
    const x = PL + i * slot + (slot - bw) / 2;
    const r = mk('rect', {
      x, y: Y(p.y), width: bw, height: Math.max(2, H - PB - Y(p.y)), rx: 4,
      fill: color, opacity: i === data.length - 1 ? 1 : 0.55
    });
    const show = () => {
      tip.textContent = `${label(p)} · ${p.y.toLocaleString('ru-RU')}${unit}`;
      tip.style.left = `${((x + bw / 2) / W) * 100}%`;
      tip.style.top = `${(Y(p.y) / H) * 100}%`;
      tip.classList.add('on');
    };
    r.addEventListener('mouseenter', show);
    r.addEventListener('touchstart', show, { passive: true });
    r.addEventListener('mouseleave', () => tip.classList.remove('on'));
    svg.appendChild(r);
    if (i === 0 || i === data.length - 1) {
      const tx = mk('text', { x: x + bw / 2, y: H - 5, 'text-anchor': 'middle' });
      tx.textContent = fmtDate(p.x);
      svg.appendChild(tx);
    }
  });

  wrap.append(svg, tip);
  return wrap;
}
