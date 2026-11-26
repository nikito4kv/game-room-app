// Игры в комнате на клиенте: как выглядят кнопки и пузыри над местами, как
// собрать итог «Все готовы?». Чистые данные и функции без React — их читают
// поповер, пузырь, лента игр и тесты. Контракт — раздел «Игры в комнате».
import type { GameAction } from "@/lib/api/contract";
import type { GlyphSpec } from "@/components/ui/Glyph";
import type { RumikEyes, RumikPose } from "@/components/ui/Rumik";

/** Кнопки в поповере: что делают и как подписаны. */
export const GAME_BUTTONS: readonly {
  action: Exclude<GameAction, "ready_answer">;
  glyph: GlyphSpec;
  title: string;
  hint: string;
}[] = [
  { action: "dice", glyph: { icon: "dice" }, title: "Бросить кубик", hint: "Выпадет число от 1 до 6, его увидят все" },
  {
    action: "pick",
    glyph: { icon: "target", tone: "text-alert-ink" },
    title: "Кто платит?",
    hint: "Случайный человек из тех, кто сейчас в комнате",
  },
  {
    action: "ready",
    glyph: { icon: "hand" },
    title: "Все готовы?",
    hint: "Каждый ответит «Готов», итог увидят все. Опрос идёт 30 секунд",
  },
];

/** Что всплывает над местом от игр: кубик с числом, «выпало на тебя», вопрос и ответ. */
export type GameBubble =
  "dice1" | "dice2" | "dice3" | "dice4" | "dice5" | "dice6" | "picked" | "asked" | "ready" | "notReady";

/** Пузырь с гранью кубика для значения 1–6. */
export function diceBubble(value: number): GameBubble {
  return `dice${Math.min(6, Math.max(1, Math.round(value)))}` as GameBubble;
}

export const GAME_VIEW: Readonly<Record<GameBubble, { glyph: GlyphSpec; label: string; spoken: string }>> = {
  dice1: { glyph: { icon: "dice", text: "1" }, label: "Кубик: 1", spoken: "кубик, 1" },
  dice2: { glyph: { icon: "dice", text: "2" }, label: "Кубик: 2", spoken: "кубик, 2" },
  dice3: { glyph: { icon: "dice", text: "3" }, label: "Кубик: 3", spoken: "кубик, 3" },
  dice4: { glyph: { icon: "dice", text: "4" }, label: "Кубик: 4", spoken: "кубик, 4" },
  dice5: { glyph: { icon: "dice", text: "5" }, label: "Кубик: 5", spoken: "кубик, 5" },
  dice6: { glyph: { icon: "dice", text: "6" }, label: "Кубик: 6", spoken: "кубик, 6" },
  picked: {
    glyph: { icon: "target", tone: "text-alert-ink" },
    label: "Выпало на этого человека",
    spoken: "выпало на него",
  },
  asked: { glyph: { icon: "hand" }, label: "Спрашивает: все готовы?", spoken: "спрашивает, все ли готовы" },
  ready: { glyph: { icon: "check-circle", tone: "text-signal-ink" }, label: "Готов", spoken: "готов" },
  notReady: { glyph: { icon: "x", tone: "text-alert-ink" }, label: "Не готов", spoken: "не готов" },
};

/** Жесты Румика (§8: только по событию, ≤ 2 с). */
export const GAME_GESTURES: Readonly<Record<GameBubble, { pose: RumikPose; eyes?: RumikEyes }>> = {
  dice1: { pose: "point" },
  dice2: { pose: "point" },
  dice3: { pose: "point" },
  dice4: { pose: "point" },
  dice5: { pose: "point" },
  dice6: { pose: "cheer", eyes: "wide" },
  picked: { pose: "stand", eyes: "wide" },
  asked: { pose: "wave" },
  ready: { pose: "cheer" },
  notReady: { pose: "stand", eyes: "lost" },
};

// ───────────────────────────── «Все готовы?» ─────────────────────────────

/** Идущий опрос: кто спросил, кого ждём (кто был в комнате в момент вопроса) и ответы. */
export type ReadyCheck = {
  id: string;
  asker: string;
  /** Кого спросили: все, кто был в комнате, включая спросившего. */
  expected: readonly string[];
  answers: ReadonlyMap<string, boolean>;
};

/** Ответ участника; ответы не тех, кого спрашивали (вошёл позже), не считаются. */
export function answerReady(check: ReadyCheck, identity: string, ready: boolean): ReadyCheck {
  if (!check.expected.includes(identity)) return check;
  const answers = new Map(check.answers);
  answers.set(identity, ready);
  return { ...check, answers };
}

export type ReadyTally = { ready: string[]; notReady: string[]; waiting: string[]; done: boolean };

/** Итог: готовы, не готовы и кто молчит; done — ответили все. */
export function tallyReady(check: ReadyCheck): ReadyTally {
  const ready: string[] = [];
  const notReady: string[] = [];
  const waiting: string[] = [];
  for (const id of check.expected) {
    const a = check.answers.get(id);
    (a === true ? ready : a === false ? notReady : waiting).push(id);
  }
  return { ready, notReady, waiting, done: waiting.length === 0 };
}

/** Перечислить ники: «Аня, Боря и ещё 3». */
export function nameList(names: readonly string[], max = 3): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} и ещё ${names.length - max}`;
}

/**
 * Текст тоста опроса. Пока идёт — «Готовы 2 из 5»; закончился (все ответили или
 * вышло время) — «Все готовы!» или «Готовы 3 из 5» и кто не готов или молчал.
 */
export function readyText(
  tally: ReadyTally,
  nameOf: (identity: string) => string,
  finished: boolean,
): { title: string; description: string } {
  const total = tally.ready.length + tally.notReady.length + tally.waiting.length;
  if (!finished) return { title: "Все готовы?", description: `Готовы ${tally.ready.length} из ${total}` };
  if (tally.ready.length === total) return { title: "Все готовы!", description: `${total} из ${total}` };
  const missing = [...tally.notReady, ...tally.waiting].map(nameOf);
  return {
    title: `Готовы ${tally.ready.length} из ${total}`,
    description: `Не готовы: ${nameList(missing)}`,
  };
}
