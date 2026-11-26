import { Fragment, type ReactNode, type Ref } from "react";
import { cn } from "@/components/ui/cn";
import type { IconName } from "@/components/ui/icons";
import { VIEW } from "@/lib/rumik/geometry";
import { STAGE } from "@/lib/rumik/stage";

// Раскладка рисовалки Румика: одна на рисовалку и на её лёгкую заглушку
// (LazyRumikEditor), поэтому размеры совпадают и при загрузке ничего не
// прыгает. Без состояния и без JS-логики — только разметка и классы.
//
// Раскладка зависит от ширины КОНТЕЙНЕРА (container queries), а не окна:
// рисовалка живёт и в колонке героя, и в окне лобби.
//   • широко (hero ≥ 600, dialog ≥ 560): панель инструментов столбиком слева,
//     фигура, справа цвет;
//   • средне (hero ≥ 480, dialog ≥ 460; колонка героя на окне 1024): панель
//     инструментов строкой сверху, под ней фигура и цвет рядом;
//   • узко: всё столбиком, панель инструментов строкой над фигурой (на самом
//     узком — в два ряда: рисование / история и файл).
// Классы целиком строками: их ищет Tailwind.

export type EditorVariant = "hero" | "dialog";

type Layout = {
  grid: string;
  toolbar: string;
  sep: string;
  rowBreak: string;
  sepWide: string;
  figure: string;
  /**
   * «Мои Румики» под фигурой. Место держится заранее (галерея появляется после
   * гидрации): в широкой раскладке — ряд миниатюр, в средней — два ряда. В узкой
   * не держится: там рисовалка ниже первого экрана, и пустая полоса под
   * ковриком, пока рисунков нет, хуже сдвига.
   */
  below: string;
  panelCol: string;
  /** Строка ответа (role=status): рядом с фигурой держит три строки, чтобы колонка цвета не прыгала. */
  status: string;
  swatches: string;
  /** Размер кнопок панели (IconButton). */
  button: "md" | "sm";
  /** С какой ширины контейнера раскладка в три колонки (панель инструментов столбиком). */
  wideFrom: number;
};

const SEP = "h-6 w-px shrink-0 bg-line";
/**
 * Рамка фигуры — STAGE. SVG-Румик в заглушке и миниатюрах лежит в рамке VIEW,
 * она шире STAGE: без обрезки по ширине пустые поля SVG вылезали бы за блок и
 * на узком экране давали горизонтальную прокрутку. По высоте не режем: коврик
 * под фигурой выходит вниз.
 */
const FIGURE = "relative aspect-[224/194] w-full overflow-x-clip";

