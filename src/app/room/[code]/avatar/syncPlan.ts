// Когда слать свой рисунок Румика на сервер (POST /api/avatar), чтобы его видели
// другие. Чистая логика без React и сети — её крутит AvatarSync.tsx.
//
// Сверяемся не с тем, что отправили, а с тем, что лежит в своём атрибуте
// avatar.id (его пишет сервер, LiveKit присылает и нам): после входа заново
// атрибута в новой сессии нет — расхождение видно само, и рисунок уходит снова.
// Свой id клиент не считает: какой id у какого рисунка, говорит ответ сервера.
//
// Сервер отказал в рисунке (скрыт администрацией, не годится, место кончилось) —
// цель становится «без рисунка»: атрибут снимается одним запросом png: null, и
// другие видят Румика своего цвета без рисунка, а не прошлый рисунок.

/** Пауза перед отправкой при входе, после входа заново и когда рисунок стёрли. */
export const AVATAR_SYNC_DEBOUNCE_MS = 1_000;
/**
 * Рисунок сменили, пока сидим в комнате (рисуют в соседней вкладке, каждый штрих
 * сохраняется), — шлём, когда правок не было столько: один запрос на сеанс
 * рисования, а не по запросу на каждую паузу.
 */
export const AVATAR_SYNC_QUIET_MS = 15_000;
/** Не чаще раза в столько: сервер пускает 4 за 15 с (avatarLimit). */
export const AVATAR_SYNC_GAP_MS = 5_000;
/** Сервер принял, а атрибут не пришёл: столько ждём, прежде чем отправить снова. */
export const AVATAR_SYNC_CONFIRM_MS = 2_000;
/** Паузы после сбоев подряд: 5, 10, 20, 40 с, дальше раз в минуту. */
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;

export type AvatarSync = {
  /** Запрос в пути: второй не шлём, ждём ответа. */
  inFlight: boolean;
  /** Сбоев подряд; «принято, но не дошло» второй раз подряд — тоже сбой. */
  failures: number;
  /** Повтор того же рисунка или отправку после сбоя — не раньше (мс с эпохи). */
  notBefore: number;
  /** Когда ушёл последний запрос (мс с эпохи). */
  lastSentAt: number;
  /** Что сервер принял последним: какой рисунок (data URL) и под каким id. */
  accepted: { paint: string | null; id: string | null } | null;
  /** Рисунок, который сервер не примет: его не повторяем, вместо него — «без рисунка». */
  refused: string | null;
  /** Последний увиденный свой рисунок и когда он стал таким (0 — был ещё до входа). */
  seen: { paint: string | null; at: number } | null;
};

export const IDLE_AVATAR_SYNC: AvatarSync = {
  inFlight: false,
  failures: 0,
  notBefore: 0,
  lastSentAt: 0,
  accepted: null,
  refused: null,
  seen: null,
};

export type AvatarSyncPlan = {
  sync: AvatarSync;
  /** Что должно оказаться у других: свой рисунок или null (без рисунка). */
  send: string | null;
  /** Через сколько мс отправить send; null — слать нечего или ждём ответа. */
  sendInMs: number | null;
};

const backoffMs = (failures: number) => Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (failures - 1));

/** Что должны видеть другие: свой рисунок, а если сервер его не принял, — ничего. */
export function avatarTarget(wanted: string | null, sync: AvatarSync): string | null {
  return wanted !== null && wanted === sync.refused ? null : wanted;
}

/** Другие уже видят цель: рисунок под принятым id или, без рисунка, ничего. */
export function avatarSettled(target: string | null, shown: string | null, sync: AvatarSync): boolean {
  if (target === null) return shown === null;
  return sync.accepted !== null && sync.accepted.paint === target && sync.accepted.id === shown;
}

/**
 * Что делать сейчас. wanted — свой рисунок (data URL) или null, shown — id в
 * своём атрибуте. Сошлось — прошлые сбои забыты. Иначе — после короткой паузы,
 * но не чаще AVATAR_SYNC_GAP_MS; рисунок, сменённый уже в комнате, — после
 * AVATAR_SYNC_QUIET_MS без правок; повтор того, что сервер уже принял, и
 * отправка после сбоя — не раньше notBefore.
 */
export function planAvatarSync(
  wanted: string | null,
  shown: string | null,
  sync: AvatarSync,
  now: number,
): AvatarSyncPlan {
  const seen =
    sync.seen === null ? { paint: wanted, at: 0 } : sync.seen.paint !== wanted ? { paint: wanted, at: now } : sync.seen;
  const s = seen === sync.seen ? sync : { ...sync, seen };
  const send = avatarTarget(wanted, s);
  if (s.inFlight) return { sync: s, send, sendInMs: null };
  if (avatarSettled(send, shown, s)) {
    return { sync: s.failures === 0 ? s : { ...s, failures: 0, notBefore: 0 }, send, sendInMs: null };
  }
  const repeat = s.accepted !== null && s.accepted.paint === send;
  // Затишье ждём только для рисунка: «без рисунка» (стёрли, отказ) уходит сразу.
  const quietUntil = send !== null ? seen.at + AVATAR_SYNC_QUIET_MS : 0;
  const earliest = Math.max(
    s.lastSentAt + AVATAR_SYNC_GAP_MS,
    repeat || s.failures > 0 ? s.notBefore : 0,
    quietUntil,
  );
  return { sync: s, send, sendInMs: Math.max(AVATAR_SYNC_DEBOUNCE_MS, earliest - now) };
}

/** Отметка «запрос ушёл». */
export function startAvatarSync(sync: AvatarSync, now: number): AvatarSync {
  return { ...sync, inFlight: true, lastSentAt: now };
}

export type AvatarSyncResult =
  | { ok: true; paint: string | null; id: string | null }
  /** refused — этот рисунок сервер не примет (скрыт, не годится, не влез, место кончилось). */
  | { ok: false; paint: string | null; refused: true }
  | { ok: false; retryAfterSec?: number };

/**
 * Состояние после ответа. Сбой человеку не показываем (это подсказка друзьям,
 * а не его голос) — повторим позже: по нарастающей паузе или по retryAfterSec,
 * если она длиннее. Сервер снова принял то же, а атрибут так и не пришёл — паузы
 * тоже растут: по кругу не шлём. Отказ в рисунке запоминаем: дальше цель — «без
 * рисунка» (planAvatarSync снимет атрибут), пока рисунок не сменят.
 */
export function afterAvatarSync(sync: AvatarSync, result: AvatarSyncResult, now: number): AvatarSync {
  if (!result.ok && "refused" in result && result.paint !== null) {
    return { ...sync, inFlight: false, failures: 0, notBefore: 0, refused: result.paint };
  }
  if (!result.ok) {
    const failures = sync.failures + 1;
    const wait = Math.max(backoffMs(failures), ("retryAfterSec" in result ? (result.retryAfterSec ?? 0) : 0) * 1000);
    return { ...sync, inFlight: false, failures, notBefore: now + wait };
  }
  const again = sync.accepted !== null && sync.accepted.paint === result.paint && sync.accepted.id === result.id;
  const failures = again ? sync.failures + 1 : 0;
  return {
    ...sync,
    inFlight: false,
    failures,
    notBefore: now + (again ? backoffMs(failures) : AVATAR_SYNC_CONFIRM_MS),
    accepted: { paint: result.paint, id: result.id },
  };
}
