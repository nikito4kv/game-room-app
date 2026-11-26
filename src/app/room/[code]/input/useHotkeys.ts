"use client";

import { useEffect } from "react";
import type { KeyAction } from "@/lib/clientStorage";
import { actionForKey, isNativeActivationKey, isTypingTarget } from "@/lib/room/hotkeys";
import { bindsPref } from "../state/prefs";
import { useRoomActions } from "../state/RoomActions";
import { useLatestRef } from "../state/useLatestRef";
import { usePersistentState } from "../state/usePersistentState";

/**
 * Горячие клавиши — десктоп-аналог «button prompt». Действия те же, что у дока
 * (useRoomActions). Привязки настраиваются и читаются через ref, поэтому
 * слушатель не пересоздаётся при смене бинда. Берём e.code (физическая клавиша) —
 * работает на любой раскладке; не перехватываем при вводе в поля. Рация (ptt) —
 * своя пара keydown/keyup в usePushToTalk, здесь её действие пропускаем.
 *
 * Клавиши просмотра показа экрана (F, зум) ловит сцена (stage/) и только если
 * код не назначен здесь; назначить их сюда нельзя (reservedKeyReason в
 * @/lib/keys) — так одно нажатие не делает двух дел.
 */
export function useHotkeys(): void {
  const { toggleMic, toggleDeafen, toggleScreenShare, openChat } = useRoomActions();
  const [binds] = usePersistentState(bindsPref);
  const bindsRef = useLatestRef(binds);

  useEffect(() => {
    // Декларативный маппинг действие→хендлер: новое действие = одна строка здесь.
    // chat и ptt — со своей логикой (фокус-гард / удержание), обрабатываются отдельно.
    const handlers: Partial<Record<KeyAction, () => void>> = {
      // В режиме рации M включает/выключает саму рацию (см. MicProvider).
      mic: toggleMic,
      deafen: toggleDeafen,
      screen: toggleScreenShare,
    };
    const onKey = (e: KeyboardEvent) => {
      // Зажатая клавиша шлёт автоповтор — иначе M переключала бы микрофон десятки раз.
      if (e.repeat || e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const b = bindsRef.current;
      const action = actionForKey(b, e.code);
      if (!action || action === "ptt") return; // рация — своя пара keydown/keyup
      if (action === "chat") {
        // Enter/Space НАТИВНО активируют сфокусированный контрол (кнопку дока,
        // кружок-участника с role="button") — для них не перехватываем, чтобы не
        // дублировать действие. Прочие бинды чата открывают чат при любом фокусе.
        // tabindex="-1" — не контрол, а цель фокуса (зона комнаты после входа):
        // с неё Enter открывает чат.
        if (isNativeActivationKey(b.chat)) {
          const el = e.target as HTMLElement | null;
          if (el && el.closest('button, a, [role="button"], [tabindex]:not([tabindex="-1"])')) return;
        }
        e.preventDefault();
        openChat();
        return;
      }
      const handler = handlers[action];
      if (handler) {
        e.preventDefault();
        handler();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMic, toggleDeafen, toggleScreenShare, openChat, bindsRef]);
}
