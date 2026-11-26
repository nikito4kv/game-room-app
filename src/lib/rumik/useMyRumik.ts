"use client";

import { useSyncExternalStore } from "react";
import { getRumikStore, subscribeRumik, type RumikStore } from "./storage";

const EMPTY_STORE: RumikStore = { v: 1, paint: null, updatedAt: 0, gallery: [] };
const serverSnapshot = () => EMPTY_STORE;
const getPaint = () => getRumikStore().paint;
const noPaint = () => null;

/**
 * Свой Румик из хранилища браузера, живой: перерисовывается, когда рисунок
 * или «Мои Румики» поменяли здесь или в соседней вкладке. На сервере и до
 * гидрации — белый (paint: null), поэтому разметка с сервера и первая
 * отрисовка совпадают. Галерея нужна только рисовалке; остальным — useMyPaint.
 */
export function useRumikStore(): RumikStore {
  return useSyncExternalStore(subscribeRumik, getRumikStore, serverSnapshot);
}

/**
 * Текущий рисунок (PNG data URL) или null — белый Румик. Снимок — сама строка,
 * поэтому компонент перерисовывается только при смене рисунка, а не галереи:
 * его зовёт каждое место за столом.
 */
export function useMyPaint(): string | null {
  return useSyncExternalStore(subscribeRumik, getPaint, noPaint);
}
