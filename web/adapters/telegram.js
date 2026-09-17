/* =====================================================================
   Хранилище: Telegram
   ---------------------------------------------------------------------
   Дневник отправляется боту файлом и закрепляется в чате. Закреплённое
   сообщение играет роль «текущей версии»: приложение читает именно его,
   а прошлые остаются в переписке как история — их видно и можно скачать
   руками с любого устройства.

   Почему именно так: Telegram не блокируется в России, ничего не стоит,
   не засыпает, и — проверено — api.telegram.org отдаёт
   Access-Control-Allow-Origin: * и на вызовы API, и на скачивание файлов.
   Значит браузеру не нужен промежуточный сервер.

   Отправка файла идёт через FormData: у multipart/form-data тип запроса
   разрешён CORS по умолчанию, предварительный запрос не требуется.
   ===================================================================== */

import { ConflictError } from '../doc.js';

const api = (cfg, method) => `https://api.telegram.org/bot${cfg.token.trim()}/${method}`;

async function call(cfg, method, params) {
  const r = await fetch(api(cfg, method), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params || {})
  });
  const body = await r.json().catch(() => ({}));
  if (!body.ok) {
    const d = String(body.description || '');
    if (d.includes('bot token')) throw new Error('Токен бота не принят. Проверь, что скопировал строку целиком.');
    if (d.includes('chat not found')) throw new Error('Чат не найден. Напиши боту любое сообщение и нажми «Определить чат».');
    if (d.includes('not enough rights') || d.includes('CHAT_ADMIN_REQUIRED'))
      throw new Error('У бота нет прав закреплять сообщения. В канале сделай его администратором.');
    throw new Error(d || 'Telegram вернул ошибку');
  }
  return body.result;
}

export default {
  id: 'telegram',
  name: 'Telegram',
  tagline: 'Бот присылает дневник файлом и закрепляет его. Не блокируется, ничего не стоит.',
  needsNetwork: true,

  fields: [
    { key: 'token', label: 'Токен бота', placeholder: '1234567890:AA...', type: 'password' },
    { key: 'chatId', label: 'ID чата', placeholder: 'нажми «Определить чат»', type: 'text' }
  ],

  help: [
    'Открой в Telegram бота **@BotFather**, отправь `/newbot` и придумай имя. В ответ придёт токен — скопируй его сюда.',
    'Найди своего нового бота по имени и отправь ему любое сообщение, например «привет». Без этого бот не имеет права тебе писать.',
    'Вернись сюда и нажми «Определить чат» — приложение само подставит ID.',
    'Дневник будет приходить файлом в этот чат. Прошлые версии останутся в переписке.'
  ],

  /** Определяет chat_id по последнему сообщению боту — чтобы не заставлять
      человека искать свой числовой идентификатор через сторонних ботов. */
  async discoverChat(cfg) {
    const updates = await call(cfg, 'getUpdates', { limit: 20, timeout: 0 });
    for (let i = updates.length - 1; i >= 0; i--) {
      const m = updates[i].message || updates[i].channel_post;
      if (m?.chat?.id) {
        return { chatId: String(m.chat.id), title: m.chat.title || m.chat.first_name || m.chat.username || '' };
      }
    }
    throw new Error('Сообщений не видно. Напиши боту в Telegram что угодно и нажми ещё раз.');
  },

  async check(cfg) {
    if (!cfg.token) throw new Error('Нужен токен бота');
    const me = await call(cfg, 'getMe');
    if (!cfg.chatId) throw new Error('Не указан чат. Напиши боту сообщение и нажми «Определить чат».');
    await call(cfg, 'getChat', { chat_id: cfg.chatId });
    return { ok: true, info: '@' + me.username };
  },

  async load(cfg) {
    const chat = await call(cfg, 'getChat', { chat_id: cfg.chatId });
    const pinned = chat.pinned_message;
    const fileId = pinned?.document?.file_id;
    if (!fileId) return { doc: null, rev: null };

    const file = await call(cfg, 'getFile', { file_id: fileId });
    const r = await fetch(`https://api.telegram.org/file/bot${cfg.token.trim()}/${file.file_path}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('Не удалось скачать файл дневника из Telegram');
    const text = await r.text();
    return { doc: JSON.parse(text), rev: String(pinned.message_id) };
  },

  async save(cfg, doc, rev) {
    // Кто-то сохранил раньше нас — закреплено уже другое сообщение.
    if (rev) {
      const chat = await call(cfg, 'getChat', { chat_id: cfg.chatId });
      const current = chat.pinned_message?.message_id;
      if (current && String(current) !== String(rev)) throw new ConflictError();
    }

    const text = JSON.stringify(doc, null, 1);
    const form = new FormData();
    form.append('chat_id', cfg.chatId);
    form.append('disable_notification', 'true');
    form.append('caption', `Тренировок: ${doc.sessions.length} · ${new Date().toLocaleString('ru-RU')}`);
    form.append('document', new Blob([text], { type: 'application/json' }), 'tonnage.json');

    // content-type не ставим руками: браузер сам добавит границу multipart
    const r = await fetch(api(cfg, 'sendDocument'), { method: 'POST', body: form });
    const body = await r.json().catch(() => ({}));
    if (!body.ok) throw new Error(body.description || 'Не удалось отправить дневник в Telegram');

    const messageId = body.result.message_id;
    await call(cfg, 'pinChatMessage', {
      chat_id: cfg.chatId, message_id: messageId, disable_notification: true
    });
    return { rev: String(messageId) };
  }
};
