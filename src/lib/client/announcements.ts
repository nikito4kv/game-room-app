// Объявления администрации (А3) на клиенте: какие показать и какие человек уже
// закрыл крестиком. Сервер (GET /api/config) отдаёт только активные сейчас
// объявления для этого места; здесь — выбор из них и память о закрытых.
import { readLocalJSON, writeLocalJSON } from "@/lib/clientStorage";
import type { AnnouncementLevel, PublicConfigResponse } from "@/lib/api/platform";

export type PublicAnnouncement = PublicConfigResponse["announcements"][number];

const DISMISSED_KEY = "gr.announcements.dismissed";
/** Сколько закрытых id помним: старые объявления давно сняты, список не растёт вечно. */
export const DISMISSED_LIMIT = 50;

const LEVEL_ORDER: Record<AnnouncementLevel, number> = { critical: 0, warning: 1, info: 2 };

function isLevel(x: unknown): x is AnnouncementLevel {
  return x === "info" || x === "warning" || x === "critical";
}

/** Объявления из сети: только правильной формы, без повторов по id. */
export function parseAnnouncements(raw: unknown): PublicAnnouncement[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PublicAnnouncement[] = [];
  for (const a of raw) {
    if (typeof a !== "object" || a === null) continue;
    const r = a as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id || seen.has(r.id)) continue;
    if (typeof r.text !== "string" || !r.text.trim() || !isLevel(r.level)) continue;
    seen.add(r.id);
    out.push({ id: r.id, text: r.text.trim(), level: r.level });
  }
  return out;
}

/**
 * Что показать: не закрытые, сначала важные (critical → warning → info), при
 * равной важности — в порядке сервера. Критическое нельзя закрыть навсегда:
 * закрытое оно всё равно вернётся (его id не запоминаем — см. canDismiss).
 */
export function visibleAnnouncements(
  list: readonly PublicAnnouncement[],
  dismissed: readonly string[],
): PublicAnnouncement[] {
  const hidden = new Set(dismissed);
  return list
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => !hidden.has(a.id))
    .sort((x, y) => LEVEL_ORDER[x.a.level] - LEVEL_ORDER[y.a.level] || x.i - y.i)
    .map(({ a }) => a);
}

/** Критическое объявление (техработы прямо сейчас) закрывается только до перезагрузки страницы. */
export function canDismissForever(level: AnnouncementLevel): boolean {
  return level !== "critical";
}

/** Добавить id в закрытые: без повторов, свежие в конце, старые сверх лимита — долой. */
export function addDismissed(list: readonly string[], id: string): string[] {
  return [...list.filter((x) => x !== id), id].slice(-DISMISSED_LIMIT);
}

const isStringList = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === "string");

export function getDismissedAnnouncements(): string[] {
  return readLocalJSON<string[]>(DISMISSED_KEY, [], isStringList);
}

export function dismissAnnouncementForever(id: string): void {
  writeLocalJSON(DISMISSED_KEY, addDismissed(getDismissedAnnouncements(), id));
}
