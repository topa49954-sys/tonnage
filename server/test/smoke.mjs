/* =====================================================================
   Дымовой тест приложения: проходит весь путь пользователя и проверяет,
   что на каждом шаге отрисовалось то, что должно.

   Ловит именно то, что не видно в юнит-тестах: белый экран из-за ошибки
   при загрузке модуля, кнопку, которая ничего не делает, исчезающий
   экран итога. Один такой баг он уже нашёл — гонку между закрытием и
   открытием шторки.

   jsdom НЕ исполняет <script type="module">, поэтому страницу мы не
   «открываем», а поднимаем DOM как окружение, прокидываем глобальные
   объекты и импортируем настоящие модули приложения с диска. Обращения
   к /api/* уходят на живой сервер.

   ЗАПУСК (нужен jsdom, он не входит в зависимости проекта):
     npm i --no-save jsdom
     cd server && node --env-file-if-exists=.env src/index.js &
     node test/smoke.mjs

   Переменные: BASE — адрес сервера, WEB — путь к каталогу web/.
   ===================================================================== */

import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const WEB = process.env.WEB
  || resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'web');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.stack || e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));

const html = readFileSync(WEB + '/index.html', 'utf8');
const dom = new JSDOM(html, { url: BASE + '/', pretendToBeVisual: true, virtualConsole: vc });
const { window } = dom;

/* --- окружение браузера для модулей --- */
const nodeFetch = globalThis.fetch;
// Часть глобальных имён в Node доступна только на чтение (navigator),
// поэтому назначаем через defineProperty, а не присваиванием.
const def = (name, value) =>
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

def('window', window);
def('document', window.document);
def('localStorage', window.localStorage);
def('sessionStorage', window.sessionStorage);
def('navigator', window.navigator);
def('Event', window.Event);
def('CustomEvent', window.CustomEvent);
def('Blob', window.Blob);
def('URL', window.URL);
def('HTMLElement', window.HTMLElement);
def('matchMedia', window.matchMedia?.bind(window) ?? (() => ({ matches: false, addEventListener() {} })));
def('requestAnimationFrame', cb => setTimeout(() => cb(performance.now()), 16));
def('cancelAnimationFrame', id => clearTimeout(id));
def('addEventListener', window.addEventListener.bind(window));
def('removeEventListener', window.removeEventListener.bind(window));
def('scrollTo', () => {});
def('scrollY', 0);
def('confirm', () => true);
def('alert', m => errors.push('alert: ' + m));
window.matchMedia = globalThis.matchMedia;
window.scrollTo = globalThis.scrollTo;
window.confirm = globalThis.confirm;
window.alert = globalThis.alert;
window.AudioContext = function () {
  return {
    state: 'running', currentTime: 0, resume() {},
    createOscillator: () => ({ type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }),
    createGain: () => ({ gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }),
    destination: {}
  };
};
window.navigator.vibrate = () => true;
Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
def('fetch', (input, init) =>
  nodeFetch(typeof input === 'string' && input.startsWith('/') ? BASE + input : input, init));

const wait = ms => new Promise(r => setTimeout(r, ms));
const report = [];
const check = (name, ok, extra = '') => {
  report.push(`${ok ? '  ok  ' : 'ПЛОХО ' } ${name}${extra ? '  — ' + extra : ''}`);
  return ok;
};

/* --- загрузка приложения --- */
try {
  await import(pathToFileURL(WEB + '/app.js').href);
} catch (e) {
  console.log('Приложение не загрузилось:\n' + (e.stack || e.message));
  process.exit(1);
}
await wait(600);

const $ = s => window.document.querySelector(s);
const all = s => [...window.document.querySelectorAll(s)];
const txt = s => ($(s)?.textContent || '').trim();

const clickText = (sel, re, label) => {
  const b = all(sel).find(x => re.test(x.textContent));
  if (!b) { check(label || `кнопка ${re}`, false, 'не найдена'); return false; }
  b.click();
  return true;
};

