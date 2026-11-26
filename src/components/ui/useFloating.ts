"use client";

// Общие хуки всплывающих элементов. Всё рисуется в top layer браузера
// (атрибут popover="manual" + showPopover): поверх модальных диалогов, без
// z-index и без порталов — элемент остаётся в своём месте DOM, поэтому
// наследует тему и [data-ui]. Закрытие по клику мимо и Esc делаем сами:
// так управление остаётся у React-состояния и нет гонок с кнопкой-триггером.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { computeFloatingPosition, type Align, type Rect, type Side } from "./floating";

export type FloatingAnchor = RefObject<HTMLElement | null> | Rect;

export function isRef(a: FloatingAnchor): a is RefObject<HTMLElement | null> {
  return typeof a === "object" && a !== null && "current" in a;
}

export function anchorRect(a: FloatingAnchor): Rect | null {
  if (!isRef(a)) return a;
  const el = a.current;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

function supportsPopover(el: HTMLElement): boolean {
  return typeof el.showPopover === "function";
}

/** Показать/спрятать элемент в top layer синхронно с `open`. */
export function useTopLayer(open: boolean, ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!supportsPopover(el)) {
      // Старый браузер: просто показываем элемент поверх (position: fixed).
      el.style.display = open ? "block" : "none";
      return;
    }
    const shown = el.matches(":popover-open");
    if (open && !shown) el.showPopover();
    if (!open && shown) el.hidePopover();
  }, [open, ref]);
}

/**
 * Ставит плавающий элемент возле якоря, пока open: пишет left/top прямо в
 * style (без перерисовок React), переворачивается у краёв окна и
 * выставляет transform-origin в точку якоря — появление «растёт» из него.
 * Пересчёт — только пока открыт: на resize, прокрутке и смене размера.
 */
export function usePlaceFloating(
  open: boolean,
  floatingRef: RefObject<HTMLElement | null>,
  anchor: FloatingAnchor,
  { side = "bottom", align = "center", offset = 8, padding = 8 }: { side?: Side; align?: Align; offset?: number; padding?: number } = {},
) {
  const anchorRef = useRef(anchor);
  useLayoutEffect(() => {
    anchorRef.current = anchor;
  });
  // Точка-якорь (объект) меняется каждый рендер — сравниваем по значениям.
  const anchorKey = isRef(anchor) ? anchor : `${anchor.x}:${anchor.y}:${anchor.width}:${anchor.height}`;

  useLayoutEffect(() => {
    if (!open) return;
    const el = floatingRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const a = anchorRect(anchorRef.current);
      if (!a) return;
      // Размер без transform: на первом кадре идёт анимация появления
      // (scale 0.96), и getBoundingClientRect занизил бы высоту на 4 % —
      // панель у низа окна вылезала за край. ResizeObserver на scale не срабатывает.
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      const pos = computeFloatingPosition({
        anchor: a,
        floating: { width, height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        side,
        align,
        offset,
        padding,
      });
      el.style.left = `${pos.x}px`;
      el.style.top = `${pos.y}px`;
      el.dataset.side = pos.side;
      const ox = Math.min(Math.max(a.x + a.width / 2 - pos.x, 0), width);
      const oy = Math.min(Math.max(a.y + a.height / 2 - pos.y, 0), height);
      el.style.transformOrigin = `${Math.round(ox)}px ${Math.round(oy)}px`;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      ro.disconnect();
    };
  }, [open, floatingRef, anchorKey, side, align, offset, padding]);
}

/**
 * Закрытие по клику мимо и по Esc. Клик по самому элементу, по якорю (если
 * это элемент) и по `triggerRef` «мимо» не считается — триггер сам
 * переключит open. Esc гасим (preventDefault), чтобы не закрылся заодно
 * диалог под поповером.
 */
