/* =====================================================================
   ТОННАЖ — состояние и синхронизация
   ---------------------------------------------------------------------
   Офлайн-первый. Приложение ВСЕГДА пишет в локальную копию и только потом,
   когда получится, отправляет в хранилище. В зале часто нет связи, и
   подход, записанный в подвале, не должен пропасть.

   Хранилище сменное (см. adapters/): GitHub, Telegram, свой сервер или
   только браузер. Для store.js разницы нет — он умеет ровно две операции,
   «прочитать документ» и «записать документ».

   Локальная копия — это кэш и очередь отправки, а не источник истины.
   Поэтому чистка данных Safari не приводит к потере дневника: при
   следующем входе всё приедет обратно из хранилища.
   ===================================================================== */

import { adapterById, DEFAULT_ADAPTER } from './adapters/index.js';
import { emptyDoc, normalizeDoc, mergeDocs, ConflictError } from './doc.js';

const LS = 'tonnage.';
const read = (k, d) => { try { const v = localStorage.getItem(LS + k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch {} };
const drop = k => { try { localStorage.removeItem(LS + k); } catch {} };

export const now = () => Date.now();
export const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const DEFAULT_SETTINGS = {
  sound: true,
  bar: 20,
  theme: 'auto',
  profile: { sex: 'm', age: 22, height: 180, weight: 72, act: 1.375, pace: 'steady' }
};

class Store {
  constructor() {
    const conn = read('conn', null);
    this.conn = conn && adapterById(conn.adapterId) ? conn : null;   // {adapterId, cfg, rev}

    this.state = {
      settings: { ...DEFAULT_SETTINGS, ...read('settings', {}) },
      sessions: read('sessions', []),
      body: read('body', {}),
      current: read('current', null)
    };
    this.state.settings.profile = { ...DEFAULT_SETTINGS.profile, ...(this.state.settings.profile || {}) };

    this.dirty = read('dirty', false);
    this.status = {
      online: navigator.onLine,
      syncing: false,
      lastSync: read('lastSync', 0),
      error: null
    };
    this.listeners = new Set();
    this._timer = null;

    addEventListener('online', () => { this.status.online = true; this.emit(); this.sync(); });
    addEventListener('offline', () => { this.status.online = false; this.emit(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.sync(); });
  }

  /* ------------------------------ подключение ------------------------------ */

  get connected() { return !!this.conn; }
  get adapter() { return this.conn ? adapterById(this.conn.adapterId) : null; }
  get adapterId() { return this.conn?.adapterId || null; }

  async connect(adapterId, cfg) {
    const a = adapterById(adapterId);
    if (!a) throw new Error('Неизвестное хранилище');

    const res = await a.check({ ...cfg });
    const finalCfg = res?.cfg || cfg;

    this.conn = { adapterId, cfg: finalCfg, rev: null };
    write('conn', this.conn);
    this.status.error = null;

    // Первым делом читаем то, что уже лежит в хранилище, и сливаем с локальным.
    await this.sync(true);
    return res;
  }

  disconnect() {
    this.conn = null;
    drop('conn');
    this.status.lastSync = 0;
    drop('lastSync');
    this.emit();
  }

  /* ------------------------------ события ------------------------------ */

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) { try { fn(this.state, this.status); } catch {} } }

  /* ------------------------------ документ ------------------------------ */

  toDoc() {
    return {
      version: 2,
      sessions: this.state.sessions,
      body: this.state.body,
      settings: this.state.settings
    };
  }

  applyDoc(doc) {
    const d = normalizeDoc(doc);
    this.state.sessions = d.sessions;
    this.state.body = d.body;
    if (d.settings) {
      this.state.settings = { ...DEFAULT_SETTINGS, ...d.settings };
      this.state.settings.profile = { ...DEFAULT_SETTINGS.profile, ...(d.settings.profile || {}) };
    }
    write('sessions', this.state.sessions);
    write('body', this.state.body);
    write('settings', this.state.settings);
  }

  /* ------------------------------ запись ------------------------------ */

  _touched(delay = 1500) {
    this.dirty = true;
    write('dirty', true);
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.sync(), delay);
    this.emit();
  }

  saveSettings() {
    this.state.settings.updated_at = now();
    write('settings', this.state.settings);
    this._touched();
  }

  /** Черновик текущей тренировки. В хранилище не уходит: он меняется
      на каждое нажатие, а ценность имеет только завершённая тренировка. */
  saveCurrent() {
    write('current', this.state.current);
    this.emit();
  }

  commitSession(session) {
    session.updated_at = now();
    const i = this.state.sessions.findIndex(s => s.id === session.id);
    if (i >= 0) this.state.sessions[i] = session; else this.state.sessions.push(session);
    this.state.sessions.sort((a, b) => (a.id < b.id ? -1 : 1));
    write('sessions', this.state.sessions);
    this._touched(300);
  }

  deleteSession(id) {
    const s = this.state.sessions.find(x => x.id === id);
    if (!s) return;
    // Метка удаления, а не вычёркивание: иначе при слиянии с другим
    // устройством удалённая тренировка вернулась бы обратно.
    s.deleted = 1;
    s.updated_at = now();
    this.state.sessions = this.state.sessions.filter(x => x.id !== id);
    const tombs = read('tombs', []).filter(t => t.id !== id);
    tombs.push(s);
    write('tombs', tombs.slice(-200));
    write('sessions', this.state.sessions);
    this._touched(300);
  }

  setBodyWeight(dateKey, kg) {
    this.state.body[dateKey] = { kg, updated_at: now() };
    write('body', this.state.body);
    this._touched(300);
  }

  hasPending() { return this.dirty; }

  /* ------------------------------ синхронизация ------------------------------ */

  async sync(force = false) {
    if (!this.conn) return;
    const a = this.adapter;
    if (!a) return;

    if (a.needsNetwork && !navigator.onLine) {
      this.status.online = false;
      this.emit();
      return;
    }
    if (this.status.syncing) return;
    if (!force && !this.dirty && now() - this.status.lastSync < 60000) return;

    this.status.syncing = true;
    this.status.error = null;
    this.emit();

    try {
      const remote = await a.load(this.conn.cfg);
      let doc = this._localDoc();

      if (remote.doc) {
        doc = mergeDocs(remote.doc, doc);
        this.applyDoc(doc);
      }
      this.conn.rev = remote.rev;

      // Записываем, если локально были изменения или хранилище ещё пустое
      if (this.dirty || !remote.doc) {
        const out = this._localDoc();
        try {
          const res = await a.save(this.conn.cfg, out, this.conn.rev);
          this.conn.rev = res?.rev ?? null;
        } catch (e) {
          if (e instanceof ConflictError || e.code === 'conflict') {
            // Кто-то записал между нашим чтением и записью. Читаем заново,
            // сливаем и повторяем ровно один раз — бесконечный цикл здесь
            // опаснее одной потерянной попытки.
            const again = await a.load(this.conn.cfg);
            const merged = mergeDocs(again.doc || emptyDoc(), this._localDoc());
            this.applyDoc(merged);
            const res = await a.save(this.conn.cfg, this._localDoc(), again.rev);
            this.conn.rev = res?.rev ?? null;
          } else throw e;
        }
        this.dirty = false;
        write('dirty', false);
        write('tombs', []);
      }

      write('conn', this.conn);
      this.status.lastSync = now();
      write('lastSync', this.status.lastSync);
    } catch (e) {
      this.status.error = e.message || 'Не удалось синхронизировать';
      // Ничего не теряем: dirty остаётся, попробуем снова позже
      if (this.dirty) {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.sync(), 20000);
      }
    } finally {
      this.status.syncing = false;
      this.emit();
    }
  }

  /** Локальный документ вместе с метками удаления, ещё не доехавшими до хранилища. */
  _localDoc() {
    const doc = this.toDoc();
    const tombs = read('tombs', []);
    return tombs.length ? { ...doc, sessions: [...doc.sessions, ...tombs] } : doc;
  }

  /* ------------------------------ копия файлом ------------------------------ */

  exportJSON() {
    return JSON.stringify({
      ...this.toDoc(),
      exported_at: new Date().toISOString()
    }, null, 2);
  }

  importJSON(text) {
    const incoming = normalizeDoc(JSON.parse(text));
    if (!Array.isArray(incoming.sessions)) throw new Error('Файл не похож на копию дневника');
    const merged = mergeDocs(this.toDoc(), incoming);
    this.applyDoc(merged);
    this._touched(300);
    return incoming.sessions.length;
  }

  wipeLocal() {
    ['sessions', 'body', 'current', 'dirty', 'lastSync', 'tombs'].forEach(drop);
    this.state.sessions = [];
    this.state.body = {};
    this.state.current = null;
    this.dirty = false;
    this.emit();
  }
}

export const store = new Store();