try {

/* --- 1. экран выбора хранилища --- */
check('модули загрузились без ошибок', errors.length === 0, errors[0] || '');
check('показан экран выбора хранилища', !$('#gate').hidden);
check('предложены все хранилища', all('#gateBox .lib-item').length === 4,
  all('#gateBox .lib-item').map(b => b.querySelector('.exrow-name').textContent).join(', '));
check('приложение скрыто до подключения', $('#app').hidden);

/* --- 2. подключение к своему серверу --- */
const serverBtn = all('#gateBox .lib-item').find(b => /Свой сервер/.test(b.textContent));
check('есть вариант «Свой сервер»', !!serverBtn);
serverBtn?.click();
await wait(400);
check('показана инструкция по настройке', all('#gateBox .cuelist li').length >= 2,
  all('#gateBox .cuelist li').length + ' пунктов');
check('поле пароля появилось', !!$('#cfg-password'));

$('#cfg-password').value = 'test1234';
clickText('#gateBox button', /^Подключить$/, 'есть кнопка подключения');
await wait(2500);
check('подключение выполнено, приложение показано', !$('#app').hidden,
  ($('.err')?.textContent || '').trim());
check('вкладок четыре', all('#tabbar .tab').length === 4, all('#tabbar .tab').length + '');

/* --- 3. экран «Сегодня» --- */
check('план построен', txt('#scr-today .hero-title').length > 0, txt('#scr-today .hero-title'));
check('указаны блок и неделя', /Блок \d+ · неделя \d+/.test(txt('#scr-today .eyebrow')), txt('#scr-today .eyebrow'));
check('шесть упражнений', all('#scr-today .exrow').length === 6, all('#scr-today .exrow').length + '');
check('схемы движения отрисованы', all('#scr-today svg.fig, #scr-today .exrow-fig svg').length >= 6,
  all('#scr-today .exrow-fig svg').length + ' svg');
check('тренер объясняет каждое упражнение', all('#scr-today .coach').length >= 6,
  all('#scr-today .coach').length + ' пояснений');
const firstWhy = all('#scr-today .coach')[0]?.textContent.trim() || '';
check('пояснение осмысленное', firstWhy.length > 40, firstWhy.slice(0, 70) + '…');

/* --- 4. старт --- */
const startBtn = all('#scr-today .hero button').find(b => /Начать/.test(b.textContent));
check('есть кнопка старта', !!startBtn);
startBtn.click();
await wait(400);
check('тренировка началась', /Идёт тренировка/.test(txt('#scr-today .eyebrow')), txt('#scr-today .eyebrow'));
check('поля подходов появились', all('#scr-today .setline').length >= 18, all('#scr-today .setline').length + ' строк');

/* --- 5. запись подходов ---
   Отмечаем 2 подхода из 3: после последнего подхода упражнения таймер
   отдыха обязан остановиться, и тогда проверка ниже была бы бессмысленной. */
const dayBefore = txt('#scr-today .eyebrow');
for (const line of all('#scr-today .setline').slice(0, 2)) {
  const [w, r] = line.querySelectorAll('input');
  if (!w.disabled) { w.value = '50'; w.dispatchEvent(new window.Event('input')); }
  r.value = '8'; r.dispatchEvent(new window.Event('input'));
  line.querySelector('.tick').click();
  await wait(60);
}
check('подходы отмечаются', all('#scr-today .setline.done').length === 2,
  all('#scr-today .setline.done').length + ' из 2');
check('таймер отдыха запустился', !$('#timerbar').hidden, 'осталось ' + txt('#tLeft'));

/* --- 6. завершение и обратная связь --- */
clickText('#scr-today button', /Завершить тренировку/, 'есть кнопка завершения');
await wait(300);
check('спрашивает, как прошло', /Как прошло/.test(txt('#sheetInner')));
const fbOptions = all('#sheetInner .lib-item');
check('предложены варианты оценки', fbOptions.length === 4, fbOptions.length + '');
fbOptions[1]?.click();     // «Нормально»
await wait(900);
check('тренировка записана', /Готово/.test(txt('#sheetInner')), txt('#sheetInner').slice(0, 40));
check('показан план следующей', /Следующая тренировка/.test(txt('#sheetInner')));
check('итог содержит тоннаж', /тоннаж/.test(txt('#sheetInner')));

clickText('#sheetInner button', /^Закрыть$/, 'есть кнопка закрытия итога');
await wait(500);

/* --- 7. движок учёл результат --- */
const dayAfter = txt('#scr-today .eyebrow');
check('движок перешёл к следующему дню', dayBefore !== dayAfter, `${dayBefore}  →  ${dayAfter}`);
check('таймер остановлен после завершения', $('#timerbar').hidden);

/* --- 8. остальные экраны --- */
const tabs = all('#tabbar .tab');
for (const [i, name] of ['Сегодня', 'Путь', 'База', 'Ещё'].entries()) {
  tabs[i].click();
  await wait(500);
  const scr = ['#scr-today', '#scr-path', '#scr-lib', '#scr-more'][i];
  check(`вкладка «${name}» рисуется`, txt(scr).length > 150, txt(scr).length + ' символов');
}

tabs[1].click(); await wait(400);
check('путь показывает пройденное', /блок/i.test(txt('#scr-path')), '');
check('журнал содержит тренировку', all('#scr-path .lib-item').length >= 1,
  all('#scr-path .lib-item').length + ' записей');

/* --- 9. база упражнений --- */
tabs[2].click(); await wait(500);
check('в базе 44 упражнения', all('#scr-lib .lib-item').length === 44, all('#scr-lib .lib-item').length + '');
all('#scr-lib .lib-item')[0]?.click();
await wait(500);
check('карточка открылась', !$('#sheet').hidden);
check('есть подсказки по технике', all('#sheetInner .cuelist li').length >= 4,
  all('#sheetInner .cuelist li').length + ' пунктов');
check('есть частые ошибки', all('#sheetInner .errlist li').length >= 3,
  all('#sheetInner .errlist li').length + ' пунктов');
check('есть ссылка на видео', !!$('#sheetInner a[href*="youtube"]'));
check('есть схема со слайдером', !!$('#sheetInner input.scrub'));

/* --- 10. питание --- */
tabs[3].click(); await wait(500);
check('калории посчитаны', /ккал\/день/.test(txt('#scr-more')), '');
check('белок посчитан', /белок/.test(txt('#scr-more')));

} catch (e) {
  errors.push('тест прервался: ' + (e.stack || e.message));
}

console.log('\n' + report.join('\n'));
const bad = report.filter(r => r.startsWith('ПЛОХО'));
if (errors.length) {
  console.log('\nОшибки страницы:');
  for (const e of errors.slice(0, 6)) console.log('  ' + String(e).split('\n').slice(0, 4).join('\n  '));
}
console.log(`\nИтог: ${report.length - bad.length} из ${report.length} проверок пройдено`);
process.exit(bad.length || errors.length ? 1 : 0);
