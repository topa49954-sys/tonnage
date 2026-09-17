/* =====================================================================
   Симуляция программы: прогоняет движок вперёд на N тренировок и
   печатает, что он выдаёт. Нужна, чтобы проверять изменения в логике
   не в зале через полгода, а за две секунды здесь.

   Запуск:  npm run sim          (36 тренировок = 3 блока)
            npm run sim -- 60
   ===================================================================== */

import { planWorkout, journey } from '../../web/engine.js';
import { EX } from '../../web/exercises.js';

const N = Number(process.argv[2]) || 36;
const sessions = [];
const seen = new Set();

// Условный спортсмен: в 70% случаев закрывает верхнюю границу повторов
const rollReps = (lo, hi) => (Math.random() < 0.7 ? hi : lo);

console.log(`\nСимуляция ${N} тренировок\n${'─'.repeat(78)}`);

for (let i = 0; i < N; i++) {
  const plan = planWorkout(sessions, sessions.length);
  const entries = {}, targets = {};

  for (const e of plan.exercises) {
    seen.add(e.id);
    const w = e.weight != null ? e.weight : EX[e.id].unit === 'kg' ? 20 : 0;
    const r = rollReps(e.repLo, e.repHi);
    entries[e.id] = Array.from({ length: e.sets }, () => ({ w, r }));
    targets[e.id] = { sets: e.sets, repLo: e.repLo, repHi: e.repHi, weight: e.weight };
  }

  sessions.push({
    id: 's' + String(i).padStart(3, '0'),
    date: new Date(2026, 0, 1 + i * 2).toISOString().slice(0, 10),
    dayKey: plan.dayKey, block: plan.block, week: plan.week,
    feedback: ['ok', 'ok', 'easy', 'hard'][i % 4],
    entries, targets
  });

  if (i % 3 === 0) {
    const sq = plan.exercises.find(e => e.pattern === 'squat');
    console.log(
      `#${String(i + 1).padStart(2)}  блок ${plan.block} нед ${plan.week} ${plan.dayKey}  ` +
      `${plan.weekSpec.name.padEnd(13)} ${String(plan.totalSets).padStart(2)} подх   ` +
      `${EX[sq.id].n.padEnd(27)} ${sq.sets}×${sq.repLo}-${sq.repHi}  ` +
      `${sq.weight != null ? sq.weight + ' кг' : 'подбор'}`
    );
  }
}

const j = journey(sessions);
console.log('─'.repeat(78));
console.log(`Итог: блок ${j.block}, неделя ${j.week}`);
console.log(`Сумма базовых: ${j.strength} кг (прирост ${j.strengthTotalDelta > 0 ? '+' : ''}${j.strengthTotalDelta} кг)`);
console.log(`Тоннаж за всё: ${Math.round(j.totalTonnage / 1000)} т`);
console.log(`Вехи: ${j.milestones.filter(m => m.ok).length} из ${j.milestones.length}`);

console.log(`\nЗадействовано упражнений: ${seen.size} из ${Object.keys(EX).length}`);
const never = Object.keys(EX).filter(id => !seen.has(id));
console.log(never.length
  ? `Не выпали ни разу (${never.length}): ` + never.map(id => EX[id].n).join(' · ')
  : 'Все упражнения базы были использованы.');
console.log();
