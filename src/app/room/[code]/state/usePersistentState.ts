"use client";

import { useSyncExternalStore } from "react";

/**
 * Настройка «для себя» из localStorage, общая для всех компонентов комнаты.
 *
 * Раньше каждая такая настройка была отдельным useState + эффектом «прочитать
 * после монтирования» + записью в сеттере, а значение пропсами раздавал один
 * владелец. Теперь ключ описывается один раз (persistentKey), и любой компонент
 * берёт его через usePersistentState — все видят одно и то же значение, и новую
 * настройку можно завести в своей области, не трогая чужие файлы.
 *
 * На сервере и при гидратации — initial (localStorage там нет), на клиенте —
 * сохранённое значение. Запись идёт сразу в память (подписчики перерисуются) и в
 * localStorage. Пока ключ никто не читает, память сброшена: следующий вход в
 * комнату перечитает хранилище, как раньше это делал эффект при монтировании.
 */
export type PersistentKey<T> = {
  /** Значение для сервера и первого кадра гидратации. */
  readonly initial: T;
  /** Текущее значение вне React — для колбэков, которые живут дольше рендера. */
  get(): T;
  /** Записать: память + localStorage (если задан write) + уведомить подписчиков. */
  set(next: T | ((prev: T) => T)): void;
  subscribe(onChange: () => void): () => void;
};

export function persistentKey<T>(opts: {
  read: () => T;
  /** Не задан — значение в хранилище пишет вызывающий код сам (например, поштучно в карту). */
  write?: (value: T) => void;
  initial: T;
}): PersistentKey<T> {
  let cache: { value: T } | null = null;
  const listeners = new Set<() => void>();
  const get = (): T => (cache ??= { value: opts.read() }).value;
  return {
    initial: opts.initial,
    get,
    set(next) {
      const value = typeof next === "function" ? (next as (prev: T) => T)(get()) : next;
      cache = { value };
      opts.write?.(value);
      listeners.forEach((l) => l());
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0) cache = null;
      };
    },
  };
}

/** [значение, записать] для ключа из persistentKey. Сеттер стабилен — его можно не класть в deps. */
export function usePersistentState<T>(key: PersistentKey<T>): [T, PersistentKey<T>["set"]] {
  const value = useSyncExternalStore(key.subscribe, key.get, () => key.initial);
  return [value, key.set];
}
