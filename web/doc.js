/* =====================================================================
   ТОННАЖ — документ дневника и слияние версий
   ---------------------------------------------------------------------
   Весь дневник — один JSON-документ. Год тренировок это примерно 80 КБ,
   поэтому дробить его на записи и городить инкрементальную синхронизацию
   незачем: проще целиком прочитать и целиком записать. Меньше кода —
   меньше мест, где данные могут потеряться.

   Конфликты разрешаются по последней правке (last-write-wins) на уровне
   отдельной записи, а не всего файла. Это важно: если телефон записал
   тренировку офлайн, а с компьютера в это время поправили вес тела,
   при слиянии должно уцелеть и то, и другое.
   ===================================================================== */

export const DOC_VERSION = 2;

export const emptyDoc = () => ({
  version: DOC_VERSION,
  sessions: [],
  body: {},
  settings: null
});

export function normalizeDoc(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const doc = emptyDoc();

  if (Array.isArray(d.sessions)) {
    doc.sessions = d.sessions.filter(s => s && typeof s.id === 'string');
  }

  // Вес тела раньше хранился как {дата: число}, теперь {дата: {kg, updated_at}}.
  // Старый формат должен читаться — иначе обновление приложения стёрло бы историю.
  if (d.body && typeof d.body === 'object') {
    for (const [date, v] of Object.entries(d.body)) {
      if (typeof v === 'number') doc.body[date] = { kg: v, updated_at: 0 };
      else if (v && typeof v.kg === 'number') doc.body[date] = { kg: v.kg, updated_at: +v.updated_at || 0 };
    }
  }

  if (d.settings && typeof d.settings === 'object') doc.settings = d.settings;
  return doc;
}

/** Слияние двух версий дневника. Побеждает более поздняя правка записи. */
export function mergeDocs(a, b) {
  const left = normalizeDoc(a);
  const right = normalizeDoc(b);
  const out = emptyDoc();

  const byId = new Map();
  for (const s of left.sessions) byId.set(s.id, s);
  for (const s of right.sessions) {
    const mine = byId.get(s.id);
    if (!mine || (+s.updated_at || 0) >= (+mine.updated_at || 0)) byId.set(s.id, s);
  }
  out.sessions = [...byId.values()]
    .filter(s => !s.deleted)
    .sort((x, y) => (x.id < y.id ? -1 : 1));

  out.body = { ...left.body };
  for (const [date, row] of Object.entries(right.body)) {
    const mine = out.body[date];
    if (!mine || (row.updated_at || 0) >= (mine.updated_at || 0)) out.body[date] = row;
  }

  const ls = left.settings, rs = right.settings;
  out.settings = !ls ? rs : !rs ? ls
    : (+rs.updated_at || 0) >= (+ls.updated_at || 0) ? rs : ls;

  return out;
}

export const docStats = doc => ({
  sessions: doc.sessions.length,
  weighIns: Object.keys(doc.body).length,
  bytes: JSON.stringify(doc).length
});

/* ---------- base64 для UTF-8 (GitHub принимает содержимое только так) ---------- */

export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  // Порциями: развернуть большой массив в аргументы одним вызовом нельзя —
  // на длинном дневнике это уронит стек.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Ошибка, на которую хранилище отвечает «у меня версия новее». */
export class ConflictError extends Error {
  constructor(msg = 'Данные на сервере изменились') { super(msg); this.code = 'conflict'; }
}
