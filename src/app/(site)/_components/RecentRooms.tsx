"use client";

import Link from "next/link";
import { useId, useMemo, useSyncExternalStore } from "react";
import { AvatarStack } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/icons";
import { getRecentRooms, type RecentRoom } from "@/lib/client/recentRooms";
import { usePublicConfig } from "@/lib/client/usePublicConfig";
import { visitedLabel } from "./labels";

type RecentRow = RecentRoom & { when: string };

// Список живёт в localStorage: на сервере и до гидрации его нет — блок не
// рисуем. Снимок — строка JSON: React сравнивает её по значению, поэтому новый
// массив из getRecentRooms() на каждом чтении не вызывает лишних перерисовок.
// «Вчера» считаем тут же, а не при рендере: так рендер остаётся чистым.
function readSnapshot(): string {
  const now = Date.now();
  const rows: RecentRow[] = getRecentRooms().map((r) => ({ ...r, when: visitedLabel(r.visitedAt, now) }));
  return JSON.stringify(rows);
}
const EMPTY = "[]";
const serverSnapshot = () => EMPTY;

// Комната пишет в список при входе и выходе. Другая вкладка — событие storage;
// возврат на страницу кнопкой «Назад» из bfcache — pageshow.
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("pageshow", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("pageshow", onChange);
  };
}

/** «Недавние»: до пяти комнат, где человек был. Пусто — блока нет. */
export function RecentRooms() {
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, serverSnapshot);
  const rooms = useMemo(() => JSON.parse(snapshot) as RecentRow[], [snapshot]);
  // Головы Румиков, пока флаг rumik_table не выключен (не пришёл — тоже Румики).
  const rumik = usePublicConfig()?.flags.rumik_table !== false;
  const headingId = useId();
  if (rooms.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="mt-2">
      <h2 id={headingId} className="px-3 text-label font-medium text-ink-3">
        Недавние
      </h2>
      <ul className="mt-1 flex flex-col">
        {rooms.map((r) => (
          <li key={r.code}>
            <Link
              href={`/room/${r.code}`}
              aria-label={`${r.title}, код ${r.code}, ${r.when}`}
              className="group flex items-center gap-3 rounded-card px-3 py-2.5 transition-colors duration-140 hover:bg-wash-1"
            >
              {/* Слот одной ширины у всех строк — названия стоят ровно друг под другом. */}
              <span className="flex w-[78px] shrink-0">
                {r.people?.length ? (
                  <AvatarStack
                    people={r.people.map((name) => ({ name }))}
                    size="sm"
                    max={2}
                    variant={rumik ? "rumik" : "initials"}
                  />
                ) : (
                  // С кем сидели, неизвестно — не выдумываем человека, а рисуем «историю».
                  <span className="grid size-8 place-items-center rounded-full bg-wash-2 text-ink-3">
                    <Icon name="history" size={16} />
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-ink">{r.title}</span>
                <span className="block text-caption text-ink-3">
                  {r.code} · {r.when}
                </span>
              </span>
              <Icon
                name="chevron-right"
                size={18}
                className="shrink-0 text-ink-3 transition-[translate] duration-140 motion-safe:group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
