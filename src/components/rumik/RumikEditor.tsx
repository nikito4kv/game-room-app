"use client";

import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/components/ui/cn";
import { IconButton } from "@/components/ui/IconButton";
import { Icon } from "@/components/ui/icons";
import { nextIndex, rovingKey } from "@/components/ui/roving";
import { Rumik } from "@/components/ui/Rumik";
import { Slider } from "@/components/ui/Slider";
import { TextField } from "@/components/ui/TextField";
import { Tooltip } from "@/components/ui/Tooltip";
import { formatKeyCode } from "@/lib/keys";
import { AXIS_X, EYE, PLATE } from "@/lib/rumik/geometry";
import {
  BRUSH_DEFAULT,
  BRUSH_MAX,
  BRUSH_MIN,
  PaintEngine,
  STAGE,
  UPLOAD_ERROR,
  checkPaintUpload,
  composeFigure,
  decodeImage,
  parseHex,
  samePicture,
  stageToWorld,
  type FigureInk,
  type Point,
  type StepKind,
} from "@/lib/rumik/paint";
import { DEFAULT_PAINT_COLOR, PAINT_PALETTE, snapToPalette } from "@/lib/rumik/palette";
import {
  forgetSaved,
  getRumikStore,
  saveMyPaint,
  unforgetSaved,
  updateMyPaint,
  type SavedRumik,
} from "@/lib/rumik/storage";
import { useRumikStore } from "@/lib/rumik/useMyRumik";
import { editorOwnsKey } from "./editorKeys";
import {
  EDITOR_LAYOUT,
  EditorGrid,
  FigureRug,
  GALLERY_CROSS,
  GALLERY_CROSS_SPOT,
  GALLERY_LIST,
  GALLERY_THUMB,
  PANEL_CARD,
  PANEL_TITLE,
  PICKER,
  STORAGE_NOTE,
  SWATCH,
  SWATCH_CHECKED,
  SWATCH_EDGE,
  ToolbarItems,
  VIEW_IN_STAGE,
  type EditorVariant,
} from "./editorLayout";

// Рисовалка своего Румика (R2). Рисуют на стоящем Румике: кисть, ластик,
// заливка части, пипетка, зеркало, назад/вперёд, «стереть всё»; файл PNG можно
// сохранить и загрузить. Рисунок сам ложится в хранилище браузера в конце
// каждого действия (storage.ts), прошлые — в «Мои Румики» под фигурой.
//
// Движок (слой краски, история, маски частей) — src/lib/rumik/paint.ts. Здесь
// только экран: холст с фигурой, лицо поверх, панели. Код тяжёлый, поэтому на
// страницы он приезжает лениво — через LazyRumikEditor.

/** События для аналитики: зовёт страница (место — главная или лобби — знает она). */
export type RumikEditorEvent = "paint_started" | "file_saved" | "file_loaded";

export type RumikEditorProps = {
  /** hero — крупно, для главной; dialog — компактно, для окна. */
  variant?: EditorVariant;
  /** Своё под панелью цвета: например, кнопка «Открытка». */
  actions?: ReactNode;
  onEvent?: (event: RumikEditorEvent) => void;
  className?: string;
};

type Tool = "brush" | "eraser" | "fill" | "pipette";
type Status = { text: string; tone: "info" | "error" } | null;

const TOOLS = [
  { tool: "brush", icon: "brush", label: "Кисть", code: "KeyB" },
  { tool: "eraser", icon: "eraser", label: "Ластик", code: "KeyE" },
  { tool: "fill", icon: "paint-bucket", label: "Заливка части", code: "KeyG" },
  { tool: "pipette", icon: "pipette", label: "Пипетка", code: "KeyI" },
] as const;

/** Глаза следят за курсором: сдвиг до x/y (мировые единицы), в полную силу с `reach` px. */
const LOOK = { x: 5, y: 4, reach: 260 };
const EYES_CENTER: Point = [(EYE.ring.x + EYE.dot.x) / 2, (EYE.ring.y + EYE.dot.y) / 2];

