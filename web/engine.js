/* =====================================================================
   ТОННАЖ — движок программы («тренер»)
   ---------------------------------------------------------------------
   Отвечает на три вопроса:
     1. Что я делаю сегодня?           -> planToday()
     2. С каким весом и почему?        -> движок считает и объясняет
     3. Какой путь пройден и что дальше -> journey()

   ПРИНЦИПЫ, зашитые в логику:

   • Программа двигается по ОТМЕЧЕННЫМ тренировкам, а не по календарю.
     Пропустил неделю — блок просто продолжится с того же места.

   • Мезоцикл = 4 недели по 3 тренировки = 12 тренировок:
       неделя 1  накопление   базовый объём, в запасе 3 повтора
       неделя 2  рост объёма  +1 подход на базовых движениях
       неделя 3  пик          тяжелее, диапазон повторов смещается вниз
       неделя 4  разгрузка    60% веса, половина подходов

   • База (tier: anchor) держится ДВА блока подряд. Новичку нужна
     повторяемость: рост весов в приседе берётся из того, что ты
     приседаешь каждую неделю, а не пробуешь новое упражнение.
     Разнообразие даёт ротация подсобки и смена схем подходов.

   • Сложные движения (level 3) открываются со второго блока, когда
     базовая техника уже поставлена.
   ===================================================================== */

import { EX, PATTERNS, byPattern } from './exercises.js';

export const WORKOUTS_PER_WEEK = 3;
export const WEEKS_PER_BLOCK = 4;
export const WORKOUTS_PER_BLOCK = WORKOUTS_PER_WEEK * WEEKS_PER_BLOCK;

/* ------------------------- недели внутри блока ------------------------- */

export const WEEKS = [
  {
    n: 1, name: 'Накопление',
    intent: 'Входим в блок. Вес умеренный, техника чистая, в запасе остаётся 3 повтора.',
    setMod: 0, repShift: 0, load: 1, rpe: 'в запасе 3 повтора'
  },
  {
    n: 2, name: 'Рост объёма',
    intent: 'Добавляем по подходу на базовые движения. Объём растёт, вес тот же.',
    setMod: 1, mainOnly: true, repShift: 0, load: 1, rpe: 'в запасе 2–3 повтора'
  },
  {
    n: 3, name: 'Пик',
    intent: 'Самая тяжёлая неделя блока. Повторов меньше, вес выше, работаем близко к пределу.',
    setMod: 1, repShift: -1, load: 1, rpe: 'в запасе 1–2 повтора'
  },
  {
    n: 4, name: 'Разгрузка',
    intent: 'Лёгкая неделя. 60% веса, половина подходов. Связки и нервная система восстанавливаются — после неё веса пойдут вверх.',
    setMod: -1, repShift: 0, load: 0.6, rpe: 'легко, только техника'
  }
];

/* ------------------------- акцент блока ------------------------- */

const BLOCK_FOCUS = [
  {
    name: 'Силовая база',
    note: 'Меньше повторов, больше веса. Задача блока — поднять рабочие веса в базовых движениях.',
    mainRep: [6, 8], auxRep: [10, 12]
  },
  {
    name: 'Гипертрофия',
    note: 'Больше повторов и объёма при чуть меньшем весе. Задача блока — набрать мышечную массу на выросшей силе.',
    mainRep: [8, 10], auxRep: [12, 15]
  }
];

/* ------------------------- шаблоны дней -------------------------
   Слот описывает НУЖНОЕ ДВИЖЕНИЕ, а не упражнение. Конкретное
   подбирает ротация. У слота два независимых параметра:

     tier  — ИЗ ЧЕГО выбирать упражнение
             'anchor' только базовые, смена раз в два блока
             'rotate' только варианты, смена каждый блок
             'any'    весь паттерн, смена каждый блок
     role  — КАКАЯ СХЕМА подходов
             'main'   тяжело: мало повторов, длинный отдых
             'aux'    подсобка: больше повторов, короткий отдых

   Разделены они потому, что это разные вопросы. День C — объёмный:
   там тот же паттерн берётся другим упражнением, но работать надо
   легче, а не тяжелее.

   Недельный охват: присед 2, шарнир 2, горизонтальный жим 2,
   горизонтальная тяга 2, вертикальные жим и тяга по 1. Тяг столько
   же, сколько жимов — иначе программа тянет плечи вперёд.
------------------------------------------------------------------- */

