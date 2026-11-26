// «Недавние комнаты» для лендинга: куда человек заходил и с кем там сидел.
// Пишет комната (при входе и при выходе — со свежим составом), читает лендинг.
//
// Хранится в localStorage этого браузера. Только то, что не секрет: код,
// название, время и ники. Пароли и ключи владельца сюда не кладём.
import { readLocalJSON, writeLocalJSON } from "@/lib/clientStorage";

export type RecentRoom = {
  /** Код комнаты, верхний регистр: «K7QMP4». */
  code: string;
  title: string;
  /** Последний вход или выход (Date.now()): для «вчера» и сортировки. */
  visitedAt: number;
  /** Ники других участников (без себя), до 4, в порядке входа — для AvatarStack. */
  people?: string[];
};

export type RecentRoomInput = { code: string; title: string; people?: readonly string[] };

const RECENT_KEY = "gr.recentRooms";
/** Сколько комнат помним. */
export const RECENT_LIMIT = 5;
/** Сколько ников храним у комнаты: стопка аватаров на лендинге показывает до 4. */
export const RECENT_PEOPLE_LIMIT = 4;

const isString = (x: unknown): x is string => typeof x === "string";

function isRecentRoom(x: unknown): x is RecentRoom {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const r = x as Record<string, unknown>;
  return (
    isString(r.code) &&
    r.code !== "" &&
    isString(r.title) &&
    typeof r.visitedAt === "number" &&
    Number.isFinite(r.visitedAt) &&
    (r.people === undefined || (Array.isArray(r.people) && r.people.every(isString)))
  );
}

/** Список из хранилища прошёл проверку формы целиком (руками испорченный — выбрасываем). */
export function isRecentRoomList(x: unknown): x is RecentRoom[] {
  return Array.isArray(x) && x.every(isRecentRoom);
}

/**
 * Новый список после входа или выхода: комната поднимается наверх (без повторов
 * по коду), время — now, лишнее отрезается. Пустой состав не затирает прежний:
 * при выходе последним в комнате никого нет, а показывать стоит тех, с кем сидели.
 */
export function upsertRecentRoom(
  list: readonly RecentRoom[],
  input: RecentRoomInput,
  now: number,
): RecentRoom[] {
  const code = input.code.trim().toUpperCase();
  const title = input.title.trim();
  if (!code || !title) return [...list];
  const previous = list.find((r) => r.code === code);
  const people = (input.people ?? [])
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, RECENT_PEOPLE_LIMIT);
  const kept = people.length > 0 ? people : previous?.people;
  const entry: RecentRoom = { code, title, visitedAt: now, ...(kept?.length ? { people: kept } : {}) };
  return [entry, ...list.filter((r) => r.code !== code)].slice(0, RECENT_LIMIT);
}

/** Недавние комнаты, новые сверху. Нет или испорчено — пустой список. */
export function getRecentRooms(): RecentRoom[] {
  return [...readLocalJSON<RecentRoom[]>(RECENT_KEY, [], isRecentRoomList)]
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, RECENT_LIMIT);
}

/** Запомнить вход в комнату (или выход — со свежим составом). */
export function rememberRoom(input: RecentRoomInput): void {
  writeLocalJSON(RECENT_KEY, upsertRecentRoom(getRecentRooms(), input, Date.now()));
}
