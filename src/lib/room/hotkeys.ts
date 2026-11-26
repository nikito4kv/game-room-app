// Чистая логика горячих клавиш комнаты: какое действие висит на клавише и когда
// клавишу не перехватывать. Сам диспетчер (слушатели window) — в
// src/app/room/[code]/input/useHotkeys.ts и audio/usePushToTalk.ts.
import type { KeyAction, Keybinds } from "@/lib/clientStorage";

/** Курсор в поле ввода — горячие клавиши не перехватываем (человек печатает текст). */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.isContentEditable)
  );
}

/**
 * Действие, привязанное к физической клавише (KeyboardEvent.code), или undefined.
 * Коды в привязках уникальны (их санирует getKeybinds), поэтому совпадение одно.
 */
export function actionForKey(binds: Keybinds, code: string): KeyAction | undefined {
  return (Object.keys(binds) as KeyAction[]).find((a) => binds[a] === code);
}

/**
 * Enter и Space браузер сам превращает в «нажатие» сфокусированной кнопки. Если
 * чат висит на такой клавише, то при фокусе на кнопке её не перехватываем —
 * иначе одно нажатие сработает дважды (кнопка + открытие чата).
 */
export function isNativeActivationKey(code: string): boolean {
  return code === "Enter" || code === "Space";
}