const DAYS = [
  {
    key: 'A', title: 'Присед и жим', sub: 'Тяжёлый день: база на ноги, грудь и спину',
    slots: [
      { pattern: 'squat',    tier: 'anchor', role: 'main', rest: 180 },
      { pattern: 'hpush',    tier: 'anchor', role: 'main', rest: 150 },
      { pattern: 'hpull',    tier: 'anchor', role: 'main', rest: 120 },
      { pattern: 'vpush',    tier: 'any',    role: 'aux',  rest: 90  },
      { pattern: 'triceps',  tier: 'any',    role: 'aux',  rest: 60  },
      { pattern: 'reardelt', tier: 'any',    role: 'aux',  rest: 60  }
    ]
  },
  {
    key: 'B', title: 'Тяга', sub: 'Задняя цепь, спина и руки',
    slots: [
      { pattern: 'hinge',  tier: 'anchor', role: 'main', rest: 180 },
      { pattern: 'vpull',  tier: 'anchor', role: 'main', rest: 120 },
      { pattern: 'quad',   tier: 'any',    role: 'aux',  rest: 90  },
      { pattern: 'ham',    tier: 'any',    role: 'aux',  rest: 90  },
      { pattern: 'biceps', tier: 'any',    role: 'aux',  rest: 60  },
      { pattern: 'calf',   tier: 'any',    role: 'aux',  rest: 60  }
    ]
  },
  {
    key: 'C', title: 'Объём', sub: 'Те же движения другими вариантами, легче и многоповторнее',
    slots: [
      { pattern: 'squat',   tier: 'rotate', role: 'main', rest: 150 },
      { pattern: 'hinge',   tier: 'rotate', role: 'aux',  rest: 90  },
      { pattern: 'hpush',   tier: 'rotate', role: 'aux',  rest: 90  },
      { pattern: 'hpull',   tier: 'rotate', role: 'aux',  rest: 90  },
      { pattern: 'latdelt', tier: 'any',    role: 'aux',  rest: 60  },
      { pattern: 'core',    tier: 'any',    role: 'aux',  rest: 60  }
    ]
  }
];

/* =====================================================================
   ПОЗИЦИЯ В ПРОГРАММЕ
   ===================================================================== */

export function position(doneCount) {
  const block = Math.floor(doneCount / WORKOUTS_PER_BLOCK) + 1;
  const inBlock = doneCount % WORKOUTS_PER_BLOCK;
  const week = Math.floor(inBlock / WORKOUTS_PER_WEEK) + 1;
  const dayIndex = inBlock % WORKOUTS_PER_WEEK;
  return {
    block, week, dayIndex,
    inBlock,                       // сколько тренировок блока уже закрыто
    weekSpec: WEEKS[week - 1],
    focus: BLOCK_FOCUS[(block - 1) % BLOCK_FOCUS.length],
    day: DAYS[dayIndex]
  };
}

/* =====================================================================
   ПОДБОР УПРАЖНЕНИЯ В СЛОТ
   ===================================================================== */

function maxLevelFor(block) {
  // Блок 1 — только то, что можно делать с первого дня без риска.
  return block === 1 ? 2 : 3;
}

export function pickExercise(slot, block) {
  const maxLevel = maxLevelFor(block);
  const all = byPattern(slot.pattern).filter(id => EX[id].level <= maxLevel);

  let pool = slot.tier === 'any' ? all : all.filter(id => EX[id].tier === slot.tier);
  if (!pool.length) pool = all;
  if (!pool.length) pool = byPattern(slot.pattern);

  const idx = slot.tier === 'anchor'
    ? Math.floor((block - 1) / 2)   // базовое движение живёт два блока подряд
    : block - 1;                     // остальное меняется каждый блок
  return pool[idx % pool.length];
}

/* =====================================================================
   ИСТОРИЯ: что было в прошлый раз
   ===================================================================== */

