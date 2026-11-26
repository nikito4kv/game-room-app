"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/** Document Picture-in-Picture (Chrome/Edge 116+); в типах DOM его ещё нет. */
type DocumentPip = {
  window: Window | null;
  requestWindow(options: { width: number; height: number }): Promise<Window>;
};

function documentPip(): DocumentPip | null {
  return (window as Window & { documentPictureInPicture?: DocumentPip }).documentPictureInPicture ?? null;
}

const noSubscribe = () => () => {};

/** Размер мини-комнаты по умолчанию (дизайн: 360×184). */
const SIZE = { width: 360, height: 184 };

/**
 * Окно Document PiP получает пустой документ: переносим в него стили сайта
 * (иначе ни токенов, ни шрифтов), атрибуты <html> (переменные шрифтов next/font,
 * тема) и <base> — чтобы относительные адреса шрифтов в стилях работали.
 */
function prepareDocument(doc: Document, title: string): void {
  doc.title = title;
  const base = doc.createElement("base");
  base.href = window.location.href;
  doc.head.append(base);
  for (const attr of Array.from(document.documentElement.attributes)) {
    doc.documentElement.setAttribute(attr.name, attr.value);
  }
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = doc.createElement("style");
      style.textContent = Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
      doc.head.append(style);
    } catch {
      // Чужой домен не даёт читать правила — подключаем ссылкой.
      if (!sheet.href) continue;
      const link = doc.createElement("link");
      link.rel = "stylesheet";
      link.href = sheet.href;
      doc.head.append(link);
    }
  }
  doc.body.style.margin = "0";
}

export type PipWindow = {
  /** Браузер умеет Document PiP. Нет — ни кнопки, ни пункта меню. */
  supported: boolean;
  /** Открытое окно (в него рисуем порталом) или null. */
  window: Window | null;
  /** Открыть мини-комнату. Только из жеста пользователя (клик). */
  open: () => void;
  close: () => void;
};

/**
 * Мини-комната поверх игры: окно Document PiP, в которое RoomView рисует
 * порталом. Закрывается крестиком окна (событие pagehide), кнопкой «Вернуться»
 * и при выходе из комнаты.
 */
export function usePipWindow(title: string): PipWindow {
  const supported = useSyncExternalStore(noSubscribe, () => documentPip() !== null, () => false);
  const [win, setWin] = useState<Window | null>(null);

  const open = useCallback(() => {
    const api = documentPip();
    if (!api) return;
    if (api.window) {
      api.window.focus();
      return;
    }
    void api
      .requestWindow(SIZE)
      .then((pip) => {
        prepareDocument(pip.document, title);
        pip.addEventListener("pagehide", () => setWin(null), { once: true });
        setWin(pip);
      })
      .catch(() => {
        // Нет жеста или окно уже открыто другой вкладкой — молча.
      });
  }, [title]);

  const close = useCallback(() => win?.close(), [win]);

  // Вышли из комнаты (RoomView размонтирован) — окно поверх игры не оставляем.
  useEffect(() => {
    if (!win) return;
    return () => win.close();
  }, [win]);

  return { supported, window: win, open, close };
}
