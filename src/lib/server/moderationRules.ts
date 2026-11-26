// Правила модерации — чистые функции. Маршрут /api/moderate собирает факты
// (кто вызывает, кто хост и владелец, кто в комнате), решают эти функции.
import {
  HOST_HANDOVER_DELAY_SEC,
  type ApiError,
  type ModerationAction,
} from "@/lib/api/contract";
import { apiError, retryError } from "./errors";

/**
 * К кому применяется действие:
 *  • none — ни к кому (настройки, список банов);
 *  • present — к тому, кто сейчас в комнате;
 *  • known — к присутствующему или недавно бывшему (его ник ещё помнит сервер):
 *    кикнуть или заглушить только что выскочившего — нормальная просьба хоста;
 *  • any — к любой строке (разбан: в комнате забаненного нет по определению).
 */
type TargetRule = "none" | "present" | "known" | "any";

type Rule = {
  /** Только для хоста. reclaim и claim проверяются отдельно. */
  hostOnly: boolean;
  target: TargetRule;
  /** Владелец неуязвим: его нельзя кикнуть, забанить, заглушить, лишить чата. */
  ownerImmune: boolean;
  /** Нельзя применить к себе. */
  notSelf: boolean;
};

const rule = (target: TargetRule, extra: Partial<Rule> = {}): Rule => ({
  hostOnly: true,
  target,
  ownerImmune: false,
  notSelf: false,
  ...extra,
});
const harsh = { ownerImmune: true, notSelf: true };

const MODERATION_RULES: Record<ModerationAction, Rule> = {
  kick: rule("known", harsh),
  ban: rule("known", harsh),
  unban: rule("any"),
  bans: rule("none"),
  mute: rule("known", harsh),
  unmute: rule("known"),
  muteAll: rule("none"),
  stopScreen: rule("present"),
  allowScreen: rule("known"),
  disallowScreen: rule("known"),
  chatMute: rule("known", harsh),
  chatUnmute: rule("known"),
  transfer: rule("present", { notSelf: true }),
  reclaim: rule("none", { hostOnly: false }),
  claim: rule("none", { hostOnly: false }),
  settings: rule("none"),
};

export function isModerationAction(x: unknown): x is ModerationAction {
  return typeof x === "string" && Object.hasOwn(MODERATION_RULES, x);
}

export type ModerationCheckInput = {
  action: ModerationAction;
  caller: string;
  target: string | null;
  hostIdentity: string | null;
  ownerIdentity: string | null;
  targetPresent: boolean;
  targetKnown: boolean;
};

/** Можно ли выполнить действие. null — можно. Присутствие вызывающего проверяет маршрут. */
export function checkModeration(input: ModerationCheckInput): ApiError | null {
  const r = MODERATION_RULES[input.action];
  if (r.hostOnly && input.caller !== input.hostIdentity) return apiError("NOT_HOST");
  if (r.target === "none") return null;
  if (!input.target) return apiError("BAD_REQUEST", "Не указан участник");
  if (r.notSelf && input.target === input.caller) return apiError("TARGET_IS_SELF");
  if (r.ownerImmune && input.target === input.ownerIdentity) return apiError("TARGET_IS_OWNER");
  if (r.target === "present" && !input.targetPresent) return apiError("TARGET_NOT_FOUND");
  if (r.target === "known" && !input.targetPresent && !input.targetKnown) {
    return apiError("TARGET_NOT_FOUND");
  }
  return null;
}

export type ClaimInput = {
  now: number;
  caller: string;
  hostIdentity: string | null;
  hostPresent: boolean;
  /**
   * С какого момента место хоста свободно (мс): отметка ухода хоста из вебхука
   * participant_left или время создания комнаты, если хоста ещё не было. null —
   * неизвестно (вебхук потерялся): тогда отсчёт начинается сейчас.
   */
  vacantSince: number | null;
};

export type ClaimDecision =
  | { kind: "grant" }
  | { kind: "already" }
  | { kind: "startCountdown" }
  | { kind: "refuse"; error: ApiError };

/**
 * Занять свободное место хоста. Пауза HOST_HANDOVER_DELAY_SEC после ухода хоста
 * проверяется здесь, на сервере: перезагрузка страницы у хоста больше не отдаёт
 * корону первому попавшемуся, и подправленный клиент паузу не обойдёт.
 */
export function decideClaim(input: ClaimInput): ClaimDecision {
  if (input.hostIdentity === input.caller) return { kind: "already" };
  if (input.hostIdentity !== null && input.hostPresent) {
    return { kind: "refuse", error: apiError("HOST_PRESENT") };
  }
  if (input.vacantSince === null) return { kind: "startCountdown" };
  const waitMs = HOST_HANDOVER_DELAY_SEC * 1000 - (input.now - input.vacantSince);
  if (waitMs > 0) {
    return { kind: "refuse", error: retryError("HOST_HANDOVER_PENDING", waitMs / 1000) };
  }
  return { kind: "grant" };
}
