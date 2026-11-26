"use client";

import { useSyncExternalStore } from "react";

// Свой рисунок, в котором сервер отказал (скрыт администрацией, не влез, место
// кончилось). Его ведёт AvatarSync, читает useAvatarPaint у своего места: вместо
// рисунка из браузера там тогда то, что видят другие, — последний принятый
// сервером рисунок или Румик своего цвета без рисунка. Маленький стор, а не
// контекст: AvatarSync стоит рядом с деревом комнаты, а не над ним.

let refused: string | null = null;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

const snapshot = () => refused;
const serverSnapshot = () => null;

/** Запомнить отказ (null — отказа нет). Зовёт только AvatarSync. */
export function setRefusedPaint(paint: string | null): void {
  if (paint === refused) return;
  refused = paint;
  listeners.forEach((l) => l());
}

/** Свой рисунок, в котором отказал сервер, или null. Меняется редко: только на отказ. */
export function useRefusedPaint(): string | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
