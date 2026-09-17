/* =====================================================================
   Хранилище: свой сервер
   ---------------------------------------------------------------------
   Тот же серверный код, что лежит в каталоге server/. Нужен, если однажды
   захочется полного контроля: свой домен, своя база, никакой зависимости
   от чужих правил. Здесь он приведён к общему виду «прочитать документ —
   записать документ», чтобы store.js работал со всеми хранилищами
   одинаково.

   Сервер сам разрешает конфликты по каждой записи, поэтому версия (rev)
   ему не нужна.
   ===================================================================== */

const base = cfg => (cfg.url || '').trim().replace(/\/+$/, '');

export default {
  id: 'server',
  name: 'Свой сервер',
  tagline: 'Полный контроль: свой домен и своя база. Требует VPS, примерно 200–400 ₽ в месяц.',
  needsNetwork: true,

  fields: [
    { key: 'url', label: 'Адрес', placeholder: 'https://твой-домен.ru', type: 'text', optional: true },
    { key: 'password', label: 'Пароль', placeholder: '', type: 'password' }
  ],

  help: [
    'Разверни сервер по инструкции из файла DEPLOY.md — это каталог `server/` в проекте.',
    'Адрес можно не указывать, если приложение открыто с того же домена, где стоит сервер.',
    'Пароль тот, что задан на сервере в файле `.env`.'
  ],

  async check(cfg) {
    const r = await fetch(base(cfg) + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: cfg.password })
    });
    if (r.status === 401) throw new Error('Неверный пароль');
    if (r.status === 429) throw new Error('Слишком много попыток. Подожди 15 минут.');
    if (!r.ok) throw new Error('Сервер недоступен');
    const { token } = await r.json();
    // Пароль дальше не храним — только выданный им токен.
    return { ok: true, cfg: { url: cfg.url || '', token } };
  },

  async load(cfg) {
    const data = await this._sync(cfg, { since: 0 });
    const body = {};
    for (const row of data.body || []) body[row.date] = { kg: row.kg, updated_at: row.updated_at };
    return {
      doc: {
        version: 2,
        sessions: (data.sessions || []).filter(s => !s.deleted),
        body,
        settings: data.settings || null
      },
      rev: null
    };
  },

  async save(cfg, doc) {
    await this._sync(cfg, {
      since: Date.now(),                       // читать ничего не нужно, только записать
      sessions: doc.sessions,
      body: Object.entries(doc.body).map(([date, v]) => ({ date, kg: v.kg, updated_at: v.updated_at })),
      settings: doc.settings
    });
    return { rev: null };
  },

  async _sync(cfg, payload) {
    const r = await fetch(base(cfg) + '/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.token },
      body: JSON.stringify(payload)
    });
    if (r.status === 401) throw new Error('Сессия истекла — войди заново');
    if (!r.ok) throw new Error('Сервер недоступен');
    return r.json();
  }
};
