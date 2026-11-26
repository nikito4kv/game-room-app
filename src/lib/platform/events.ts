// ВАЖНО: только сервер. Поток событий платформы для админки (А4): XADD в Redis
// gr:ev, админка забирает их через /api/internal/events и раскладывает у себя.
//
// Событие — побочный продукт запроса, а не его цель: сбой Redis не должен ронять
// вход в комнату или чат. Поэтому emitEvent никогда не бросает и не задерживает
// ответ (fire-and-forget). Незавершённые записи копятся в pending — тесты (и
// при желании маршрут) дожидаются их через settleEvents().
import {
  EVENTS_MAXLEN,
  EVENTS_STREAM,
  type PlatformEvent,
  type StoredEvent,
} from "@/lib/api/platform";
import { getRedisRaw } from "@/lib/redis";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Событие без времени (его ставит emitEvent) — ts можно передать явно. */
export type EventInput = DistributiveOmit<PlatformEvent, "ts"> & { ts?: string };

/** Потолок длины одного поля: поток не должен разрастаться из-за мусора. */
const FIELD_MAX = 300;

const pending = new Set<Promise<void>>();

/**
 * Сколько дней события (и адреса IP в них) живут в потоке. Старше — стираются
 * XTRIM MINID (раз в час при очередной записи), даже если MAXLEN не достигнут.
 * На этот срок ссылается политика конфиденциальности.
 */
export const EVENTS_RETENTION_DAYS = 30;
const TRIM_EVERY_MS = 60 * 60 * 1000;
let lastTrimAt = 0;
let minIdUnsupported = false;

/** Стереть события старше EVENTS_RETENTION_DAYS. Не бросает. */
export async function trimOldEvents(now: number = Date.now()): Promise<void> {
  lastTrimAt = now;
  const minId = `${now - EVENTS_RETENTION_DAYS * 24 * 60 * 60 * 1000}-0`;
  if (minIdUnsupported) return;
  try {
    await getRedisRaw().xtrim(EVENTS_STREAM, { strategy: "MINID", exactness: "~", threshold: minId });
  } catch (err) {
    // XTRIM MINID — с Redis 6.2 (на проде 7.4). Старый Redis локального стенда
    // отвечает «syntax error»: там чистка по времени не нужна, повторять не будем.
    if (/syntax error/i.test(String(err))) {
      minIdUnsupported = true;
      console.warn("XTRIM MINID не поддерживается этим Redis — чистка событий по времени выключена");
      return;
    }
    console.error("event trim failed", err);
  }
}

/** Поля события строками; пустые и undefined не пишем. */
export function eventFields(ev: EventInput, now: Date = new Date()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...ev, ts: ev.ts ?? now.toISOString() })) {
    if (v === undefined || v === null || v === "") continue;
    const s = String(v);
    out[k] = s.length > FIELD_MAX ? s.slice(0, FIELD_MAX) : s;
  }
  return out;
}

/**
 * Записать событие в поток. Не бросает: ошибка — в лог. Возвращает промис, который
 * всегда выполняется (await по желанию — например, перед ответом в тестах).
 */
export function emitEvent(ev: EventInput): Promise<void> {
  let job: Promise<void>;
  try {
    const fields = eventFields(ev);
    job = getRedisRaw()
      .xadd(EVENTS_STREAM, "*", fields, {
        trim: { type: "MAXLEN", threshold: EVENTS_MAXLEN, comparison: "~" },
      })
      .then(
        () => undefined,
        (err: unknown) => console.error("event write failed", ev.t, err),
      );
  } catch (err) {
    console.error("event write failed", ev.t, err);
    job = Promise.resolve();
  }
  if (Date.now() - lastTrimAt > TRIM_EVERY_MS) {
    lastTrimAt = Date.now();
    job = job.then(() => trimOldEvents());
  }
  pending.add(job);
  void job.finally(() => pending.delete(job));
  return job;
}

/**
 * Учесть фоновую работу, которая закончится записью события (например, проверка
 * «уже было» перед сигналом), чтобы settleEvents дождался и её. Не бросает.
 */
export function track(work: Promise<unknown>): Promise<void> {
  const job = work.then(
    () => undefined,
    (err: unknown) => console.error("background event job failed", err),
  );
  pending.add(job);
  void job.finally(() => pending.delete(job));
  return job;
}

/** Дождаться всех незавершённых записей событий (тесты, плавное завершение). */
export async function settleEvents(): Promise<void> {
  while (pending.size > 0) await Promise.all([...pending]);
}

/** Плоский [поле, значение, …] или объект → запись. */
function toRecord(raw: unknown): Record<string, string> {
  if (Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (let i = 0; i + 1 < raw.length; i += 2) out[String(raw[i])] = String(raw[i + 1]);
    return out;
  }
  if (typeof raw === "object" && raw !== null) {
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]));
  }
  return {};
}

/** Ответ XRANGE raw-клиента: [[id, [поле, значение…]], …] (или объект id → поля). */
export function parseStreamEntries(raw: unknown): StoredEvent[] {
  const pairs: Array<[string, unknown]> = Array.isArray(raw)
    ? raw.flatMap((e): Array<[string, unknown]> =>
        Array.isArray(e) && typeof e[0] === "string" ? [[e[0], e[1]]] : [],
      )
    : typeof raw === "object" && raw !== null
      ? Object.entries(raw)
      : [];
  return pairs.flatMap(([id, fields]) => {
    const rec = toRecord(fields);
    if (!rec.t || !rec.ts) return [];
    return [{ ...rec, id } as unknown as StoredEvent];
  });
}

const STREAM_ID = /^\d+(-\d+)?$/;

/** Наименьший id потока, больший данного: «1-5» → «1-6», «7» → «7-1». */
export function nextStreamId(id: string): string {
  const [ms, seq] = id.split("-");
  return `${ms}-${BigInt(seq ?? "0") + BigInt(1)}`;
}
export const EVENTS_MAX_COUNT = 1000;

/**
 * События строго после after (id потока; "0" или пусто — с начала), не больше count.
 * Бросает при сбое Redis — это читает только внутренний API.
 */
export async function readEvents(
  after: string | null,
  count: number,
): Promise<{ events: StoredEvent[]; last: string | null }> {
  const n = Math.min(Math.max(1, Math.floor(count) || 1), EVENTS_MAX_COUNT);
  // «Строго после» — следующий id (ms-(seq+1)), а не «(id»: исключающий диапазон
  // XRANGE есть только с Redis 6.2, а локальный стенд — Redis 5.
  const start = after && after !== "0" && STREAM_ID.test(after) ? nextStreamId(after) : "-";
  const raw: unknown = await getRedisRaw().xrange(EVENTS_STREAM, start, "+", n);
  const events = parseStreamEntries(raw);
  return { events, last: events.length > 0 ? events[events.length - 1]!.id : null };
}
