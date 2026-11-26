/**
 * Общий AudioContext воспроизведения — один на вкладку. Через него звучит всё:
 *  • голоса и звук демонстраций (LiveKit webAudioMix, см. buildRoomOptions);
 *  • звуки интерфейса (sfx.ts);
 *  • «Слышать себя» (micTest.ts).
 * Один контекст — один аудиопоток браузера вместо трёх и одно место, где
 * выбирается устройство вывода: setSinkId сразу переводит всё (аудит 1-audio,
 * 3.7 — писки интерфейса и «слышать себя» шли в колонки мимо наушников).
 *
 * Контекст живёт, пока жива вкладка: переданный контекст LiveKit при выходе не
 * закрывает (закрывает только свой), поэтому звук «выход» доигрывает после ухода.
 */
import type { Room } from "livekit-client";
import { resolveOutputSinkId } from "./devices";

/** setSinkId у AudioContext есть в Chrome/Edge 110+, но ещё не в типах TypeScript. */
type SinkContext = AudioContext & { setSinkId(sinkId: string): Promise<void> };

let ctx: AudioContext | null = null;
/** Что реально стоит у контекста (для повторного применения «как в системе»). */
let appliedSinkId: string | null = null;

/** Контекст воспроизведения; на сервере и без Web Audio — null. */
export function getPlaybackContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx && ctx.state !== "closed") return ctx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor({ latencyHint: "interactive" });
  } catch {
    return null;
  }
  appliedSinkId = null;
  return ctx;
}

/** Контекст, если он уже создан, — без создания (для проверок без побочных эффектов). */
export function peekPlaybackContext(): AudioContext | null {
  return ctx && ctx.state !== "closed" ? ctx : null;
}

/**
 * Разбудить воспроизведение. Звать в обработчике клика («Войти», «Проверить
 * звук»): без жеста пользователя браузер держит звук выключенным.
 */
export async function resumePlayback(): Promise<void> {
  const c = getPlaybackContext();
  if (c?.state === "suspended") await c.resume().catch(() => {});
}

/**
 * Можно ли выбрать устройство вывода. Звук идёт через Web Audio, а
 * AudioContext.setSinkId есть только в Chrome/Edge 110+ — в Firefox и Safari
 * выбор показывать нельзя: он бы молча не работал (аудит 1-audio, 3.6).
 */
export function outputSelectionSupported(): boolean {
  return typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;
}

/**
 * Переключить вывод. Бросает, если устройство недоступно (и тогда ничего не
 * меняется) — вызывающий откатывает выбор и не сохраняет его.
 *
 * room — комната LiveKit, если она есть: ей сообщаем выбор, чтобы её
 * собственная реакция на подключение устройств не «вернула» вывод на системный,
 * и ставим тот же вывод скрытым <audio>-элементам приёма — без этого Chrome не
 * подавляет эхо при выводе не на устройство по умолчанию
 * (issues.chromium.org/40252911#comment7, так делает и сам LiveKit).
 */
export async function switchOutput(deviceId: string, room?: Room): Promise<void> {
  const c = getPlaybackContext();
  if (!c || !outputSelectionSupported()) {
    throw new Error("Браузер не умеет выбирать устройство вывода");
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const sinkId = resolveOutputSinkId(deviceId, devices);
  if (sinkId !== appliedSinkId) {
    await (c as SinkContext).setSinkId(sinkId);
    appliedSinkId = sinkId;
  }
  if (!room) return;
  room.options.audioOutput = { deviceId };
  room.localParticipant.activeDeviceMap.set("audiooutput", deviceId);
  await Promise.all(
    [...room.remoteParticipants.values()].map((p) => p.setAudioOutput({ deviceId }).catch(() => {})),
  );
}