export const EDITOR_LAYOUT: Record<EditorVariant, Layout> = {
  hero: {
    grid:
      "flex flex-col items-center gap-4 " +
      "@min-[480px]:grid @min-[480px]:grid-cols-[minmax(0,1fr)_176px] @min-[480px]:items-center @min-[480px]:gap-x-6 " +
      "@min-[600px]:grid-cols-[56px_minmax(0,376px)_176px] @min-[600px]:justify-start @min-[600px]:gap-6",
    toolbar:
      "flex max-w-full flex-wrap items-center justify-center gap-x-0.5 gap-y-1 rounded-panel border border-line bg-raised p-1.5 " +
      "@min-[448px]:flex-nowrap @min-[448px]:rounded-full @min-[480px]:col-span-2 @min-[480px]:justify-self-center " +
      "@min-[600px]:col-span-1 @min-[600px]:flex-col @min-[600px]:gap-y-0.5",
    sep: `${SEP} mx-1 @min-[600px]:mx-0 @min-[600px]:my-1 @min-[600px]:h-px @min-[600px]:w-6`,
    rowBreak: "h-0 basis-full @min-[448px]:hidden",
    sepWide: `${SEP} mx-1 hidden @min-[448px]:block @min-[600px]:mx-0 @min-[600px]:my-1 @min-[600px]:h-px @min-[600px]:w-6`,
    figure: `${FIGURE} max-w-[376px]`,
    below: "w-full max-w-[376px] empty:hidden @min-[480px]:block @min-[480px]:min-h-[112px] @min-[640px]:min-h-[66px]",
    panelCol: "flex w-full max-w-[360px] flex-col gap-3 @min-[480px]:max-w-none",
    status: "min-h-4 text-caption @min-[480px]:min-h-12",
    swatches: "grid grid-cols-8 gap-2 @min-[480px]:grid-cols-5 @min-[480px]:gap-1.5",
    button: "md",
    wideFrom: 600,
  },
  dialog: {
    grid:
      "flex flex-col items-center gap-4 " +
      "@min-[460px]:grid @min-[460px]:grid-cols-[minmax(0,1fr)_176px] @min-[460px]:items-center @min-[460px]:gap-x-5 " +
      "@min-[560px]:grid-cols-[48px_minmax(0,376px)_176px] @min-[560px]:justify-center @min-[560px]:gap-5",
    toolbar:
      "flex max-w-full flex-wrap items-center justify-center gap-x-0.5 gap-y-1 rounded-panel border border-line bg-raised p-1.5 " +
      "@min-[400px]:flex-nowrap @min-[400px]:rounded-full @min-[460px]:col-span-2 @min-[460px]:justify-self-center " +
      "@min-[560px]:col-span-1 @min-[560px]:flex-col @min-[560px]:gap-y-0.5",
    sep: `${SEP} mx-1 @min-[560px]:mx-0 @min-[560px]:my-1 @min-[560px]:h-px @min-[560px]:w-5`,
    rowBreak: "h-0 basis-full @min-[400px]:hidden",
    sepWide: `${SEP} mx-1 hidden @min-[400px]:block @min-[560px]:mx-0 @min-[560px]:my-1 @min-[560px]:h-px @min-[560px]:w-5`,
    figure: `${FIGURE} max-w-[320px]`,
    // Колонка фигуры шире самой фигуры (376 против 320): «Мои Румики» встают в один ряд.
    below: "w-full max-w-[376px] empty:hidden @min-[460px]:block @min-[460px]:min-h-[112px] @min-[624px]:min-h-[66px]",
    panelCol: "flex w-full max-w-[360px] flex-col gap-3 @min-[460px]:max-w-none",
    status: "min-h-4 text-caption @min-[460px]:min-h-12",
    swatches: "grid grid-cols-8 gap-2 @min-[460px]:grid-cols-5 @min-[460px]:gap-1.5",
    button: "sm",
    wideFrom: 560,
  },
};

/** Кнопки панели по группам: рисование · зеркало · история · файл. */
export const TOOL_ICONS: readonly (readonly IconName[])[] = [
  ["brush", "eraser", "paint-bucket", "pipette"],
  ["flip-horizontal"],
  ["undo", "redo", "trash"],
  ["save", "upload"],
];

/**
 * «Мои Румики»: миниатюры 36 px с переносом строки — видны все восемь при любой
 * ширине, без скрытой прокрутки. Крестик 24 px (зона нажатия 28) выступает за
 * угол на 8 px; зазор 10 px, чтобы зона крестика не заходила на соседа.
 */
export const GALLERY_LIST = "flex flex-wrap gap-2.5 pt-2.5";
export const GALLERY_THUMB = "relative block size-9 shrink-0 rounded-item border border-line bg-wash-1 p-1";
/** Обёртка крестика (её же меряет подсказка), сам крестик — внутри. */
export const GALLERY_CROSS_SPOT = "absolute -right-2 -top-2";
export const GALLERY_CROSS =
  "relative grid size-6 place-items-center rounded-full border border-line-strong bg-overlay text-ink-2 " +
  "transition-colors duration-140 ease-swift hover:text-ink before:absolute before:-inset-0.5 before:content-['']";

