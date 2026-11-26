// Тексты лендинга, которые зависят от данных, — чистые функции (тест рядом).

import { NAME_MAX_LENGTH } from "@/lib/api/contract";
import { plural } from "@/lib/plural";
import type { RoomCodeNote } from "@/lib/roomCode";

/** Название, если человек его не заполнил и ника ещё нет (первый вход на сайт). */
export const FALLBACK_ROOM_TITLE = "Комната друзей";

/**
 * Название новой комнаты по нику: «Тёма и друзья». Ник не склоняем, поэтому
 * не «Комната Тёмы». Ник берётся сохранённый с прошлого входа; если его нет —
 * нейтральное «Комната друзей».
 */
export function defaultRoomTitle(nickname: string | null): string {
  const name = Array.from(nickname?.trim() ?? "")
    .slice(0, NAME_MAX_LENGTH)
    .join("")
    .trim();
  return name ? `${name} и друзья` : FALLBACK_ROOM_TITLE;
}

/** Подсказка под полем «Код или ссылка»: почему часть ввода пропала. */
export function codeNoteText(note: RoomCodeNote | null): string | undefined {
  switch (note) {
    case "layout":
      return "Похоже, включена русская раскладка: в коде только латиница и цифры";
    case "confusable":
      return "В кодах не бывает букв O, I, L и цифр 0, 1. Проверьте код";
    case "invalid":
      return "В коде только латинские буквы и цифры";
    case "link":
      return "В этой ссылке нет кода комнаты";
    default:
      return undefined;
  }
}

const DAY_MS = 86_400_000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const DAY_MONTH = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });

/**
 * Когда были в комнате, по календарным дням в часовом поясе человека:
 * «сегодня», «вчера», «3 дня назад», «неделю назад», «2 недели назад»,
 * дальше — дата («12 сентября»). Время из будущего (часы сбились) — «сегодня».
 */
export function visitedLabel(visitedAt: number, now: number): string {
  // round, а не floor: при переходе на летнее время в сутках 23 или 25 часов.
  const days = Math.round((startOfDay(now) - startOfDay(visitedAt)) / DAY_MS);
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  if (days < 7) return `${days} ${plural(days, ["день", "дня", "дней"])} назад`;
  if (days < 14) return "неделю назад";
  if (days < 28) {
    const weeks = Math.floor(days / 7);
    return `${weeks} ${plural(weeks, ["неделю", "недели", "недель"])} назад`;
  }
  const date = new Date(visitedAt);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return (sameYear ? DAY_MONTH : DAY_MONTH_YEAR).format(date);
}
