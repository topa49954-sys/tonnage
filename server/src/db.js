/* =====================================================================
   ТОННАЖ — база данных (SQLite через встроенный node:sqlite)
   ---------------------------------------------------------------------
   Никаких внешних зависимостей: ни драйвера, ни ORM, ни облачного
   сервиса, который однажды поставит проект на паузу. Один файл на диске,
   который можно скопировать в бэкап обычным cp.

   Две метки времени у каждой записи — это важно:
     updated_at  — время КЛИЕНТА. По нему решается конфликт (LWW):
                   побеждает более поздняя правка.
     srv         — время СЕРВЕРА. По нему клиент забирает изменения
                   («дай всё, что новее курсора»). Отдельная метка нужна
                   потому, что часы на телефоне могут врать, и если
                   считать курсор по ним, записи начнут теряться.
   ===================================================================== */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL DEFAULT 1,
      date        TEXT    NOT NULL,
      day_key     TEXT,
      block       INTEGER,
      week        INTEGER,
      feedback    TEXT,
      entries     TEXT    NOT NULL,
      targets     TEXT,
      started_at  INTEGER,
      finished_at INTEGER,
      updated_at  INTEGER NOT NULL,
      srv         INTEGER NOT NULL,
      deleted     INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_srv ON sessions(user_id, srv);

    CREATE TABLE IF NOT EXISTS body (
      user_id    INTEGER NOT NULL DEFAULT 1,
      date       TEXT    NOT NULL,
      kg         REAL    NOT NULL,
      updated_at INTEGER NOT NULL,
      srv        INTEGER NOT NULL,
      PRIMARY KEY (user_id, date)
    );
    CREATE INDEX IF NOT EXISTS idx_body_srv ON body(user_id, srv);

    CREATE TABLE IF NOT EXISTS settings (
      user_id    INTEGER PRIMARY KEY,
      json       TEXT    NOT NULL,
      updated_at INTEGER NOT NULL,
      srv        INTEGER NOT NULL
    );
  `);

  migrate(db);
  return wrap(db);
}

/* Добавление колонок к уже существующей базе. CREATE TABLE IF NOT EXISTS
   ничего не меняет в созданной таблице, поэтому новые поля доезжают сюда. */
function migrate(db) {
  const columns = table => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
  const add = (table, column, decl) => {
    if (!columns(table).has(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
      console.log(`[тоннаж] миграция: ${table}.${column}`);
    }
  };
  add('sessions', 'targets', 'TEXT');
}

function wrap(db) {
  const q = {
    getSession:  db.prepare('SELECT updated_at FROM sessions WHERE id = ? AND user_id = ?'),
    putSession:  db.prepare(`
      INSERT INTO sessions (id,user_id,date,day_key,block,week,feedback,entries,targets,started_at,finished_at,updated_at,srv,deleted)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        date=excluded.date, day_key=excluded.day_key, block=excluded.block, week=excluded.week,
        feedback=excluded.feedback, entries=excluded.entries, targets=excluded.targets,
        started_at=excluded.started_at, finished_at=excluded.finished_at,
        updated_at=excluded.updated_at, srv=excluded.srv, deleted=excluded.deleted
    `),
    sessionsSince: db.prepare('SELECT * FROM sessions WHERE user_id = ? AND srv > ? ORDER BY srv'),

    getBody: db.prepare('SELECT updated_at FROM body WHERE user_id = ? AND date = ?'),
    putBody: db.prepare(`
      INSERT INTO body (user_id,date,kg,updated_at,srv) VALUES (?,?,?,?,?)
      ON CONFLICT(user_id,date) DO UPDATE SET kg=excluded.kg, updated_at=excluded.updated_at, srv=excluded.srv
    `),
    bodySince: db.prepare('SELECT date,kg,updated_at FROM body WHERE user_id = ? AND srv > ? ORDER BY srv'),

    getSettings: db.prepare('SELECT json, updated_at FROM settings WHERE user_id = ?'),
    putSettings: db.prepare(`
      INSERT INTO settings (user_id,json,updated_at,srv) VALUES (?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at, srv=excluded.srv
    `),
    settingsSince: db.prepare('SELECT json, updated_at FROM settings WHERE user_id = ? AND srv > ?'),

    stats: db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND deleted = 0')
  };

  return {
    raw: db,

    /** Применяет присланные клиентом записи. Возвращает, сколько принято. */
    applyChanges(userId, payload, srv) {
      let applied = 0;
      const tx = db.prepare('BEGIN'); const commit = db.prepare('COMMIT'); const rollback = db.prepare('ROLLBACK');
      tx.run();
      try {
        for (const s of payload.sessions || []) {
          if (!s || typeof s.id !== 'string') continue;
          const cur = q.getSession.get(s.id, userId);
          const incoming = Number(s.updated_at) || 0;
          if (cur && Number(cur.updated_at) >= incoming) continue;   // наша версия свежее
          q.putSession.run(
            s.id, userId, String(s.date || ''), s.dayKey ?? null,
            Number(s.block) || null, Number(s.week) || null, s.feedback ?? null,
            JSON.stringify(s.entries || {}), JSON.stringify(s.targets || {}),
            Number(s.startedAt) || null, Number(s.finishedAt) || null,
            incoming, srv, s.deleted ? 1 : 0
          );
          applied++;
        }
        for (const b of payload.body || []) {
          if (!b || typeof b.date !== 'string') continue;
          const cur = q.getBody.get(userId, b.date);
          const incoming = Number(b.updated_at) || 0;
          if (cur && Number(cur.updated_at) >= incoming) continue;
          q.putBody.run(userId, b.date, Number(b.kg) || 0, incoming, srv);
          applied++;
        }
        if (payload.settings) {
          const cur = q.getSettings.get(userId);
          const incoming = Number(payload.settings.updated_at) || 0;
          if (!cur || Number(cur.updated_at) < incoming) {
            q.putSettings.run(userId, JSON.stringify(payload.settings), incoming, srv);
            applied++;
          }
        }
        commit.run();
      } catch (e) {
        rollback.run();
        throw e;
      }
      return applied;
    },

    /** Всё, что изменилось на сервере после курсора. */
    changesSince(userId, since) {
      const sessions = q.sessionsSince.all(userId, since).map(r => ({
        id: r.id, date: r.date, dayKey: r.day_key, block: r.block, week: r.week,
        feedback: r.feedback, entries: safeParse(r.entries, {}), targets: safeParse(r.targets, {}),
        startedAt: r.started_at, finishedAt: r.finished_at,
        updated_at: r.updated_at, deleted: r.deleted
      }));
      const body = q.bodySince.all(userId, since);
      const st = q.settingsSince.get(userId, since);
      return {
        sessions, body,
        settings: st ? { ...safeParse(st.json, {}), updated_at: st.updated_at } : null
      };
    },

    count(userId) { return q.stats.get(userId)?.n ?? 0; }
  };
}

const safeParse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
