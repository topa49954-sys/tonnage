/* =====================================================================
   ТОННАЖ — авторизация
   ---------------------------------------------------------------------
   Приложение личное, пользователь один. Поэтому здесь нет регистрации,
   писем и восстановления пароля — только пароль из переменной окружения
   и подписанный токен.

   Пароль хранится как scrypt-хеш: даже если кто-то прочитает .env,
   пароль оттуда не достать. Сравнение — с постоянным временем, чтобы
   по задержке ответа нельзя было подбирать пароль посимвольно.

   Токен — это подписанный HMAC-SHA256 конверт. Своя реализация вместо
   JWT-библиотеки: формат здесь нужен ровно один, а лишняя зависимость
   в проекте, который должен работать годами без обслуживания, — риск.
   ===================================================================== */

import { scryptSync, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [alg, saltB64, keyB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(keyB64, 'base64url');
    const actual = scryptSync(password, salt, expected.length, SCRYPT);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/** Секрет подписи живёт в файле рядом с базой: перезапуск сервера
 *  не должен выкидывать пользователя из приложения. */
export function loadSecret(file) {
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  mkdirSync(dirname(file), { recursive: true });
  const secret = randomBytes(48).toString('base64url');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (data, secret) => createHmac('sha256', secret).update(data).digest('base64url');

export function issueToken(secret, userId, days = 365) {
  const body = b64({ u: userId, exp: Date.now() + days * 86400000 });
  return `${body}.${sign(body, secret)}`;
}

export function verifyToken(secret, token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = sign(body, secret);
  if (mac.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload.u;
  } catch {
    return null;
  }
}

/* Простое ограничение попыток входа: защита от подбора пароля ботом,
   который нашёл открытый порт. Память процесса — этого достаточно. */
const attempts = new Map();
export function rateLimit(ip, max = 8, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const rec = attempts.get(ip) || { n: 0, until: now + windowMs };
  if (now > rec.until) { rec.n = 0; rec.until = now + windowMs; }
  rec.n++;
  attempts.set(ip, rec);
  if (attempts.size > 5000) attempts.clear();
  return rec.n <= max;
}
export function clearLimit(ip) { attempts.delete(ip); }
