/* =====================================================================
   Реестр хранилищ
   ---------------------------------------------------------------------
   Все адаптеры выглядят одинаково, поэтому смена хранилища — это выбор
   в настройках, а не переписывание приложения:

     check(cfg)            проверить доступ; может вернуть изменённый cfg
     load(cfg)             -> {doc, rev}   (doc = null, если ещё пусто)
     save(cfg, doc, rev)   -> {rev}        (бросает ConflictError, если
                                            кто-то записал раньше нас)

   Порядок в списке — это и порядок на экране выбора.
   ===================================================================== */

import github from './github.js';
import telegram from './telegram.js';
import server from './server.js';
import local from './local.js';

export const ADAPTERS = [github, telegram, server, local];
export const adapterById = id => ADAPTERS.find(a => a.id === id) || null;
export const DEFAULT_ADAPTER = 'github';
