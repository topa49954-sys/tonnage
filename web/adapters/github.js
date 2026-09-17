/* =====================================================================
   Хранилище: приватный репозиторий GitHub
   ---------------------------------------------------------------------
   Дневник лежит одним JSON-файлом в репозитории. Каждое сохранение —
   коммит, поэтому бесплатно получается полная история версий: можно
   открыть на сайте GitHub и посмотреть любую прошлую тренировку, даже
   если её случайно удалили.

   Проверено: api.github.com отдаёт Access-Control-Allow-Origin: * и
   разрешает PUT с заголовком Authorization, то есть браузеру не нужен
   никакой промежуточный сервер.

   Конфликт версий ловится штатно: GitHub принимает запись только с
   актуальным sha файла. Не совпал — значит кто-то записал раньше нас,
   и store.js сольёт версии и повторит.
   ===================================================================== */

import { ConflictError, toBase64, fromBase64 } from '../doc.js';

const API = 'https://api.github.com';

const headers = cfg => ({
  authorization: 'Bearer ' + cfg.token.trim(),
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28'
});

const fileUrl = cfg =>
  `${API}/repos/${cfg.repo.trim()}/contents/${encodeURIComponent((cfg.path || 'tonnage.json').trim())}`;

async function readError(r) {
  let msg = '';
  try { msg = (await r.json()).message || ''; } catch {}
  if (r.status === 401) return 'Токен не принят. Проверь, что скопировал его целиком.';
  if (r.status === 403) return msg.includes('rate limit')
    ? 'GitHub временно ограничил запросы. Попробуй через несколько минут.'
    : 'Нет прав. У токена должен быть доступ Contents: Read and write к этому репозиторию.';
  if (r.status === 404) return 'Репозиторий не найден. Проверь формат: логин/название.';
  return msg || `Ошибка GitHub (${r.status})`;
}

export default {
  id: 'github',
  name: 'GitHub',
  tagline: 'Приватный репозиторий. Каждое сохранение — коммит, вся история хранится.',
  needsNetwork: true,

  fields: [
    { key: 'repo', label: 'Репозиторий', placeholder: 'логин/tonnage-data', type: 'text' },
    { key: 'token', label: 'Токен доступа', placeholder: 'github_pat_...', type: 'password' },
    { key: 'path', label: 'Имя файла', placeholder: 'tonnage.json', type: 'text', optional: true }
  ],

  help: [
    'Создай **приватный** репозиторий, например `tonnage-data`. Пустой, без файлов.',
    'Зайди в Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.',
    'В Repository access выбери только этот репозиторий. В Permissions поставь Contents: Read and write. Остальное не нужно.',
    'Срок действия поставь максимальный, иначе придётся перевыпускать. Скопируй токен — GitHub покажет его один раз.'
  ],

  async check(cfg) {
    if (!cfg.repo || !cfg.repo.includes('/')) throw new Error('Репозиторий указывается как логин/название');
    if (!cfg.token) throw new Error('Нужен токен доступа');
    const r = await fetch(`${API}/repos/${cfg.repo.trim()}`, { headers: headers(cfg) });
    if (!r.ok) throw new Error(await readError(r));
    const repo = await r.json();
    if (!repo.private) {
      // Не отказываем: это осознанный выбор пользователя. Но предупредить обязаны —
      // в публичном репозитории дневник будет виден кому угодно.
      return { ok: true, warn: 'Репозиторий публичный: дневник смогут прочитать все. Лучше сделать его приватным в настройках репозитория.' };
    }
    return { ok: true, info: repo.full_name };
  },

  async load(cfg) {
    const r = await fetch(fileUrl(cfg), { headers: headers(cfg), cache: 'no-store' });
    if (r.status === 404) return { doc: null, rev: null };
    if (!r.ok) throw new Error(await readError(r));
    const body = await r.json();
    return { doc: JSON.parse(fromBase64(body.content)), rev: body.sha };
  },

  async save(cfg, doc, rev) {
    const payload = {
      message: `Тренировок: ${doc.sessions.length} · ${new Date().toLocaleString('ru-RU')}`,
      content: toBase64(JSON.stringify(doc, null, 1))
    };
    if (rev) payload.sha = rev;

    const r = await fetch(fileUrl(cfg), {
      method: 'PUT',
      headers: { ...headers(cfg), 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (r.status === 409 || r.status === 422) throw new ConflictError();
    if (!r.ok) throw new Error(await readError(r));
    const body = await r.json();
    return { rev: body.content?.sha || null };
  }
};
