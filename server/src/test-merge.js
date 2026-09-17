/* =====================================================================
   Проверка слияния версий дневника.
   Это самое опасное место приложения: ошибка здесь не падает с ошибкой,
   а тихо теряет тренировки. Поэтому проверяется отдельно.

   Запуск: npm test
   ===================================================================== */

import { mergeDocs, normalizeDoc, toBase64, fromBase64, emptyDoc } from '../../web/doc.js';

// btoa/atob есть в Node как глобальные, TextEncoder тоже — заглушки не нужны.

let passed = 0, failed = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function test(name, fn) {
  try {
    const r = fn();
    if (r === true) { passed++; console.log('  ok   ' + name); }
    else { failed++; console.log('ПЛОХО  ' + name + (r ? '  — ' + r : '')); }
  } catch (e) {
    failed++;
    console.log('ПЛОХО  ' + name + '  — ' + e.message);
  }
}

const S = (id, updated_at, extra = {}) => ({ id, updated_at, entries: { squat: [{ w: 50, r: 8 }] }, ...extra });

console.log('\nСлияние дневника\n' + '─'.repeat(60));

test('записи с разных устройств складываются, а не затирают друг друга', () => {
  const a = { sessions: [S('s1', 100)], body: {}, settings: null };
  const b = { sessions: [S('s2', 200)], body: {}, settings: null };
  const m = mergeDocs(a, b);
  return m.sessions.length === 2 || `получилось ${m.sessions.length}`;
});

test('при одинаковом id побеждает более поздняя правка', () => {
  const a = { sessions: [S('s1', 100, { note: 'старое' })] };
  const b = { sessions: [S('s1', 200, { note: 'новое' })] };
  return mergeDocs(a, b).sessions[0].note === 'новое';
});

test('порядок аргументов не влияет на исход', () => {
  const a = { sessions: [S('s1', 300, { note: 'свежее' })] };
  const b = { sessions: [S('s1', 100, { note: 'старое' })] };
  return mergeDocs(a, b).sessions[0].note === 'свежее'
      && mergeDocs(b, a).sessions[0].note === 'свежее';
});

test('удалённая тренировка не воскресает при слиянии', () => {
  const remote = { sessions: [S('s1', 100)] };
  const local = { sessions: [{ id: 's1', updated_at: 200, deleted: 1, entries: {} }] };
  return mergeDocs(remote, local).sessions.length === 0;
});

test('удаление старше правки — тренировка остаётся', () => {
  const remote = { sessions: [S('s1', 300, { note: 'вернули' })] };
  const local = { sessions: [{ id: 's1', updated_at: 100, deleted: 1, entries: {} }] };
  const m = mergeDocs(remote, local);
  return m.sessions.length === 1 && m.sessions[0].note === 'вернули';
});

test('тренировки отсортированы по id', () => {
  const a = { sessions: [S('s3', 1), S('s1', 1)] };
  const b = { sessions: [S('s2', 1)] };
  return eq(mergeDocs(a, b).sessions.map(s => s.id), ['s1', 's2', 's3']);
});

console.log('\nВес тела\n' + '─'.repeat(60));

test('взвешивания за разные дни складываются', () => {
  const a = { body: { '2026-09-01': { kg: 72, updated_at: 1 } } };
  const b = { body: { '2026-09-03': { kg: 73, updated_at: 2 } } };
  return Object.keys(mergeDocs(a, b).body).length === 2;
});

test('за один день побеждает поздняя запись', () => {
  const a = { body: { '2026-09-01': { kg: 72, updated_at: 100 } } };
  const b = { body: { '2026-09-01': { kg: 74, updated_at: 200 } } };
  return mergeDocs(a, b).body['2026-09-01'].kg === 74;
});

test('старый формат {дата: число} читается, а не теряется', () => {
  const old = { body: { '2026-09-01': 71.5 } };
  const n = normalizeDoc(old);
  return n.body['2026-09-01'].kg === 71.5;
});

test('мусор в весе тела отбрасывается без падения', () => {
  const n = normalizeDoc({ body: { a: null, b: 'ерунда', c: { kg: 70, updated_at: 5 } } });
  return Object.keys(n.body).length === 1 && n.body.c.kg === 70;
});

console.log('\nНастройки и устойчивость\n' + '─'.repeat(60));

test('настройки берутся более свежие', () => {
  const a = { settings: { sound: true, updated_at: 100 } };
  const b = { settings: { sound: false, updated_at: 200 } };
  return mergeDocs(a, b).settings.sound === false;
});

test('пустая сторона не стирает настройки', () => {
  const a = { settings: { sound: false, updated_at: 100 } };
  return mergeDocs(a, emptyDoc()).settings?.sound === false;
});

test('слияние с мусором не падает', () => {
  return mergeDocs(null, undefined).sessions.length === 0
      && mergeDocs('строка', 42).sessions.length === 0;
});

test('записи без id отбрасываются', () => {
  const n = normalizeDoc({ sessions: [{ id: 'ok', updated_at: 1 }, { updated_at: 2 }, null] });
  return n.sessions.length === 1;
});

console.log('\nКодирование для GitHub\n' + '─'.repeat(60));

test('кириллица переживает base64 в обе стороны', () => {
  const src = JSON.stringify({ n: 'Приседания со штангой', e: 'ё—«»', emoji: '🏋️' });
  return fromBase64(toBase64(src)) === src;
});

test('длинный дневник кодируется без переполнения стека', () => {
  const big = JSON.stringify({ sessions: Array.from({ length: 4000 }, (_, i) => S('s' + i, i)) });
  const back = fromBase64(toBase64(big));
  return back === big || `длина ${back.length} вместо ${big.length}`;
});

test('base64 с переносами строк (так отдаёт GitHub) читается', () => {
  const src = 'Тренировка';
  const withBreaks = toBase64(src).replace(/(.{4})/g, '$1\n');
  return fromBase64(withBreaks) === src;
});

console.log('\n' + '─'.repeat(60));
console.log(`Итог: ${passed} пройдено, ${failed} провалено\n`);
process.exit(failed ? 1 : 0);
