"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playSfx } from "@/lib/audio/sfx";
import { isTypingTarget } from "@/lib/room/hotkeys";
import { bindsPref } from "../state/prefs";
import { useLatestRef } from "../state/useLatestRef";
import { usePersistentState } from "../state/usePersistentState";
import { pttReleasePref } from "./voicePrefs";

/** Что держит рацию: клавиша или палец на кнопке микрофона (сенсорный экран). */
type PttSource = "key" | "pointer";

export type PushToTalk = {
  /** Эфир открыт: держат клавишу или кнопку (вместе с задержкой отпускания). */
  held: boolean;
  /**
   * Кнопку микрофона нажали (true) / отпустили (false) — для сенсорного экрана,
   * где клавиши нет. Складывается с клавишей: эфир идёт, пока держат хоть что-то.
   * Пока рация не active — ничего не делает. Ссылка стабильная.
   */
  hold: (down: boolean) => void;
};

/**
 * Рация (push-to-talk): зажата ли клавиша — с задержкой отпускания, чтобы не
 * съедать конец последнего слова. Сам трек здесь не трогаем: MicProvider
 * считает, идёт ли звук в эфир (shouldTransmit), и только тогда снимает mute.
 * Поэтому рация не может «открыть» микрофон в обход общего правила — прежняя
 * ошибка (микрофон в эфире после авто-включения рации) так невозможна.
 *
 * active — рация включена и звук разрешён (не «Звук выкл», не заглушён хостом).
 * Пока не active, клавиши не слушаем вовсе.
 *
 * Работает, только пока вкладка в фокусе: в игре браузер клавиш не слышит —
 * это честно сказано в настройках.
 */
export function usePushToTalk(active: boolean): PushToTalk {
  const [binds] = usePersistentState(bindsPref);
  const [releaseMs] = usePersistentState(pttReleasePref);
  const [held, setHeld] = useState(false);
  const bindsRef = useLatestRef(binds);
  const releaseMsRef = useLatestRef(releaseMs);
  // Нажатие пальцем приходит из дока, а состояние рации живёт в эффекте ниже:
  // эффект кладёт сюда свой обработчик, пока рация активна.
  const holdRef = useRef<((down: boolean) => void) | null>(null);

  useEffect(() => {
    if (!active) return;
    const pressed: Record<PttSource, boolean> = { key: false, pointer: false };
    let talking = false;
    let releaseTimer: ReturnType<typeof setTimeout> | null = null;

    const cancelRelease = () => {
      if (releaseTimer) clearTimeout(releaseTimer);
      releaseTimer = null;
    };
    const stopTalking = (withSound: boolean) => {
      cancelRelease();
      if (!talking) return;
      talking = false;
      setHeld(false);
      if (withSound) playSfx("mic-off");
    };
    const press = (source: PttSource) => {
      if (pressed[source]) return; // автоповтор зажатой клавиши, второй pointerdown
      pressed[source] = true;
      cancelRelease(); // нажали снова во время задержки — эфир не прерывается
      if (talking) return;
      talking = true;
      setHeld(true);
      playSfx("mic-on");
    };
    const release = (source: PttSource) => {
      if (!pressed[source]) return;
      pressed[source] = false;
      if (pressed.key || pressed.pointer) return; // второе ещё держат
      cancelRelease();
      const delay = releaseMsRef.current;
      if (delay <= 0) stopTalking(true);
      else releaseTimer = setTimeout(() => stopTalking(true), delay);
    };

    const onDown = (e: KeyboardEvent) => {
      if (e.code !== bindsRef.current.ptt) return;
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      e.preventDefault();
      if (!e.repeat) press("key");
    };
    // keyup НЕ фильтруем по полю/модификаторам — иначе отпускание над полем ввода
    // или с зажатым модификатором оставило бы эфир открытым.
    const onUp = (e: KeyboardEvent) => {
      if (e.code === bindsRef.current.ptt) release("key");
    };
    // Alt-Tab с зажатой клавишей не пришлёт keyup — закрываем эфир сразу.
    const onBlur = () => {
      pressed.key = false;
      pressed.pointer = false;
      stopTalking(false);
    };
    holdRef.current = (down) => (down ? press("pointer") : release("pointer"));
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      holdRef.current = null;
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      cancelRelease();
      // Рацию выключили, пока говорили: эфир закрыт — сбрасываем.
      setHeld(false);
    };
  }, [active, bindsRef, releaseMsRef]);

  const hold = useCallback((down: boolean) => holdRef.current?.(down), []);
  return { held: active && held, hold };
}
