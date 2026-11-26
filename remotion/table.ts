import { SHARED } from "./copy";
import type { AvatarStatus } from "./components/Avatar";
import type { Seat } from "./components/RoundTable";
import { voiceLevel, win } from "./fx";

/**
 * Собирает места за столом из SHARED.people.
 *   appear   — кадры, когда каждый садится (по порядку людей); пропуск = уже сидит;
 *   speaking — кто и в каких кадрах говорит: { "Тёма": [[24, 70], [110, 150]] };
 *   status   — значки состояния: { "Лёха": "muted" }.
 */
export function buildSeats(cfg: {
  appear?: number[];
  speaking?: Record<string, [number, number][]>;
  status?: Record<string, AvatarStatus>;
  count?: number;
}): Seat[] {
  const people = SHARED.people.slice(0, cfg.count ?? SHARED.people.length);
  return people.map((p, i) => {
    const windows = cfg.speaking?.[p.name] ?? [];
    return {
      name: p.name,
      color: p.color,
      host: "host" in p ? p.host : false,
      status: cfg.status?.[p.name] ?? null,
      appearAt: cfg.appear?.[i] ?? 0,
      seed: i + 1,
      speak: (frame: number) => Math.max(0, ...windows.map(([a, b]) => win(frame, a, b))),
      level: (frame: number) => voiceLevel(frame, i + 1),
    };
  });
}