export function useDismiss(
  open: boolean,
  onDismiss: () => void,
  floatingRef: RefObject<HTMLElement | null>,
  anchor?: FloatingAnchor,
  triggerRef?: RefObject<HTMLElement | null>,
) {
  const cb = useRef(onDismiss);
  const anchorRef = useRef(anchor);
  useLayoutEffect(() => {
    cb.current = onDismiss;
    anchorRef.current = anchor;
  });

  useEffect(() => {
    if (!open) return;
    const isInside = (t: Node) => {
      const a = anchorRef.current;
      return (
        !!floatingRef.current?.contains(t) ||
        !!(a && isRef(a) && a.current?.contains(t)) ||
        !!triggerRef?.current?.contains(t)
      );
    };
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && isInside(t)) return;
      cb.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cb.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, floatingRef, triggerRef]);
}

const FOCUSABLE =
  'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function firstFocusable(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(FOCUSABLE);
}

/**
 * Фокус внутрь при открытии и обратно — при закрытии (если фокус был
 * внутри или «потерялся» на body). Возвращаем туда, откуда открыли.
 *
 * Закрытие (open → false) возвращает фокус в теле layout-эффекта, а не в его
 * очистке. Очистка при обновлении идёт в фазе мутаций, а сразу после неё React
 * восстанавливает фокус, бывший до коммита (restoreSelection), — обратно в
 * панель; панель тут же прячется, и фокус падал на body. Вызывающий ставит
 * useTopLayer раньше этого хука: к возврату панель уже спрятана.
 *
 * Возврат срабатывает и тогда, когда элемент просто убрали со страницы
 * (`{open && <Panel/>}`): очистка при размонтировании идёт до удаления узлов,
 * фокус ещё внутри, а прежний фокус уже не в документе — React его не тронет.
 */
export function useFocusOnOpen(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  mode: "first" | "container" | "none",
): FocusReturn {
  const returnTo = useRef<HTMLElement | null>(null);
  const shownIn = useRef<HTMLElement | null>(null);
  const returning = useRef(false);

  const giveBack = useCallback(() => {
    const back = returnTo.current;
    const el = shownIn.current;
    returnTo.current = null;
    shownIn.current = null;
    if (!back?.isConnected) return;
    const active = document.activeElement;
    const lost = !active || active === document.body || !!el?.contains(active);
    if (!lost) return;
    // focusout отсюда — наш собственный возврат (в том числе от двойного
    // запуска эффектов StrictMode в деве), а не уход человека наружу.
    returning.current = true;
    try {
      back.focus({ preventScroll: true });
    } finally {
      returning.current = false;
    }
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    // Откуда открыли — запоминаем один раз: повторный запуск при открытой
    // панели (смена mode) не должен записать сюда её собственную кнопку.
    if (!returnTo.current) returnTo.current = document.activeElement as HTMLElement | null;
    shownIn.current = el;
    if (mode === "first") (firstFocusable(el) ?? el).focus({ preventScroll: true });
    else if (mode === "container") el.focus({ preventScroll: true });
  }, [open, ref, mode]);

  // Закрыли — вернуть фокус (см. выше, почему не в очистке).
  useLayoutEffect(() => {
    if (!open) giveBack();
  }, [open, giveBack]);

  // Убрали со страницы открытым.
  useLayoutEffect(() => giveBack, [giveBack]);

  const release = useCallback(() => {
    returnTo.current = null;
  }, []);
  return useMemo(() => ({ release, returning }), [release]);
}

export type FocusReturn = {
  /** Не возвращать фокус при закрытии: человек сам увёл его наружу (Tab), тянуть обратно нельзя. */
  release: () => void;
  /** true, пока хук сам возвращает фокус: такой focusout — не уход человека. */
  returning: RefObject<boolean>;
};

/**
 * Снимают со всплывающего элемента позиционирование popover по умолчанию
 * (браузер центрирует его на экране). Фон, отступы и цвет текста элемент
 * задаёт сам — здесь их нет, чтобы утилиты не спорили между собой.
 */
export const FLOATING_RESET = "fixed inset-auto m-0 overflow-visible border-0";
