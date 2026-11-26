"use client";

import { useSyncExternalStore } from "react";

// Открыт ли диалог «Настройки комнаты». Открывают его из меню названия в шапке,
// а рисует HostDialogs — без общего провайдера и проброса пропсов. Одно окно
// на страницу, поэтому хватает значения в модуле.
let open = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (open === next) return;
  open = next;
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function openRoomSettings(): void {
  set(true);
}

export function closeRoomSettings(): void {
  set(false);
}

export function useRoomSettingsOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => false);
}
