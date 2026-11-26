"use client";

import { useSyncExternalStore } from "react";

// «Установить приложение» (PWA, флаг pwa). Chrome и Edge присылают
// beforeinstallprompt, когда сайт можно поставить; событие приходит один раз,
// поэтому ловим его на уровне модуля — до того, как появится кнопка. Safari его
// не шлёт: там ставят через «Поделиться → На экран Домой», кнопки нет.

type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Своя кнопка вместо мини-плашки браузера.
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
const canInstallNow = () => deferred !== null;
const never = () => false;

/** Можно ли сейчас предложить установку (браузер прислал приглашение). */
export function useCanInstall(): boolean {
  return useSyncExternalStore(subscribe, canInstallNow, never);
}

/** Показать окно установки браузера. Звать из клика. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const e = deferred;
  if (!e) return "unavailable";
  // Приглашение одноразовое: после ответа браузер пришлёт новое, если снова можно.
  deferred = null;
  emit();
  await e.prompt();
  return (await e.userChoice).outcome;
}
