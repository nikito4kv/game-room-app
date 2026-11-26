// Код комнаты: алфавит, проверка и «умная» чистка того, что человек ввёл или
// вставил в поле «Код или ссылка» на лендинге.
//
// Алфавит — без похожих символов 0/O и 1/I/L, чтобы код легко диктовать
// голосом. Он один на клиент и сервер: генератор кодов (generateRoomCode в
// src/lib/livekit.ts) берёт ROOM_CODE_ALPHABET и ROOM_CODE_LENGTH отсюда, а тест
// ещё и проверяет коды сервера здесь.
//
// Модуль без зависимостей: его можно звать и в браузере, и в тестах.

export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const VALID = new Set(ROOM_CODE_ALPHABET);
const CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/** Строка — готовый код комнаты: 6 символов из алфавита, верхний регистр. */
export function isRoomCode(value: string): boolean {
  return CODE_RE.test(value);
}

/**
 * Кириллица, которая выглядит как латиница: друг диктует «К7QMP4», а человек
 * на русской раскладке набирает «К» кириллицей — на вид то же самое. Ключи —
 * заглавные: строчные приводим к ним заранее. Ещё пара букв соседних языков
 * (белорусская и украинская «і», сербская «ј», македонская «ѕ», казахская «ү»).
 */
const CYRILLIC_TWINS: Readonly<Record<string, string>> = {
  А: "A",
  В: "B",
  Е: "E",
  Ё: "E",
  К: "K",
  М: "M",
  Н: "H",
  О: "O",
  Р: "P",
  С: "C",
  Т: "T",
  У: "Y",
  Х: "X",
  І: "I",
  Ї: "I",
  Ј: "J",
  Ѕ: "S",
  Ү: "Y",
};

/** Буквы и цифры, которых в кодах не бывает: их легко перепутать при диктовке. */
const CONFUSABLE = new Set(["O", "I", "L", "0", "1"]);

/**
 * Почему часть ввода выброшена — для подсказки под полем:
 *  layout     — русские буквы без латинского двойника: скорее всего, не та раскладка;
 *  confusable — O, I, L, 0 или 1: в кодах их не бывает;
 *  invalid    — прочие буквы и цифры (другие алфавиты);
 *  link       — вставили ссылку, но не на комнату.
 */
export type RoomCodeNote = "layout" | "confusable" | "invalid" | "link";

export type CleanedRoomCode = {
  /** Код в верхнем регистре, только символы алфавита, не длиннее 6. */
  code: string;
  /** Что выбросили и почему; null — ничего важного не потерялось. */
  note: RoomCodeNote | null;
};

// Код из ссылки вида …/room/K7QMP4 (с протоколом и без, с ?query и #hash).
const LINK_CODE_RE = /\/room\/([^\s/?#"'<>«»]+)/i;
// Похоже на ссылку, но без /room/КОД: протокол, www. или «домен/путь».
const LOOKS_LIKE_LINK_RE = /:\/\/|^www\.|\.[a-z]{2,}\//i;

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;

// Если выброшено несколько разных символов, показываем самую полезную подсказку.
const NOTE_PRIORITY: readonly RoomCodeNote[] = ["layout", "confusable", "invalid"];

function decode(token: string): string {
  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
}

/** Посимвольная чистка: двойники → латиница, разделители молча выбрасываем. */
function filterChars(text: string): CleanedRoomCode {
  let code = "";
  const notes = new Set<RoomCodeNote>();
  for (const raw of text.toUpperCase()) {
    const ch = CYRILLIC_TWINS[raw] ?? raw;
    if (VALID.has(ch)) {
      if (code.length < ROOM_CODE_LENGTH) code += ch;
      continue;
    }
    // Пробелы, дефисы, «#», точки и прочие знаки — просто разделители.
    if (!LETTER_OR_DIGIT.test(ch)) continue;
    if (CONFUSABLE.has(ch)) notes.add("confusable");
    else if (CYRILLIC.test(ch)) notes.add("layout");
    else notes.add("invalid");
  }
  return { code, note: NOTE_PRIORITY.find((n) => notes.has(n)) ?? null };
}

/**
 * Достаёт код комнаты из того, что человек ввёл или вставил:
 *  • ссылка (https://…/room/k7qmp4, с текстом вокруг) → код из ссылки;
 *  • сообщение вида «Код: K7QMP4, пароль 1234» → слово, которое целиком код;
 *  • иначе — посимвольно: кириллические двойники в латиницу, верхний регистр,
 *    пробелы и дефисы выбросить, лишнее после 6 символов отрезать.
 * Звать на каждое изменение поля: на уже чистом коде функция ничего не меняет.
 */
export function cleanRoomCodeInput(input: string): CleanedRoomCode {
  // NFKC: полноширинные «Ｋ７» из азиатских раскладок становятся обычными K7.
  const text = input.normalize("NFKC").trim();
  if (!text) return { code: "", note: null };

  const link = LINK_CODE_RE.exec(text);
  if (link) return filterChars(decode(link[1]));
  if (LOOKS_LIKE_LINK_RE.test(text)) return { code: "", note: "link" };

  const words = text.split(/\s+/);
  if (words.length > 1) {
    const codes = words
      .map(filterChars)
      .filter((c) => c.note === null && isRoomCode(c.code));
    // Слово с цифрой — скорее код, чем «THANKS» или «КАРАТЕ» из того же сообщения.
    const best = codes.find((c) => /\d/.test(c.code)) ?? codes[0];
    if (best) return best;
  }
  return filterChars(text);
}
