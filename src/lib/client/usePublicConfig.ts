"use client";

// Настройки сайта (GET /api/config) для компонентов: один запрос на место (сайт
// или комната CODE), сколько бы компонентов ни подписалось. Опрос раз в 60 с,
// пока вкладка видна, и сразу при возврате на вкладку. Пока ответа нет или сервер
// недоступен — null у config (компоненты ведут себя как обычно).
import { useCallback, useSyncExternalStore } from "react";
import type { PublicConfigResponse } from "@/lib/api/platform";
import { getPublicConfig } from "./api";
import { parsePublicConfig } from "./publicConfig";

export const CONFIG_POLL_MS = 60_000;
/** Вернулись на вкладку — обновляем, если прошлый ответ старше этого. */
const REVISIT_MS = 10_000;

type Entry = {
  value: PublicConfigResponse | null;
  listeners: Set<() => void>;
  timer: number | null;
  loadedAt: number;
  inflight: AbortController | null;
  onVisible: (() => void) | null;
};

const entries = new Map<string, Entry>();

function entryFor(key: string): Entry {
  let e = entries.get(key);
  if (!e) {
    e = { value: null, listeners: new Set(), timer: null, loadedAt: 0, inflight: null, onVisible: null };
    entries.set(key, e);
  }
  return e;
}

function load(key: string, e: Entry) {
  if (e.inflight) return;
  const ctrl = new AbortController();
  e.inflight = ctrl;
  e.loadedAt = Date.now();
  getPublicConfig(key || undefined, ctrl.signal).then(
    (raw) => {
      e.inflight = null;
      const next = parsePublicConfig(raw);
      // Ничего не поменялось — прежний объект: иначе раз в минуту (опрос)
      // перерисовывалось бы всё, что читает настройки, — например, каждое место за столом.
      if (e.value && JSON.stringify(e.value) === JSON.stringify(next)) return;
      e.value = next;
      e.listeners.forEach((l) => l());
    },
    () => {
      // Сеть, сервер — оставляем прежнее значение; следующий опрос попробует снова.
      e.inflight = null;
    },
  );
}

function start(key: string, e: Entry) {
  load(key, e);
  e.timer = window.setInterval(() => {
    if (document.visibilityState === "visible") load(key, e);
  }, CONFIG_POLL_MS);
  e.onVisible = () => {
    if (document.visibilityState === "visible" && Date.now() - e.loadedAt > REVISIT_MS) load(key, e);
  };
  document.addEventListener("visibilitychange", e.onVisible);
}

function stop(e: Entry) {
  if (e.timer !== null) window.clearInterval(e.timer);
  e.timer = null;
  if (e.onVisible) document.removeEventListener("visibilitychange", e.onVisible);
  e.onVisible = null;
  e.inflight?.abort();
  e.inflight = null;
}

function subscribe(key: string, listener: () => void): () => void {
  const e = entryFor(key);
  e.listeners.add(listener);
  if (e.listeners.size === 1) start(key, e);
  return () => {
    e.listeners.delete(listener);
    if (e.listeners.size === 0) stop(e);
  };
}

const serverSnapshot = () => null;

/**
 * Настройки для сайта (room не задан) или для комнаты (флаги посчитаны для её
 * кода, объявления — «в комнате»). null — ещё не пришли или недоступны.
 */
export function usePublicConfig(room?: string): PublicConfigResponse | null {
  const key = room ?? "";
  // Подписка стабильна для места: иначе React переподписывался бы на каждый рендер
  // и каждый раз заново спрашивал сервер.
  const sub = useCallback((l: () => void) => subscribe(key, l), [key]);
  const snap = useCallback(() => entryFor(key).value, [key]);
  return useSyncExternalStore(sub, snap, serverSnapshot);
}
