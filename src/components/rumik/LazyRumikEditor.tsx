"use client";

import { Suspense, lazy, useEffect, useRef, useState, type Ref } from "react";
import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/icons";
import { Rumik } from "@/components/ui/Rumik";
import { BRUSH_DEFAULT, BRUSH_MAX, BRUSH_MIN, DEFAULT_PAINT_COLOR, PAINT_PALETTE } from "@/lib/rumik/palette";
import { useRumikStore } from "@/lib/rumik/useMyRumik";
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
  TOOL_ICONS,
  ToolbarItems,
  VIEW_IN_STAGE,
} from "./editorLayout";
import type { RumikEditorProps } from "./RumikEditor";

export type { RumikEditorEvent, RumikEditorProps } from "./RumikEditor";

// Рисовалка Румика для страниц. Код рисовалки (холст, движок, панели) тяжёлый и
// грузится отдельным куском, только когда рисовалка подъезжает к экрану (за
// 300 px): на широком экране она в первом экране главной — значит, сразу после
// гидрации, на телефоне — когда до неё долистали. До загрузки стоит заглушка
// той же раскладки и того же размера (EditorGrid): неактивные панели и Румик
// картинкой — белый, а после гидрации свой рисунок из хранилища. Сдвига нет.

const SIZE_FRACTION = (BRUSH_DEFAULT - BRUSH_MIN) / (BRUSH_MAX - BRUSH_MIN);
const SIZE_PCT = `${SIZE_FRACTION * 100}%`;

const RumikEditor = lazy(() => import("./RumikEditor").then((m) => ({ default: m.RumikEditor })));

export function LazyRumikEditor(props: RumikEditorProps) {
  const [load, setLoad] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        setLoad(true);
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (!load) return <EditorPlaceholder {...props} rootRef={ref} />;
  return (
    <Suspense fallback={<EditorPlaceholder {...props} />}>
      <RumikEditor {...props} />
    </Suspense>
  );
}

/** Неподвижная копия рисовалки: те же блоки и размеры, без логики. */
function EditorPlaceholder({
  variant = "hero",
  actions,
  className,
  rootRef,
}: RumikEditorProps & { rootRef?: Ref<HTMLDivElement> }) {
  const layout = EDITOR_LAYOUT[variant];
  const { paint, gallery } = useRumikStore();
  const md = layout.button === "md";
  // Как у рисовалки при открытии: истории ещё нет, стирать и сохранять нечего, если Румик белый.
  const dim = new Set(paint ? ["undo", "redo"] : ["undo", "redo", "trash", "save"]);
  const groups = TOOL_ICONS.map((group) =>
    group.map((icon) => (
      <span
        key={icon}
        className={cn(
          "grid shrink-0 place-items-center rounded-full",
          md ? "size-10" : "size-8",
          icon === "brush" ? "bg-wash-2 text-ink" : "text-ink-2",
          dim.has(icon) && "opacity-40",
        )}
      >
        <Icon name={icon} size={md ? 18 : 16} />
      </span>
    )),
  );

  return (
    <EditorGrid
      variant={variant}
      rootRef={rootRef}
      className={className}
      tools={
        <div aria-hidden="true" inert className={layout.toolbar}>
          <ToolbarItems variant={variant} groups={groups} />
        </div>
      }
      figure={
        <>
          <FigureRug />
          <div className="pointer-events-none absolute" style={VIEW_IN_STAGE}>
            <Rumik colors="white" paint={paint ?? undefined} label="Румик" />
          </div>
        </>
      }
      below={
        gallery.length > 0 && (
          <div aria-hidden="true" className="flex flex-col gap-1">
            <p className={PANEL_TITLE}>Мои Румики</p>
            <div className={GALLERY_LIST}>
              {gallery.map((g) => (
                <span key={g.at} className="relative flex">
                  <span className={GALLERY_THUMB}>
                    <Rumik colors="white" paint={g.paint} frame="head" />
                  </span>
                  <span className={GALLERY_CROSS_SPOT}>
                    <span className={GALLERY_CROSS}>
                      <Icon name="x" size={14} strokeWidth={2.4} />
                    </span>
                  </span>
                </span>
              ))}
            </div>
          </div>
        )
      }
      panel={
        <>
          <div aria-hidden="true" inert className={PANEL_CARD}>
            <p className={PANEL_TITLE}>Цвет</p>
            <div className={layout.swatches}>
              {PAINT_PALETTE.map((s) => (
                <span
                  key={s.hex}
                  className={cn(
                    SWATCH,
                    s.hex === DEFAULT_PAINT_COLOR ? SWATCH_CHECKED : SWATCH_EDGE,
                  )}
                  // Цвет — сам цвет краски (данные рисунка, см. palette.ts).
                  style={{ background: s.hex }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className={PICKER} />
              <span className="flex h-10 min-w-0 flex-1 items-center rounded-control border border-line-strong bg-sunken px-3 text-body-lg uppercase tabular-nums text-ink">
                {DEFAULT_PAINT_COLOR}
              </span>
            </div>
            {/* Как Slider: подпись 18 + отступ 8 + полоса 20. */}
            <div className="flex h-[46px] flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3 text-label font-medium">
                <span className="text-ink-2">Размер</span>
                <span className="tabular-nums text-ink">{BRUSH_DEFAULT}</span>
              </div>
              <div className="relative flex h-5 items-center">
                <span className="absolute inset-x-0 h-1 rounded-full bg-wash-3" />
                <span className="absolute left-0 h-1 rounded-full bg-ink" style={{ width: SIZE_PCT }} />
                {/* Ручка нативного ползунка стоит внутри полосы: от 8 px слева до 8 px справа. */}
                <span
                  className="absolute size-4 -translate-x-1/2 rounded-full bg-ink"
                  style={{ left: `calc(8px + (100% - 16px) * ${SIZE_FRACTION})` }}
                />
              </div>
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          <p className="text-caption text-ink-3">{STORAGE_NOTE}</p>
          <p className={layout.status} />
        </>
      }
    />
  );
}
