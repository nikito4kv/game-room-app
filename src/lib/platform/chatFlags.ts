// Детектор подозрительных слов в чате (А2). Ловит, а не блокирует: сообщение
// уходит как обычно, а в поток событий — сигнал chat_flag с коротким отрывком.
// Список нарочно короткий: грубые оскорбления (в том числе по национальности и
// ориентации) и явные маркеры нелегального контента. Обычный мат между друзьями —
// не повод для сигнала, его тут нет.
//
// Нормализация: регистр, ё→е, латинские и цифровые «двойники» кириллицы (a→а,
// 0→о, 3→з…), разделители внутри слова (х.у.й, х у й) не помогают — сравниваем
// и по склеенным словам.

/** Отрывок в сигнале — не длиннее. */
export const CHAT_FLAG_EXCERPT_MAX = 120;

export type ChatFlagCategory = "abuse" | "hate" | "illegal";
export type ChatFlag = { category: ChatFlagCategory; match: string; excerpt: string };

// Латиница и цифры, похожие на кириллицу (для русских слов).
const LOOKALIKE: Record<string, string> = {
  a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у",
  "0": "о", "3": "з", "4": "ч", "6": "б", "@": "а", u: "и", r: "г",
};

/** Слово начинается с основы (ловит окончания). */
const RU_PREFIX: Array<[string, ChatFlagCategory]> = [
  ["пидор", "hate"],
  ["пидар", "hate"],
  ["педик", "hate"],
  ["хуесос", "abuse"],
  ["уебок", "abuse"],
  ["уебищ", "abuse"],
  ["долбоеб", "abuse"],
  ["выблядок", "abuse"],
  ["чурк", "hate"],
  ["черножоп", "hate"],
  ["жидов", "hate"],
  ["закладчик", "illegal"],
];

/** Только целое слово (короткие основы дают ложные срабатывания внутри слов). */
const RU_WORD: Array<[string, ChatFlagCategory]> = [
  ["хач", "hate"],
  ["хачи", "hate"],
  ["жид", "hate"],
  ["жиды", "hate"],
  ["мразь", "abuse"],
  ["шлюха", "abuse"],
  ["хохол", "hate"],
  ["хохлы", "hate"],
  ["цп", "illegal"],
];

/** Фразы (после нормализации, слова через пробел). */
const RU_PHRASE: Array<[string, ChatFlagCategory]> = [
  ["детское порно", "illegal"],
  ["детская порнография", "illegal"],
  ["продам наркот", "illegal"],
  ["купить наркот", "illegal"],
  ["купить закладк", "illegal"],
  ["убей себя", "abuse"],
];

const EN_PREFIX: Array<[string, ChatFlagCategory]> = [
  ["nigger", "hate"],
  ["nigga", "hate"],
  ["faggot", "hate"],
  ["kys", "abuse"],
];

const EN_PHRASE: Array<[string, ChatFlagCategory]> = [
  ["child porn", "illegal"],
  ["kill yourself", "abuse"],
  ["cp links", "illegal"],
];

/** Нижний регистр, ё→е, всё, кроме букв и цифр, — пробел. */
function basic(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}@]+/gu, " ")
    .trim();
}

/** Русская версия: латинские и цифровые двойники → кириллица (только в «смешанных» словах и чистой латинице). */
function cyrillicize(word: string): string {
  return [...word].map((ch) => LOOKALIKE[ch] ?? ch).join("");
}

function excerptAround(text: string, needle: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if ([...flat].length <= CHAT_FLAG_EXCERPT_MAX) return flat;
  const i = Math.max(0, flat.toLowerCase().replace(/ё/g, "е").indexOf(needle));
  const start = Math.max(0, i - 40);
  return [...flat].slice(start, start + CHAT_FLAG_EXCERPT_MAX).join("");
}

/**
 * Первое совпадение со списком или null. Чистая функция: никаких побочных эффектов.
 */
export function detectChatFlag(text: string): ChatFlag | null {
  const plain = basic(text);
  if (!plain) return null;
  const words = plain.split(" ");
  const ruWords = words.map(cyrillicize);
  // Слова, разбитые на буквы («х у й»): склеиваем подряд идущие одиночные символы.
  const glued: string[] = [];
  let run = "";
  for (const w of ruWords) {
    if ([...w].length === 1) run += w;
    else {
      if (run.length > 1) glued.push(run);
      run = "";
    }
  }
  if (run.length > 1) glued.push(run);
  const ruAll = [...ruWords, ...glued];
  const ruText = ruWords.join(" ");

  const hit = (match: string, category: ChatFlagCategory): ChatFlag => ({
    category,
    match,
    excerpt: excerptAround(text, match),
  });

  for (const [stem, cat] of RU_PREFIX) if (ruAll.some((w) => w.startsWith(stem))) return hit(stem, cat);
  for (const [word, cat] of RU_WORD) if (ruAll.includes(word)) return hit(word, cat);
  for (const [phrase, cat] of RU_PHRASE) if (ruText.includes(phrase)) return hit(phrase, cat);
  for (const [stem, cat] of EN_PREFIX) if (words.some((w) => w.startsWith(stem))) return hit(stem, cat);
  for (const [phrase, cat] of EN_PHRASE) if (plain.includes(phrase)) return hit(phrase, cat);
  return null;
}