export function lastPerformance(sessions, exId) {
  for (let i = sessions.length - 1; i >= 0; i--) {
    const sets = (sessions[i].entries || {})[exId];
    if (sets && sets.length) {
      return { session: sessions[i], sets, date: sessions[i].date, feedback: sessions[i].feedback };
    }
  }
  return null;
}

const isDeloadWeek = week => (WEEKS[(week || 1) - 1] || WEEKS[0]).load < 1;

/* Рабочий вес НИКОГДА не берётся с разгрузочной недели.
   Иначе 60% превращаются в новую точку отсчёта, и веса ползут вниз
   с каждым блоком вместо того, чтобы расти. */
function history(sessions, exId, limit = 2) {
  const out = [];
  for (let i = sessions.length - 1; i >= 0 && out.length < limit; i--) {
    const s = sessions[i];
    if (isDeloadWeek(s.week)) continue;
    const sets = (s.entries || {})[exId];
    if (sets && sets.length) {
      out.push({ sets, feedback: s.feedback, targets: (s.targets || {})[exId] || null });
    }
  }
  if (!out.length) {
    // Кроме разгрузок ничего нет — значит это самое начало, берём что есть
    for (let i = sessions.length - 1; i >= 0 && out.length < limit; i--) {
      const sets = (sessions[i].entries || {})[exId];
      if (sets && sets.length) {
        out.push({ sets, feedback: sessions[i].feedback, targets: (sessions[i].targets || {})[exId] || null, wasDeload: true });
      }
    }
  }
  return out;
}

export const e1rm = (w, r) => (r > 0 && w > 0 ? w * (1 + r / 30) : 0);

/* =====================================================================
   РЕШЕНИЕ ПО ВЕСУ — здесь движок работает тренером
   ===================================================================== */

const round = (v, step) => Math.max(0, Math.round(v / step) * step);