/** Карточка «Цвет» и её части (одинаковы у рисовалки и заглушки). */
export const PANEL_CARD = "flex w-full flex-col gap-3 rounded-card border border-line bg-raised p-3.5";
export const PANEL_TITLE = "text-caption font-medium text-ink-3";
export const SWATCH = "relative aspect-square w-full rounded-full";
/** Тонкий край, чтобы светлые и тёмные кружки не терялись на фоне; у выбранного — ещё кольцо. */
export const SWATCH_EDGE = "shadow-[inset_0_0_0_1px_var(--gr-line-strong)]";
export const SWATCH_CHECKED =
  "shadow-[inset_0_0_0_1px_var(--gr-line-strong),0_0_0_2px_var(--gr-raised),0_0_0_4px_var(--gr-ink)]";
/**
 * «Любой цвет»: радуга из палитры аватаров (токены), под ней системный выбор
 * цвета. Фокус получает прозрачный <input type=color> внутри — кольцо рисуем на
 * круге, как общее кольцо фокуса в globals.css (2 px --gr-focus, отступ 2 px).
 */
export const PICKER =
  "relative size-10 shrink-0 rounded-full shadow-[inset_0_0_0_1px_var(--gr-line-strong)] " +
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus " +
  "bg-[conic-gradient(var(--gr-avatar-0),var(--gr-avatar-1),var(--gr-avatar-2),var(--gr-avatar-3),var(--gr-avatar-4),var(--gr-avatar-5),var(--gr-avatar-6),var(--gr-avatar-7),var(--gr-avatar-8),var(--gr-avatar-9),var(--gr-avatar-0))]";
export const STORAGE_NOTE = "Рисунок хранится в этом браузере. «Сохранить файл» сбережёт копию.";

/** Сетка рисовалки: панель инструментов, фигура с «Моими Румиками» под ней, цвет. */
export function EditorGrid({
  variant,
  rootRef,
  className,
  tools,
  figure,
  below,
  panel,
}: {
  variant: EditorVariant;
  rootRef?: Ref<HTMLDivElement>;
  className?: string;
  tools: ReactNode;
  figure: ReactNode;
  below: ReactNode;
  panel: ReactNode;
}) {
  const l = EDITOR_LAYOUT[variant];
  return (
    <div ref={rootRef} className={cn("@container w-full", className)}>
      <div className={l.grid}>
        {tools}
        <div className="flex w-full min-w-0 flex-col items-center gap-3">
          <div className={l.figure}>{figure}</div>
          <div className={l.below}>{below}</div>
        </div>
        <div className={l.panelCol}>{panel}</div>
      </div>
    </div>
  );
}

/**
 * Кнопки панели по группам с разделителями. Между зеркалом и историей на самом
 * узком — перенос строки (два ровных ряда), шире — обычный разделитель.
 */
export function ToolbarItems({ variant, groups }: { variant: EditorVariant; groups: readonly ReactNode[][] }) {
  const l = EDITOR_LAYOUT[variant];
  return groups.map((group, g) => (
    <Fragment key={g}>
      {g === 2 && <span aria-hidden="true" className={l.rowBreak} />}
      {g > 0 && <span role="separator" className={g === 2 ? l.sepWide : l.sep} />}
      {group}
    </Fragment>
  ));
}

/** Подложка под фигурой — «коврик», как в макете. */
export function FigureRug() {
  return (
    <span
      aria-hidden="true"
      className={cn(
        // rounded-[50%] — эллипс по размеру коврика: у rounded-full была бы «таблетка».
        "pointer-events-none absolute inset-x-[4%] -bottom-[3%] h-[15%] rounded-[50%] border border-line",
        "bg-[radial-gradient(closest-side,transparent_62%,var(--gr-wash-2))] shadow-[inset_0_0_0_5px_var(--gr-wash-1)]",
      )}
    />
  );
}

/**
 * Где лежит SVG-Румик (рамка VIEW) внутри рамки рисовалки STAGE: в процентах
 * её ширины и высоты. Нужен заглушке и миниатюрам, чтобы фигура встала ровно
 * туда же, где её рисует холст.
 */
export const VIEW_IN_STAGE = {
  left: `${((VIEW.x - STAGE.x) / STAGE.w) * 100}%`,
  top: `${((VIEW.y - STAGE.y) / STAGE.h) * 100}%`,
  width: `${(VIEW.w / STAGE.w) * 100}%`,
} as const;