const DATE = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** Сколько висит «Удалено · Вернуть» после крестика в «Моих Румиках». */
const UNDO_FORGET_MS = 6000;

/**
 * Неактивная кнопка панели остаётся в фокусе (aria-disabled, а не disabled):
 * иначе «Назад» или «Стереть всё» роняли бы фокус в никуда сразу после нажатия.
 * Наведение её не «оживляет».
 */
const UNAVAILABLE = "aria-disabled:hover:bg-transparent aria-disabled:hover:text-ink-2";

/** Есть ли среди сохранённых тот же рисунок на вид: «current» — текущий, иначе — из галереи. */
async function findTwin(engine: PaintEngine, img: CanvasImageSource): Promise<"current" | SavedRumik | null> {
  // Сравниваем пропущенное через одну и ту же обработку (растянуть, обрезать по
  // фигуре): файл из «Сохранить» и строка в хранилище тогда совпадают.
  const mine = engine.pixelsOf(img);
  const { paint, gallery } = getRumikStore();
  const candidates: { twin: "current" | SavedRumik; src: string }[] = [
    ...(paint ? [{ twin: "current" as const, src: paint }] : []),
    ...gallery.map((g) => ({ twin: g, src: g.paint })),
  ];
  for (const c of candidates) {
    const img2 = await decodeImage(c.src).catch(() => null);
    if (img2 && samePicture(mine, engine.pixelsOf(img2))) return c.twin;
  }
  return null;
}

const noop = () => () => {};
const isMacSnapshot = () => /Mac|iPhone|iPad/.test(navigator.userAgent);

function drawFigure(engine: PaintEngine | null, view: HTMLCanvasElement | null, ink: FigureInk) {
  const ctx = view?.getContext("2d");
  if (engine && ctx && ctx.canvas.width > 0) composeFigure(ctx, engine.canvas, engine.paths, ink);
}