export function prescribe(exId, sessions, weekSpec, repRange) {
  const ex = EX[exId];
  const hist = history(sessions, exId);
  const [lo, hi] = repRange;

  if (ex.unit === 'time' || ex.unit === 'bw') {
    const prev = hist[0];
    const bestPrev = prev ? Math.max(...prev.sets.map(s => +s.r || 0)) : 0;
    return {
      weight: null,
      target: bestPrev ? Math.max(lo, Math.min(hi, bestPrev + 1)) : lo,
      isNew: !prev,
      why: prev
        ? `В прошлый раз максимум ${bestPrev}. Сегодня цель — добавить хотя бы один.`
        : 'Первый раз: работай в лёгком темпе, запиши, сколько получилось — дальше движок будет вести от этой цифры.'
    };
  }

  if (!hist.length) {
    return {
      weight: null, target: lo, isNew: true,
      why: 'Первый раз в этом упражнении. Подбери вес так, чтобы после нижней границы повторов в запасе оставалось 2–3. Запиши, что получилось — дальше движок ведёт сам.'
    };
  }

  const prev = hist[0];
  const before = hist[1];
  const working = Math.max(...prev.sets.map(s => +s.w || 0));
  const step = ex.step || 2.5;
  const assist = ex.unit === 'assist';        // гравитрон: меньше противовес = прогресс
  const dir = assist ? -1 : 1;                // в какую сторону «прибавить»

  // Сравниваем прошлый результат с диапазоном, который был задан ТОГДА,
  // а не с сегодняшним: между блоками диапазон меняется, и 7 повторов
  // в схеме 5–7 — это выполненная норма, а не недобор до 8.
  const prevHi = prev.targets?.repHi ?? hi;
  const prevLo = prev.targets?.repLo ?? lo;

  const allAtTop = prev.sets.length > 0 && prev.sets.every(s => (+s.r || 0) >= prevHi);
  const missedBottom = prev.sets.some(s => (+s.r || 0) < prevLo);
  const missedTwice = missedBottom && before &&
    before.sets.some(s => (+s.r || 0) < (before.targets?.repLo ?? prevLo));
  const fb = prev.feedback;

  let weight = working;
  let why;

  if (missedTwice) {
    weight = round(working * 0.9, step);
    why = `Две тренировки подряд не добираешь до нижней границы — откатываю на 10%, до ${weight} кг. Пройдём этот участок заново: так быстрее, чем упираться в стенку.`;
  } else if (fb === 'fail') {
    why = `В прошлый раз подход сорвался — вес держим на ${working} кг, пока не закроешь все подходы чисто.`;
  } else if (allAtTop && fb === 'easy') {
    weight = round(working + dir * step * 2, step);
    why = `Все подходы по ${prevHi} повторов и отметка «легко» — ${assist ? 'снимаю' : 'прибавляю'} сразу ${step * 2} кг, до ${weight} кг.`;
  } else if (allAtTop && fb === 'hard') {
    why = `Верхнюю границу взял, но тяжело — ещё одна тренировка на ${working} кг, чтобы закрепить, и потом прибавим.`;
  } else if (allAtTop) {
    weight = round(working + dir * step, step);
    why = assist
      ? `Все подходы закрыты — убираю ${step} кг противовеса, до ${weight} кг. Меньше противовес — больше своего веса поднимаешь сам.`
      : `Все подходы вышли на ${prevHi} повторов — прибавляю ${step} кг, до ${weight} кг. Повторы упадут обратно к нижней границе, так и должно быть.`;
  } else {
    const worst = Math.min(...prev.sets.map(s => +s.r || 0));
    why = `Держим ${working} кг. В прошлый раз худший подход — ${worst} повторов. Сегодня цель добавить по повтору, а не вес.`;
  }

  // Диапазон повторов сменился между блоками: с весом на 6 повторов
  // десять не сделать, и наоборот. Примерно 3% веса на повтор.
  if (prevHi !== hi && !assist) {
    const before2 = weight;
    weight = round(weight * (1 - (hi - prevHi) * 0.03), step);
    if (weight !== before2) {
      why += hi > prevHi
        ? ` Диапазон вырос до ${lo}–${hi} повторов, поэтому вес снижен до ${weight} кг — иначе столько повторов не сделать.`
        : ` Диапазон опустился до ${lo}–${hi}, поэтому вес поднят до ${weight} кг.`;
    }
  }

  // Разгрузка применяется последней — поверх уже посчитанного рабочего веса
  if (weekSpec.load < 1) {
    const full = weight;
    weight = round(weight * weekSpec.load, step);
    why = `Разгрузочная неделя: ${Math.round(weekSpec.load * 100)}% от рабочих ${full} кг, то есть ${weight} кг. Должно быть откровенно легко — в этом весь смысл недели. Рабочий вес вернётся со следующей.`;
  }

  return { weight: Math.max(0, weight), target: lo, isNew: false, why, prevSets: prev.sets, working };
}

/* =====================================================================
   ПЛАН ТРЕНИРОВКИ
   ===================================================================== */

export function planWorkout(sessions, doneCount) {
  const pos = position(doneCount);
  const { day, weekSpec, focus, block } = pos;

  const exercises = day.slots.map(slot => {
    const id = pickExercise(slot, block);
    const ex = EX[id];
    const isMain = slot.role === 'main';

    let [lo, hi] = isMain ? focus.mainRep : focus.auxRep;
    if (ex.unit === 'time') { lo = 30; hi = 60; }
    lo = Math.max(3, lo + weekSpec.repShift);
    hi = Math.max(lo + 1, hi + weekSpec.repShift);

    let sets = isMain ? 3 : 3;
    if (weekSpec.setMod > 0 && (!weekSpec.mainOnly || isMain)) sets += weekSpec.setMod;
    if (weekSpec.setMod < 0) sets = Math.max(2, sets + weekSpec.setMod);

    const rx = prescribe(id, sessions, weekSpec, [lo, hi]);

    return {
      id, pattern: slot.pattern, role: slot.role,
      patternName: PATTERNS[slot.pattern].n,
      sets, repLo: lo, repHi: hi,
      rest: weekSpec.load < 1 ? Math.round(slot.rest * 0.75) : slot.rest,
      ...rx
    };
  });

  return {
    ...pos,
    dayKey: day.key,
    title: day.title,
    sub: day.sub,
    exercises,
    totalSets: exercises.reduce((a, e) => a + e.sets, 0),
    estMinutes: Math.round((480 + exercises.reduce((a, e) => a + e.sets * (e.rest + 45), 0)) / 60 / 5) * 5
  };
}

