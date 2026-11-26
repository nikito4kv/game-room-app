import type { Ref, RefCallback } from "react";

/** Один ref-колбэк, который раздаёт элемент сразу в несколько ref. */
export function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return (value) => {
    for (const r of refs) {
      if (typeof r === "function") r(value);
      else if (r) r.current = value;
    }
  };
}
