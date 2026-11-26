"use client";

import { useEffect, useRef } from "react";

/**
 * Держит ref в синхроне со свежим значением — чтобы window-обработчики читали
 * актуальное состояние, не пересоздаваясь на каждое изменение.
 */
export function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