/* =====================================================================
   ПУТЬ: сколько пройдено и что меняется дальше
   ===================================================================== */

export function journey(sessions) {
  const done = sessions.length;
  const pos = position(done);
  const nextWeek = WEEKS[pos.week % WEEKS.length];
  const blockStartIdx = Math.floor(done / WORKOUTS_PER_BLOCK) * WORKOUTS_PER_BLOCK;

  // Сила: сумма расчётных максимумов по базовым паттернам
  const strengthAt = upto => {
    const slice = sessions.slice(0, upto);
    let sum = 0;
    for (const p of ['squat', 'hinge', 'hpush', 'hpull']) {
      let best = 0;
      for (const s of slice) {
        for (const [id, sets] of Object.entries(s.entries || {})) {
          if (!EX[id] || EX[id].pattern !== p || EX[id].unit !== 'kg') continue;
          for (const st of sets) best = Math.max(best, e1rm(+st.w || 0, +st.r || 0));
        }
      }
      sum += best;
    }
    return Math.round(sum);
  };

  const now = strengthAt(sessions.length);
  const atBlockStart = strengthAt(blockStartIdx);
  const atStart = strengthAt(Math.min(3, sessions.length));

  const tonnage = s => Object.values(s.entries || {})
    .flat().reduce((a, x) => a + (+x.w || 0) * (+x.r || 0), 0);

  return {
    ...pos,
    done,
    inBlock: pos.inBlock,
    blockTotal: WORKOUTS_PER_BLOCK,
    blockPct: Math.round((pos.inBlock / WORKOUTS_PER_BLOCK) * 100),
    nextWeek,
    strength: now,
    strengthBlockDelta: now - atBlockStart,
    strengthTotalDelta: now - atStart,
    totalTonnage: sessions.reduce((a, s) => a + tonnage(s), 0),
    milestones: milestones(sessions)
  };
}

function milestones(sessions) {
  const out = [];
  const done = sessions.length;
  const add = (ok, icon, title, note) => out.push({ ok, icon, title, note });

  add(done >= 1, '1', 'Первая тренировка', 'Самый трудный шаг сделан');
  add(done >= 6, '6', 'Две недели подряд', 'Привычка начинает формироваться');
  add(done >= 12, '12', 'Первый блок закрыт', 'Полный мезоцикл с разгрузкой');
  add(done >= 24, '24', 'Два блока', 'База сменилась, техника поставлена');
  add(done >= 48, '48', 'Четыре блока', 'Из новичка — в средний уровень');

  let bestSquat = 0, bestBench = 0;
  for (const s of sessions) {
    for (const st of (s.entries || {}).squat || []) bestSquat = Math.max(bestSquat, +st.w || 0);
    for (const st of (s.entries || {}).bench || []) bestBench = Math.max(bestBench, +st.w || 0);
  }
  if (bestSquat) add(bestSquat >= 60, '60', 'Присед 60 кг', `Сейчас ${bestSquat} кг`);
  if (bestBench) add(bestBench >= 60, '60', 'Жим 60 кг', `Сейчас ${bestBench} кг`);
  return out;
}

/* =====================================================================
   ПЕРЕРЫВ В ТРЕНИРОВКАХ
   ===================================================================== */

export function layoffAdvice(sessions) {
  if (!sessions.length) return null;
  const last = new Date(sessions[sessions.length - 1].date);
  const days = Math.floor((Date.now() - last.getTime()) / 86400000);
  if (days < 10) return null;
  if (days < 21) {
    return {
      days,
      text: `Перерыв ${days} дней. Первую тренировку сделай на 10% легче обычного — мышцы помнят, а связки нет.`
    };
  }
  return {
    days,
    text: `Перерыв ${days} дней. Начни с 80% от прошлых весов и подними их обратно за 2–3 тренировки. Это займёт меньше времени, чем восстановление после потянутой спины.`
  };
}

export { DAYS };
