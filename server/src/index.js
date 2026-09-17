/* =====================================================================
   ТОННАЖ — сервер
   ---------------------------------------------------------------------
   Отдаёт статику приложения и API синхронизации. Один процесс, один
   файл базы, ноль npm-зависимостей — на хостинге нечего устанавливать
   и нечему ломаться при обновлении.

   Nginx впереди занимается HTTPS (он обязателен: без него iPhone не
   поставит приложение на рабочий стол и не даст работать офлайн).
   ===================================================================== */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import {
  hashPassword, verifyPassword, loadSecret,
  issueToken, verifyToken, rateLimit, clearLimit
} from './auth.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const PORT     = Number(process.env.PORT || 8080);
const HOST     = process.env.HOST || '127.0.0.1';
const DATA_DIR = process.env.TONNAGE_DATA || join(ROOT, 'data');
const WEB_DIR  = process.env.TONNAGE_WEB  || join(ROOT, 'web');
const USER_ID  = 1;

/* ---------- утилита для первичной настройки: npm run hash -- мойпароль ---------- */
if (process.argv[2] === 'hash') {
  const pw = process.argv[3];
  if (!pw) { console.error('Использование: npm run hash -- <пароль>'); process.exit(1); }
  console.log('\nДобавь эту строку в .env:\n');
  console.log('TONNAGE_PASSWORD_HASH=' + hashPassword(pw) + '\n');
  process.exit(0);
}

/* ---------- пароль ---------- */
let PASSWORD_HASH = process.env.TONNAGE_PASSWORD_HASH;
if (!PASSWORD_HASH) {
  const plain = process.env.TONNAGE_PASSWORD;
  if (!plain) {
    console.error('\n[тоннаж] Не задан пароль. Укажи в .env одно из двух:');
    console.error('  TONNAGE_PASSWORD=твойпароль            (просто)');
    console.error('  TONNAGE_PASSWORD_HASH=scrypt$...       (правильнее, см. npm run hash)\n');
    process.exit(1);
  }
  PASSWORD_HASH = hashPassword(plain);
  console.warn('[тоннаж] Пароль задан открытым текстом. Лучше: npm run hash -- <пароль>');
}

const db = openDb(join(DATA_DIR, 'tonnage.db'));
const SECRET = loadSecret(join(DATA_DIR, '.secret'));

/* ---------- помощники ---------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2': 'font/woff2'
};

const send = (res, code, body, headers = {}) => {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...headers
  });
  res.end(data);
};

const readBody = req => new Promise((ok, fail) => {
  let size = 0; const chunks = [];
  req.on('data', c => {
    size += c.length;
    if (size > 4 * 1024 * 1024) { fail(new Error('too_large')); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
    catch { fail(new Error('bad_json')); }
  });
  req.on('error', fail);
});

const clientIp = req =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket.remoteAddress || 'unknown';

const authUser = req => {
  const h = req.headers.authorization || '';
  return verifyToken(SECRET, h.startsWith('Bearer ') ? h.slice(7) : null);
};

/* ---------- статика ---------- */

async function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';

  const target = join(WEB_DIR, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!target.startsWith(WEB_DIR)) return send(res, 403, { error: 'forbidden' });

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
    const ext = extname(target).toLowerCase();

    // Сборки нет, и к именам файлов не приклеен хеш версии. Поэтому код
    // приложения кэшировать «на неделю» нельзя: правка не доехала бы до
    // телефона, который уже поставил приложение на экран. Вместо этого —
    // ETag: браузер спрашивает «не изменилось?» и обычно получает 304
    // без тела. Иконки меняются раз в жизни, им длинный кэш можно.
    const immutable = ext === '.png' || ext === '.ico' || ext === '.woff2';
    const etag = `W/"${info.size.toString(36)}-${Math.floor(info.mtimeMs).toString(36)}"`;

    const headers = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=2592000' : 'no-cache',
      'etag': etag,
      'last-modified': new Date(info.mtimeMs).toUTCString(),
      'x-content-type-options': 'nosniff'
    };

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }

    const data = await readFile(target);
    headers['content-length'] = data.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    // SPA: неизвестный путь без расширения отдаём как приложение
    if (!extname(rel)) {
      try {
        const html = await readFile(join(WEB_DIR, 'index.html'));
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-cache' });
        return res.end(html);
      } catch {}
    }
    send(res, 404, { error: 'not_found' });
  }
}

/* ---------- API ---------- */

async function api(req, res, path) {
  if (path === '/api/health') {
    return send(res, 200, { ok: true, sessions: db.count(USER_ID), time: Date.now() });
  }

  if (path === '/api/login' && req.method === 'POST') {
    const ip = clientIp(req);
    if (!rateLimit(ip)) {
      return send(res, 429, { error: 'Слишком много попыток. Подожди 15 минут.' });
    }
    const body = await readBody(req).catch(() => null);
    if (!body || typeof body.password !== 'string') {
      return send(res, 400, { error: 'Нужен пароль' });
    }
    if (!verifyPassword(body.password, PASSWORD_HASH)) {
      return send(res, 401, { error: 'Неверный пароль' });
    }
    clearLimit(ip);
    return send(res, 200, { token: issueToken(SECRET, USER_ID) });
  }

  if (path === '/api/sync' && req.method === 'POST') {
    const user = authUser(req);
    if (!user) return send(res, 401, { error: 'Нужен вход' });

    let body;
    try { body = await readBody(req); }
    catch (e) {
      return send(res, e.message === 'too_large' ? 413 : 400, { error: 'Некорректные данные' });
    }

    const srv = Date.now();
    try {
      db.applyChanges(user, body, srv);
    } catch (e) {
      console.error('[тоннаж] ошибка записи:', e.message);
      return send(res, 500, { error: 'Не удалось сохранить' });
    }

    const since = Number(body.since) || 0;
    const changes = db.changesSince(user, since);
    return send(res, 200, { ...changes, now: srv });
  }

  if (path === '/api/export') {
    const user = authUser(req);
    if (!user) return send(res, 401, { error: 'Нужен вход' });
    const all = db.changesSince(user, 0);
    return send(res, 200, { version: 1, exported_at: new Date().toISOString(), ...all }, {
      'content-disposition': `attachment; filename="tonnage-backup-${new Date().toISOString().slice(0, 10)}.json"`
    });
  }

  return send(res, 404, { error: 'not_found' });
}

/* ---------- сервер ---------- */

const server = createServer(async (req, res) => {
  const path = (req.url || '/').split('?')[0];
  try {
    if (path.startsWith('/api/')) return await api(req, res, path);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method_not_allowed' });
    return await serveStatic(req, res, req.url || '/');
  } catch (e) {
    console.error('[тоннаж]', e);
    if (!res.headersSent) send(res, 500, { error: 'internal' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[тоннаж] сервер на http://${HOST}:${PORT}`);
  console.log(`[тоннаж] база: ${join(DATA_DIR, 'tonnage.db')}`);
  console.log(`[тоннаж] статика: ${WEB_DIR}`);
  console.log(`[тоннаж] тренировок в базе: ${db.count(USER_ID)}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\n[тоннаж] останавливаюсь…');
    server.close(() => { try { db.raw.close(); } catch {} process.exit(0); });
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