/** Точка указателя → мировые координаты фигуры. */
function worldAt(e: { clientX: number; clientY: number }, r: DOMRect): Point {
  return stageToWorld((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function RumikEditor({ variant = "hero", actions, onEvent, className }: RumikEditorProps) {
  const layout = EDITOR_LAYOUT[variant];
  const store = useRumikStore();
  const isMac = useSyncExternalStore(noop, isMacSnapshot, () => false);
  const colorTitleId = useId();
  const galleryTitleId = useId();

  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<Tool>("brush");
  const [color, setColor] = useState(DEFAULT_PAINT_COLOR);
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [size, setSize] = useState(BRUSH_DEFAULT);
  const [mirror, setMirror] = useState(false);
  const [hist, setHist] = useState({ undo: false, redo: false });
  const [status, setStatus] = useState<Status>(null);
  const [wide, setWide] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  /** Только что убранный крестиком рисунок: его можно вернуть, пока висит «Удалено · Вернуть». */
  const [removed, setRemoved] = useState<{ saved: SavedRumik; index: number } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLCanvasElement>(null);
  const eyesRef = useRef<SVGGElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const undoForgetRef = useRef<HTMLButtonElement>(null);
  const engineRef = useRef<PaintEngine | null>(null);
  const inkRef = useRef<FigureInk>({ base: "", ink: "" });
  const rafRef = useRef(0);
  const pointerRef = useRef<number | null>(null);
  /** Что мы сами положили в хранилище (или загрузили из него): чужие изменения отличаются. */
  const writtenRef = useRef<string | null | undefined>(undefined);
  const loadSeqRef = useRef(0);
  const prevToolRef = useRef<"brush" | "fill">("brush");
  const startedRef = useRef(false);
  const visibleRef = useRef(false);

  const blank = store.paint === null;
  const mod = isMac ? "⌘" : "Ctrl+";
  const undoKey = `${mod}Z`;

  // ── Отрисовка ──────────────────────────────────────────────────────────────

  const draw = () => drawFigure(engineRef.current, viewRef.current, inkRef.current);
  const scheduleDraw = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      draw();
    });
  };
  const syncHist = () => {
    const engine = engineRef.current;
    setHist({ undo: !!engine?.canUndo, redo: !!engine?.canRedo });
  };

  /** Рисунок — в хранилище: дорисовка заменяет текущий, смена рисунка кладёт прежний в «Мои Румики». */
  const persist = (kind: StepKind) => {
    const engine = engineRef.current;
    if (!engine) return;
    const png = engine.toDataUrl();
    writtenRef.current = png;
    if (kind === "swap") saveMyPaint(png);
    else updateMyPaint(png);
  };

  const markStarted = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    onEvent?.("paint_started");
  };

  // ── Холст, тема, видимость ─────────────────────────────────────────────────

  const onWidth = useEffectEvent((width: number) => setWide(width >= layout.wideFrom));

  useEffect(() => {
    const view = viewRef.current;
    const root = rootRef.current;
    if (!view || !root) return;
    engineRef.current = new PaintEngine();
    // Цвета фигуры на холсте — из токенов (белый Румик, обводка), как у SVG.
    const readInk = () => {
      const css = getComputedStyle(root);
      inkRef.current = {
        base: css.getPropertyValue("--gr-rumik-white").trim(),
        ink: css.getPropertyValue("--gr-avatar-ink").trim(),
      };
    };
    readInk();
    const redraw = () => drawFigure(engineRef.current, viewRef.current, inkRef.current);
    const fit = () => {
      const w = view.clientWidth;
      if (!w) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const cw = Math.round(w * dpr);
      const ch = Math.round((cw * STAGE.h) / STAGE.w);
      if (view.width !== cw || view.height !== ch) {
        view.width = cw;
        view.height = ch;
      }
      redraw();
    };
    const ro = new ResizeObserver(() => {
      fit();
      onWidth(root.clientWidth);
    });
    ro.observe(view);
    ro.observe(root);
    const mo = new MutationObserver(() => {
      readInk();
      redraw();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"], subtree: true });
    const io = new IntersectionObserver(([entry]) => {
      visibleRef.current = entry.isIntersecting;
    });
    io.observe(root);
    return () => {
      ro.disconnect();
      mo.disconnect();
      io.disconnect();
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      engineRef.current = null;
    };
  }, []);

  // ── Рисунок из хранилища: при открытии и когда его сменили в другой вкладке ─

  const afterLoad = useEffectEvent(() => {
    setReady(true);
    syncHist();
  });

  useEffect(() => {
    const target = store.paint;
    if (target === writtenRef.current) return;
    const initial = writtenRef.current === undefined;
    writtenRef.current = target;
    const seq = ++loadSeqRef.current;
    void (async () => {
      const img = target ? await decodeImage(target).catch(() => null) : null;
      const engine = engineRef.current;
      if (seq !== loadSeqRef.current || !engine) return;
      pointerRef.current = null;
      engine.end();
      engine.replace(img, !initial);
      drawFigure(engine, viewRef.current, inkRef.current);
      afterLoad();
    })();
  }, [store.paint]);

  // ── Глаза следят за курсором (только по движению, не при «меньше движения») ─

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let last: globalThis.PointerEvent | null = null;
    const look = () => {
      raf = 0;
      const view = viewRef.current;
      const eyes = eyesRef.current;
      if (!last || !view || !eyes) return;
      const r = view.getBoundingClientRect();
      const cx = r.left + ((EYES_CENTER[0] - STAGE.x) / STAGE.w) * r.width;
      const cy = r.top + ((EYES_CENTER[1] - STAGE.y) / STAGE.h) * r.height;
      const dx = last.clientX - cx;
      const dy = last.clientY - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const p = Math.min(1, dist / LOOK.reach);
      eyes.setAttribute(
        "transform",
        `translate(${((dx / dist) * LOOK.x * p).toFixed(2)} ${((dy / dist) * LOOK.y * p).toFixed(2)})`,
      );
    };
    const onMove = (e: globalThis.PointerEvent) => {
      if (reduce.matches || !visibleRef.current) return;
      last = e;
      raf ||= requestAnimationFrame(look);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  // ── Действия ───────────────────────────────────────────────────────────────

  const chooseTool = (t: Tool) => {
    if (t === "brush" || t === "fill") prevToolRef.current = t;
    setTool(t);
    if (ringRef.current && t !== "brush" && t !== "eraser") ringRef.current.style.opacity = "0";
  };

  const chooseColor = (hex: string) => {
    setColor(hex);
    setHexDraft(null);
    if (tool === "eraser" || tool === "pipette") chooseTool("brush");
  };

  const undo = () => {
    const kind = engineRef.current?.undo();
    if (!kind) return;
    draw();
    persist(kind);
    syncHist();
    setStatus(null);
  };

  const redo = () => {
    const kind = engineRef.current?.redo();
    if (!kind) return;
    draw();
    persist(kind);
    syncHist();
    setStatus(null);
  };

  const clearAll = () => {
    if (!engineRef.current?.clear()) return;
    draw();
    persist("swap");
    syncHist();
    setStatus({ tone: "info", text: `Рисунок стёрт и лежит в «Моих Румиках». Вернуть: ${undoKey}` });
  };

  const saveFile = async () => {
    const engine = engineRef.current;
    if (!engine || engine.isBlank()) return;
    const blob = await engine.toBlob();
    if (!blob) {
      setStatus({ tone: "error", text: "Не получилось сохранить файл. Попробуйте ещё раз." });
      return;
    }
    downloadBlob(blob, "rumik.png");
    onEvent?.("file_saved");
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const head = new Uint8Array(await file.slice(0, 24).arrayBuffer());
    const check = checkPaintUpload(head, file.size);
    if (!check.ok) {
      setStatus({ tone: "error", text: check.error });
      return;
    }
    const img = await decodeImage(file).catch(() => null);
    const engine = engineRef.current;
    if (!img || !engine) {
      setStatus({ tone: "error", text: UPLOAD_ERROR });
      return;
    }
    // Файл после «Сохранить» перекодирован: строкой он не совпадёт с тем, что
    // уже лежит в «Моих Румиках», и там появилась бы вторая копия.
    const twin = await findTwin(engine, img).catch(() => null);
    if (engineRef.current !== engine) return;
    onEvent?.("file_loaded");
    if (twin === "current") {
      setStatus({ tone: "info", text: "Этот рисунок уже на Румике" });
      return;
    }
    const hadPaint = !engine.isBlank();
    pointerRef.current = null;
    engine.end();
    engine.replace(img, true);
    draw();
    if (twin) {
      // Он был в «Моих Румиках»: возвращаем его оттуда, а не кладём копию.
      writtenRef.current = twin.paint;
      saveMyPaint(twin.paint);
    } else {
      persist("swap");
    }
    syncHist();
    setStatus({ tone: "info", text: hadPaint ? "Рисунок загружен, прежний лежит в «Моих Румиках»" : "Рисунок загружен" });
  };

  /**
   * Нажатая миниатюра (или крестик) исчезла: фокус — на соседнюю с тем же
   * номером, а если миниатюр не осталось — на `fallback` или в панель
   * инструментов. Не в никуда.
   */
  const focusThumb = (i: number, fallback?: () => HTMLElement | null) => {
    requestAnimationFrame(() => {
      const root = rootRef.current;
      const thumbs = root?.querySelectorAll<HTMLButtonElement>("[data-thumb]");
      if (thumbs?.length) thumbs[Math.min(i, thumbs.length - 1)].focus();
      else (fallback?.() ?? root?.querySelector<HTMLButtonElement>("[role=toolbar] button[tabindex='0']"))?.focus();
    });
  };

  const restoreSaved = async (saved: SavedRumik, i: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    const img = await decodeImage(saved.paint).catch(() => null);
    if (!img || engineRef.current !== engine) return;
    const hadPaint = !engine.isBlank();
    pointerRef.current = null;
    engine.end();
    engine.replace(img, true);
    draw();
    writtenRef.current = saved.paint;
    saveMyPaint(saved.paint);
    syncHist();
    setStatus({ tone: "info", text: hadPaint ? "Рисунок вернулся, прежний лежит в «Моих Румиках»" : "Рисунок вернулся" });
    focusThumb(i);
  };

  const forget = (saved: SavedRumik, i: number) => {
    forgetSaved(saved.at);
    setRemoved({ saved, index: i });
    focusThumb(i, () => undoForgetRef.current);
  };

  const undoForget = () => {
    if (!removed) return;
    unforgetSaved(removed.saved, removed.index);
    setRemoved(null);
    focusThumb(removed.index);
  };

  // «Удалено · Вернуть» висит несколько секунд. Пока на «Вернуть» фокус — не
  // прячем: кнопка не должна исчезнуть из-под клавиатуры.
  useEffect(() => {
    if (!removed) return;
    const timer = window.setTimeout(() => {
      if (document.activeElement === undoForgetRef.current) setRemoved((r) => (r ? { ...r } : r));
      else setRemoved(null);
    }, UNDO_FORGET_MS);
    return () => window.clearTimeout(timer);
  }, [removed]);

  // ── Указатель на фигуре ────────────────────────────────────────────────────

  const moveRing = (e: PointerEvent<HTMLCanvasElement>) => {
    const ring = ringRef.current;
    if (!ring) return;
    if (e.pointerType !== "mouse" || (tool !== "brush" && tool !== "eraser")) {
      ring.style.opacity = "0";
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const d = (size * r.width) / STAGE.w;
    ring.style.width = `${d}px`;
    ring.style.height = `${d}px`;
    ring.style.transform = `translate(${e.clientX - r.left - d / 2}px, ${e.clientY - r.top - d / 2}px)`;
    ring.style.opacity = "0.9";
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current;
    if (!engine || !ready || pointerRef.current !== null) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = worldAt(e, e.currentTarget.getBoundingClientRect());
    setStatus(null);
    if (tool === "pipette") {
      const got = engine.pick(p);
      if (got) {
        setColor(snapToPalette(got));
        setHexDraft(null);
      }
      setTool(prevToolRef.current);
      return;
    }
    if (tool === "fill") {
      if (engine.fill(p, color)) {
        draw();
        persist("edit");
        syncHist();
        markStarted();
      }
      return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointerRef.current = e.pointerId;
    engine.begin(p, { size, color: tool === "eraser" ? null : color }, mirror);
    scheduleDraw();
    markStarted();
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    moveRing(e);
    const engine = engineRef.current;
    if (!engine || pointerRef.current !== e.pointerId) return;
    const r = e.currentTarget.getBoundingClientRect();
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of events.length > 0 ? events : [e.nativeEvent]) engine.move(worldAt(ev, r));
    scheduleDraw();
  };

  const endStroke = (e: PointerEvent<HTMLCanvasElement>) => {
    if (pointerRef.current !== e.pointerId) return;
    pointerRef.current = null;
    if (!engineRef.current?.end()) return;
    draw();
    persist("edit");
    syncHist();
  };

  // ── Клавиши: B, E, G, I, M, Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — по e.code, в любой раскладке ─

  const onKey = useEffectEvent((e: globalThis.KeyboardEvent) => {
    const root = rootRef.current;
    if (e.defaultPrevented || !root || !visibleRef.current) return;
    const target = e.target instanceof Element ? e.target : null;
    // Поле ввода или окно поверх рисовалки (открытка, настройки) — клавиши их.
    if (!editorOwnsKey(target, root, [...document.querySelectorAll("dialog[open]")])) return;
    const withMod = e.ctrlKey || e.metaKey;
    if (withMod && !e.altKey && (e.code === "KeyZ" || e.code === "KeyY")) {
      e.preventDefault();
      if (e.code === "KeyY" || e.shiftKey) redo();
      else undo();
      return;
    }
    if (withMod || e.altKey || e.shiftKey || e.repeat) return;
    const found = TOOLS.find((t) => t.code === e.code);
    if (found) chooseTool(found.tool);
    else if (e.code === "KeyM") setMirror((m) => !m);
  });

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── Панель инструментов: role="toolbar", стрелки между кнопками ────────────

  // Почему кнопка сейчас ничего не сделает (подсказка вместо названия). Кнопки
  // остаются в фокусе и в обходе стрелками: aria-disabled, а не disabled.
  const unavailable: (string | null)[] = [
    null,
    null,
    null,
    null,
    null,
    hist.undo ? null : "Отменять пока нечего",
    hist.redo ? null : "Возвращать нечего",
    blank ? "Стирать нечего: Румик и так белый" : null,
    blank ? "Сохранять нечего: Румик белый" : null,
    null,
  ];
  const noneSkipped = unavailable.map(() => false);

  const onToolbarKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const move = rovingKey(e.key, "both");
    if (!move) return;
    e.preventDefault();
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const current = buttons.findIndex((b) => b === document.activeElement);
    const next = nextIndex(current < 0 ? focusIndex : current, move, noneSkipped);
    buttons[next]?.focus();
    setFocusIndex(next);
  };

  const btn = (i: number) => {
    const reason = unavailable[i];
    return {
      size: layout.button,
      shape: "round" as const,
      tabIndex: i === focusIndex ? 0 : -1,
      onFocus: () => setFocusIndex(i),
      tooltipSide: wide ? ("right" as const) : ("top" as const),
      ...(reason && { "aria-disabled": true, tooltip: reason, className: UNAVAILABLE }),
    };
  };

  const groups: ReactNode[][] = [
    TOOLS.map((t, i) => (
      <IconButton
        key={t.tool}
        {...btn(i)}
        icon={t.icon}
        label={t.label}
        shortcut={formatKeyCode(t.code)}
        pressed={tool === t.tool}
        variant={tool === t.tool ? "soft" : "ghost"}
        onClick={() => chooseTool(t.tool)}
      />
    )),
    [
      <IconButton
        key="mirror"
        {...btn(4)}
        icon="flip-horizontal"
        label="Зеркало"
        hint="Зеркало: рисовать сразу с двух сторон"
        shortcut={formatKeyCode("KeyM")}
        pressed={mirror}
        variant={mirror ? "soft" : "ghost"}
        onClick={() => setMirror((m) => !m)}
      />,
    ],
    [
      <IconButton key="undo" {...btn(5)} icon="undo" label="Назад" shortcut={undoKey} onClick={undo} />,
      <IconButton
        key="redo"
        {...btn(6)}
        icon="redo"
        label="Вперёд"
        shortcut={isMac ? "⇧⌘Z" : "Ctrl+Y"}
        onClick={redo}
      />,
      <IconButton
        key="clear"
        {...btn(7)}
        icon="trash"
        label="Стереть всё"
        hint="Стереть всё (рисунок останется в «Моих Румиках»)"
        onClick={clearAll}
      />,
    ],
    [
      <IconButton
        key="save"
        {...btn(8)}
        icon="save"
        label="Сохранить файл"
        hint="Сохранить файл rumik.png: копия рисунка на случай, если браузер очистится"
        onClick={saveFile}
      />,
      <IconButton
        key="upload"
        {...btn(9)}
        icon="upload"
        label="Загрузить свой"
        hint="Загрузить свой рисунок: PNG из «Сохранить файл»"
        onClick={() => fileRef.current?.click()}
      />,
    ],
  ];

  // ── Палитра: radiogroup, стрелки меняют цвет ──────────────────────────────

  const swatchIndex = PAINT_PALETTE.findIndex((s) => s.hex === color);
  const onSwatchKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const move = rovingKey(e.key, "both");
    if (!move) return;
    e.preventDefault();
    const next = nextIndex(Math.max(0, swatchIndex), move, PAINT_PALETTE.map(() => false));
    chooseColor(PAINT_PALETTE[next].hex);
    e.currentTarget.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };

  const onHex = (value: string) => {
    setHexDraft(value);
    // Пока печатают, берём только полный цвет из шести знаков.
    if (/^#?[0-9a-f]{6}$/i.test(value.trim())) chooseColor(parseHex(value) ?? color);
  };
  const commitHex = () => {
    const hex = hexDraft === null ? null : parseHex(hexDraft);
    if (hex) chooseColor(hex);
    setHexDraft(null);
  };

  const cursor = tool === "brush" || tool === "eraser" ? "cursor-none" : "cursor-crosshair";

  return (
    <EditorGrid
      variant={variant}
      rootRef={rootRef}
      className={className}
      tools={
        <div
          role="toolbar"
          aria-label="Инструменты рисования"
          aria-orientation={wide ? "vertical" : "horizontal"}
          className={layout.toolbar}
          onKeyDown={onToolbarKey}
        >
          <ToolbarItems variant={variant} groups={groups} />
          <input
            ref={fileRef}
            type="file"
            accept="image/png"
            tabIndex={-1}
            aria-hidden="true"
            className="hidden"
            onChange={onFile}
          />
        </div>
      }
      figure={
        <>
          <FigureRug />
          {/* Пока холст не готов — тот же Румик картинкой: без мигания при загрузке. */}
          {!ready && (
            <div aria-hidden="true" className="pointer-events-none absolute" style={VIEW_IN_STAGE}>
              <Rumik colors="white" paint={store.paint ?? undefined} />
            </div>
          )}
          <canvas
            ref={viewRef}
            role="img"
            aria-label="Румик: на нём можно рисовать"
            className={cn("absolute inset-0 size-full touch-none select-none", cursor, !ready && "opacity-0")}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onLostPointerCapture={endStroke}
            onPointerLeave={() => {
              if (ringRef.current) ringRef.current.style.opacity = "0";
            }}
          />
          {/* Лицо поверх краски: плашка и глаза (они следят за курсором), ось зеркала. */}
          <svg
            viewBox={`${STAGE.x} ${STAGE.y} ${STAGE.w} ${STAGE.h}`}
            aria-hidden="true"
            className={cn("pointer-events-none absolute inset-0 size-full", !ready && "opacity-0")}
          >
            {mirror && (
              <line
                x1={AXIS_X}
                x2={AXIS_X}
                y1={STAGE.y + 2}
                y2={STAGE.y + STAGE.h - 2}
                strokeWidth={1.5}
                strokeDasharray="3 5"
                strokeLinecap="round"
                style={{ stroke: "var(--gr-avatar-ink)", strokeOpacity: 0.5 }}
              />
            )}
            <rect x={PLATE.x} y={PLATE.y} width={PLATE.w} height={PLATE.h} rx={PLATE.r} style={{ fill: "var(--gr-avatar-ink)" }} />
            <g ref={eyesRef}>
              <circle
                cx={EYE.ring.x}
                cy={EYE.ring.y}
                r={EYE.ring.r}
                strokeWidth={EYE.stroke}
                style={{ stroke: "var(--gr-rumik-eye)", fill: "none" }}
              />
              <circle cx={EYE.dot.x} cy={EYE.dot.y} r={EYE.dot.r} style={{ fill: "var(--gr-signal)" }} />
            </g>
          </svg>
          {/* Кольцо кисти. 1,5 px: border (1) теряется на пёстрой краске, border-2 закрывает край мазка. */}
          <span
            ref={ringRef}
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 rounded-full border-[1.5px] border-ink opacity-0 shadow-[0_0_0_1px_var(--gr-canvas)]"
          />
        </>
      }
      below={
        (store.gallery.length > 0 || removed) && (
          <section aria-labelledby={galleryTitleId} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <h3 id={galleryTitleId} className={PANEL_TITLE}>
                Мои Румики
              </h3>
              <span role="status" className="flex items-center gap-1 text-caption text-ink-3">
                {removed && (
                  <>
                    Удалено ·
                    <button
                      ref={undoForgetRef}
                      type="button"
                      onClick={undoForget}
                      // Строка 16 px, зона нажатия 24: поля наружу строку не раздвигают.
                      className="-my-1 rounded-key px-1 py-1 font-medium text-ink-2 transition-colors duration-140 ease-swift hover:text-ink"
                    >
                      Вернуть
                    </button>
                  </>
                )}
              </span>
            </div>
            {store.gallery.length > 0 && (
              <ul className={GALLERY_LIST}>
                {store.gallery.map((g, i) => {
                  const when = DATE.format(g.at);
                  return (
                    <li key={g.at} className="relative flex">
                      <Tooltip content={`Вернуть рисунок от ${when}`}>
                        <button
                          type="button"
                          data-thumb=""
                          aria-label={`Вернуть рисунок от ${when}`}
                          onClick={() => void restoreSaved(g, i)}
                          className={cn(
                            GALLERY_THUMB,
                            "transition-[background-color,scale] duration-140 ease-swift hover:bg-wash-2",
                            "active:scale-[0.94] motion-reduce:active:scale-100",
                          )}
                        >
                          <Rumik colors="white" paint={g.paint} frame="head" />
                        </button>
                      </Tooltip>
                      <Tooltip content="Убрать" className={GALLERY_CROSS_SPOT}>
                        <button
                          type="button"
                          aria-label={`Убрать рисунок от ${when} из «Моих Румиков»`}
                          onClick={() => forget(g, i)}
                          className={GALLERY_CROSS}
                        >
                          <Icon name="x" size={14} strokeWidth={2.4} />
                        </button>
                      </Tooltip>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )
      }
      panel={
        <>
          <div className={PANEL_CARD}>
            <p id={colorTitleId} className={PANEL_TITLE}>
              Цвет
            </p>
            <div role="radiogroup" aria-labelledby={colorTitleId} className={layout.swatches} onKeyDown={onSwatchKey}>
              {PAINT_PALETTE.map((s, i) => {
                const checked = i === swatchIndex;
                return (
                  <button
                    key={s.hex}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    aria-label={s.name}
                    tabIndex={checked || (swatchIndex < 0 && i === 0) ? 0 : -1}
                    onClick={() => chooseColor(s.hex)}
                    className={cn(
                      SWATCH,
                      "transition-[scale] duration-100 ease-swift hover:scale-110 motion-reduce:hover:scale-100",
                      checked ? SWATCH_CHECKED : SWATCH_EDGE,
                    )}
                    // Цвет кнопки — сам цвет краски (данные рисунка, см. palette.ts).
                    style={{ background: s.hex }}
                  />
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <label className={PICKER}>
                <span className="sr-only">Любой цвет</span>
                <input
                  type="color"
                  value={color}
                  onChange={(e) => chooseColor(e.target.value)}
                  className="absolute inset-0 size-full cursor-pointer rounded-full opacity-0"
                />
              </label>
              <TextField
                aria-label="Цвет в формате HEX"
                value={hexDraft ?? color.toUpperCase()}
                maxLength={7}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => onHex(e.target.value)}
                onBlur={commitHex}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitHex();
                }}
                wrapperClassName="min-w-0 flex-1"
                className="uppercase tabular-nums"
              />
            </div>
            <Slider label="Размер" value={size} onValueChange={setSize} min={BRUSH_MIN} max={BRUSH_MAX} />
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          <p className="text-caption text-ink-3">{STORAGE_NOTE}</p>
          <p role="status" className={cn(layout.status, status?.tone === "error" ? "text-alert-ink" : "text-ink-2")}>
            {status?.text}
          </p>
        </>
      }
    />
  );
}
