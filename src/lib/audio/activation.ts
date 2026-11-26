// Жест пользователя на странице. Пока его не было, браузер не запускает звук:
// AudioContext стоит на паузе, и обработка микрофона выдала бы в эфир тишину
// (аудит 1-audio, 3.4 — вход по ссылке без единого клика).
import { peekPlaybackContext } from "./playback";

type UserActivation = { hasBeenActive: boolean };

/** Был ли клик или клавиша на странице (sticky activation). */
export function hasUserActivation(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = (navigator as Navigator & { userActivation?: UserActivation }).userActivation;
  if (ua) return ua.hasBeenActive;
  // Браузер без navigator.userActivation: раз общий контекст запустился — звук разрешён.
  return peekPlaybackContext()?.state === "running";
}

/**
 * Позвать cb один раз после первого жеста (или сразу, если он уже был).
 * Возвращает отписку.
 */
export function onUserActivation(cb: () => void): () => void {
  if (hasUserActivation()) {
    cb();
    return () => {};
  }
  let done = false;
  const stop = () => {
    window.removeEventListener("pointerdown", onInput, true);
    window.removeEventListener("keydown", onInput, true);
  };
  // Проверяем после события: Esc и сочетания с клавишами браузера жестом не считаются.
  const onInput = () =>
    setTimeout(() => {
      if (done || !hasUserActivation()) return;
      done = true;
      stop();
      cb();
    }, 0);
  window.addEventListener("pointerdown", onInput, true);
  window.addEventListener("keydown", onInput, true);
  return () => {
    done = true;
    stop();
  };
}
