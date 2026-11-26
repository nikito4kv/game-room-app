// Человекочитаемые подписи физических клавиш (KeyboardEvent.code).
// Используем e.code, а не e.key, чтобы привязки работали на любой раскладке —
// но показывать пользователю «KeyM» нельзя, поэтому приводим к короткой подписи.

import type { KeyAction } from "@/lib/clientStorage";

/**
 * Единый источник правды для названий действий-биндов. Используется и в настройках
 * (список привязок), и в подсказках кнопок дока — чтобы подписи не расходились.
 */
export const ACTION_LABELS: Record<KeyAction, string> = {
  mic: "Микрофон вкл/выкл",
  deafen: "Звук вкл/выкл",
  screen: "Показ экрана",
  chat: "Открыть чат",
  ptt: "Рация (держать)",
};

/**
 * Клавиши, которые нельзя назначить: у них уже есть дело. Esc и Tab нужны
 * окнам и переходу по кнопкам; F, «+», «−» и «0» — полный экран и зум
 * показа экрана (stage/ ловит их, пока сцена на экране). Ctrl, Alt и Win
 * горячие клавиши комнаты не принимают: так не перехватываются сочетания
 * браузера (Ctrl+S, Alt+Tab).
 */
const RESERVED_KEYS: Record<string, string> = {
  Escape: "Esc закрывает окна и отменяет ввод",
  Tab: "Tab переводит фокус между кнопками",
  KeyF: "F разворачивает показ экрана на весь экран",
  Equal: "«+» приближает показ экрана",
  NumpadAdd: "«+» приближает показ экрана",
  Minus: "«−» отдаляет показ экрана",
  NumpadSubtract: "«−» отдаляет показ экрана",
  Digit0: "«0» сбрасывает зум показа",
  Numpad0: "«0» сбрасывает зум показа",
};

/** Почему клавишу нельзя назначить, или null — можно. */
export function reservedKeyReason(code: string): string | null {
  if (/^(Control|Alt|Meta|OS)(Left|Right)?$/.test(code)) return "Ctrl, Alt и Win не подходят — выберите другую клавишу";
  return RESERVED_KEYS[code] ?? null;
}

const ARROWS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

const NAMED: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Escape: "Esc",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Tab: "Tab",
  Backspace: "⌫",
  Delete: "Del",
  Insert: "Ins",
  Home: "Home",
  End: "End",
  PageUp: "PgUp",
  PageDown: "PgDn",
  CapsLock: "Caps",
};

/**
 * Превращает KeyboardEvent.code в короткую подпись для UI/оверлея/тултипов.
 * Неизвестные коды возвращаются как есть — функция никогда не падает.
 */
export function formatKeyCode(code: string): string {
  if (!code) return "";
  // Буквы: KeyM → M
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  // Цифры верхнего ряда: Digit2 → 2
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  // Цифровой блок: Numpad5 → Num 5
  if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
  // Функциональные: F1…F12 — как есть
  if (/^F([1-9]|1[0-2])$/.test(code)) return code;
  if (code in ARROWS) return ARROWS[code];
  if (code in NAMED) return NAMED[code];
  // Модификаторы: ShiftLeft/ShiftRight → Shift и т.п.
  const mod = code.match(/^(Shift|Control|Alt|Meta)(Left|Right)$/);
  if (mod) return mod[1] === "Control" ? "Ctrl" : mod[1];
  return code;
}
