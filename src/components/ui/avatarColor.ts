// Цвет и инициалы аватара. Чистые функции — их же использует чат для цвета
// имени автора, чтобы человек был одного цвета везде.
//
// Цвет берётся из ника (а не из identity): identity может стать случайной на
// каждый вход, а друзья должны узнавать друг друга по цвету из сессии в сессию.

import { fnv1a32 } from "@/lib/hash";

/** Сколько цветов в палитре (--gr-avatar-0 … --gr-avatar-9 в tokens.css). */
export const AVATAR_COLORS = 10;

function normalizeSeed(seed: string): string {
  return seed.trim().toLocaleLowerCase("ru");
}

/** Индекс цвета 0…9 по нику. Регистр и пробелы по краям не влияют. */
export function avatarColorIndex(seed: string): number {
  return fnv1a32(normalizeSeed(seed)) % AVATAR_COLORS;
}

/**
 * Цвета для всей комнаты без повторов (пока людей не больше 10).
 * `seeds` — ники в порядке входа (participant.joinedAt). Каждый берёт свой
 * цвет по нику; если его уже занял тот, кто зашёл раньше, — следующий
 * свободный по кругу. Все клиенты видят одинаковый список в одинаковом
 * порядке, поэтому и цвета у всех совпадают.
 */
export function assignAvatarColors(seeds: readonly string[]): number[] {
  const taken = new Set<number>();
  return seeds.map((seed) => {
    let index = avatarColorIndex(seed);
    if (taken.size < AVATAR_COLORS) {
      while (taken.has(index)) index = (index + 1) % AVATAR_COLORS;
    }
    taken.add(index);
    return index;
  });
}

/** CSS-значение цвета для style: `var(--gr-avatar-3)`. */
export function avatarColorVar(index: number): string {
  const safe = ((Math.trunc(index) % AVATAR_COLORS) + AVATAR_COLORS) % AVATAR_COLORS;
  return `var(--gr-avatar-${safe})`;
}

const ALNUM = /[\p{L}\p{N}]/u;
const LETTER = /\p{L}/u;
// Граница «строчные → заглавная» внутри слова: NightOwl → Night Owl. Нужны хотя
// бы две строчные подряд, иначе «xX_Sniper» рассыпался бы на «x X».
const CAMEL = /(\p{Ll}{2,})(\p{Lu})/gu;

function firstAlnum(word: string): string | undefined {
  return Array.from(word).find((ch) => ALNUM.test(ch));
}

/**
 * Инициалы для аватара: одно слово — одна буква («Тёма» → «Т»), два и больше
 * слов — две («Даня Котов» → «ДК»). Эмодзи и знаки пропускаем. Слова из цифр
 * (год, номер) — не часть имени: «Лёха_2007» → «Л», а не «Л2»; берём их, только
 * если букв в нике нет совсем («123» → «1»). Пустой ник → «?».
 */
export function initialsOf(name: string): string {
  const firsts = name
    .replace(CAMEL, "$1 $2")
    .split(/[\s_\-.]+/u)
    .map(firstAlnum)
    .filter((ch): ch is string => Boolean(ch));
  if (firsts.length === 0) return "?";
  const letters = firsts.filter((ch) => LETTER.test(ch));
  const picked = letters.length > 0 ? letters : firsts;
  return (picked.length >= 2 ? picked[0] + picked[1] : picked[0]).toLocaleUpperCase("ru");
}
