// Когда слать своё «звук выкл» и рацию на сервер (POST /api/voice), чтобы их
// видели другие. Чистая логика без React и сети — её крутит audio/useVoicePresence.
//
// Сверяемся не с тем, что уже отправили, а с тем, что сейчас лежит в своих
// атрибутах LiveKit (их пишет сервер, LiveKit присылает и нам). Короткий обрыв
// их не трогает, а после полного переподключения или входа заново атрибутов
// нет — расхождение видно само, и состояние уходит снова без отдельной логики
// «переподключились».
import type { PublicVoiceState } from "@/lib/api/contract";

/** Пауза перед отправкой: дребезг клавиши D и смены режима схлопываются в один запрос. */
export const VOICE_SYNC_DEBOUNCE_MS = 300;
/**
 * Сервер принял состояние, а в атрибуты оно так и не пришло: столько ждём, прежде
 * чем отправить то же ещё раз. Обычно атрибуты приходят через десятки мс.
 */
export const VOICE_SYNC_CONFIRM_MS = 2_000;
/** Паузы после сбоев подряд: 5, 10, 20, 40 с, дальше раз в минуту. */
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;

export type VoiceSync = {
  /** Запрос в пути: второй не шлём, иначе записи могут прийти не по порядку. */
  inFlight: boolean;
  /** Сбоев подряд; «принято, но не дошло» второй раз подряд — тоже сбой. */
  failures: number;
  /** Повтор того же состояния или отправку после сбоя — не раньше (мс с эпохи). */
  notBefore: number;
  /** Что сервер принял последним; null — с последней сверки ничего. */
  accepted: PublicVoiceState | null;
};

export const IDLE_VOICE_SYNC: VoiceSync = { inFlight: false, failures: 0, notBefore: 0, accepted: null };

export function sameVoice(a: PublicVoiceState, b: PublicVoiceState): boolean {
  return a.deafened === b.deafened && a.ptt === b.ptt;
}

export type VoiceSyncPlan = {
  sync: VoiceSync;
  /** Через сколько мс отправить wanted; null — слать нечего или ждём ответа. */
  sendInMs: number | null;
};

const backoffMs = (failures: number) => Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (failures - 1));

/**
 * Что делать сейчас. wanted — своё состояние, shown — что видят другие (свои
 * атрибуты). Запрос в пути — ждём его ответа: после него спросят снова. Сошлось —
 * прошлые сбои забыты. Новое состояние — после короткой паузы; то же, что сервер
 * уже принял, или отправка после сбоя — не раньше notBefore.
 */
export function planVoiceSync(
  wanted: PublicVoiceState,
  shown: PublicVoiceState,
  sync: VoiceSync,
  now: number,
): VoiceSyncPlan {
  if (sync.inFlight) return { sync, sendInMs: null };
  if (sameVoice(wanted, shown)) return { sync: IDLE_VOICE_SYNC, sendInMs: null };
  const repeat = sync.accepted !== null && sameVoice(sync.accepted, wanted);
  const wait = repeat || sync.failures > 0 ? sync.notBefore - now : 0;
  return { sync, sendInMs: Math.max(VOICE_SYNC_DEBOUNCE_MS, wait) };
}

export type VoiceSyncResult = { ok: true; sent: PublicVoiceState } | { ok: false; retryAfterSec?: number };

/**
 * Состояние после ответа сервера. Сбой человеку не показываем (это подсказка
 * друзьям, а не его голос) — просто повторим позже: по нарастающей паузе или по
 * retryAfterSec из RATE_LIMITED, если она длиннее. Если сервер снова принял то
 * же самое, а атрибуты так и не пришли, — паузы тоже растут: по кругу не шлём.
 */
export function afterVoiceSync(sync: VoiceSync, result: VoiceSyncResult, now: number): VoiceSync {
  if (!result.ok) {
    const failures = sync.failures + 1;
    const wait = Math.max(backoffMs(failures), (result.retryAfterSec ?? 0) * 1000);
    return { ...sync, inFlight: false, failures, notBefore: now + wait };
  }
  const again = sync.accepted !== null && sameVoice(sync.accepted, result.sent);
  const failures = again ? sync.failures + 1 : 0;
  return {
    inFlight: false,
    failures,
    notBefore: now + (again ? backoffMs(failures) : VOICE_SYNC_CONFIRM_MS),
    accepted: result.sent,
  };
}
