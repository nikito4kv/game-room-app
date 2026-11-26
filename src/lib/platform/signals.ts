// ВАЖНО: только сервер. Автосигналы нарушений (А2): событие t=signal в потоке
// gr:ev. Админка показывает их в «Модерации», а high шлёт в Telegram.
//
// Сигнал — подсказка, а не решение: ничего не блокирует. Шумные сигналы (перебор
// пароля, спам) пишутся не чаще раза в окно через «однократник» onceIn.
import type { Severity, SignalKind } from "@/lib/api/platform";
import { getRedisRaw } from "@/lib/redis";
import { emitEvent, track } from "./events";

export type SignalContext = { code?: string; identity?: string; ip?: string; detail?: string };

const DETAIL_MAX = 200;

export function emitSignal(kind: SignalKind, severity: Severity, ctx: SignalContext = {}): Promise<void> {
  const ip = ctx.ip && ctx.ip !== "local" ? ctx.ip : undefined;
  return emitEvent({
    t: "signal",
    kind,
    severity,
    code: ctx.code,
    identity: ctx.identity,
    ip,
    detail: ctx.detail ? ctx.detail.slice(0, DETAIL_MAX) : undefined,
  });
}

/**
 * true — в этом окне ещё не было (и теперь отмечено); false — уже было. Redis
 * недоступен — true: лишний сигнал лучше пропущенного.
 */
export async function onceIn(key: string, seconds: number): Promise<boolean> {
  try {
    const res = await getRedisRaw().set(`gr:once:${key}`, "1", { nx: true, ex: seconds });
    return res !== null;
  } catch (err) {
    console.error("once check failed", err);
    return true;
  }
}

/** Сигнал не чаще раза в seconds на ключ (комнату, адрес…). Не бросает. */
export function emitSignalOnce(
  dedupKey: string,
  seconds: number,
  kind: SignalKind,
  severity: Severity,
  ctx: SignalContext = {},
): Promise<void> {
  return track(
    onceIn(`sig:${kind}:${dedupKey}`, seconds).then((first) =>
      first ? emitSignal(kind, severity, ctx) : undefined,
    ),
  );
}

/**
 * Использование функции (feature) не чаще раза в минуту на человека. С видом
 * (kind, например реакция 🔥) — раз в минуту на человека И вид: иначе по видам
 * посчиталась бы только первая реакция минуты. Не бросает.
 */
export function emitFeatureOnce(name: string, code: string, identity?: string, kind?: string): Promise<void> {
  const dedup = `feat:${name}:${code}:${identity ?? ""}${kind ? `:${kind}` : ""}`;
  return track(
    onceIn(dedup, 60).then((first) => (first ? emitEvent({ t: "feature", code, name, identity, kind }) : undefined)),
  );
}
