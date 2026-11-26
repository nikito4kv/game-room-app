"use client";

import { useEffect, useId, useRef } from "react";
import { avatarColorVar } from "@/components/ui/avatarColor";
import { cn } from "@/components/ui/cn";
import { usePublicConfig } from "@/lib/client/usePublicConfig";
import { DECOR_OFF } from "./SideDecor";
import { WALL_MIN_WIDTH, wallOffset, wallPhase } from "./parallax";

// «Стена» витрины (бренд-слой, DESIGN_SYSTEM.md §8): две полосы по краям колонки
// 1200 с тихими скруглёнными квадратами в три слоя глубины. Слои едут с разной
// скоростью от прокрутки — получается объём. Только на очень широком окне (от
// 1700 px), позади всего содержимого, мышь не ловит, скринридер не видит.
//
// Порядок слоёв: стена с отрицательным z-index, поэтому её корень — UiRoot с
// `isolate` (см. src/app/(site)/layout.tsx): так она над фоном страницы, но под
// любым содержимым, кнопками и боковыми Румиками. Ставится по одному разу на
// страницу витрины, не в общий layout (на юридических страницах стены нет).

type Square = readonly [x: number, y: number, size: number, rotate: number, color: number];
type Layer = {
  /** Доля скорости прокрутки: 1 — как страница. */
  speed: number;
  /** Плитка узора, px. */
  w: number;
  h: number;
  stroke: number;
  opacity: number;
  blur: number;
  squares: readonly Square[];
};

// Дальний слой — мелкие размытые квадраты, ближний — крупные; узоры как в макете.
const LAYERS: readonly Layer[] = [
  {
    speed: 0.08,
    w: 150,
    h: 190,
    stroke: 2,
    opacity: 0.13,
    blur: 3,
    squares: [
      [14, 10, 24, -8, 0],
      [84, 40, 18, 12, 5],
      [40, 92, 26, 6, 8],
      [110, 122, 20, -14, 3],
      [16, 150, 18, 10, 6],
      [92, 160, 22, -6, 9],
    ],
  },
  {
    speed: 0.2,
    w: 170,
    h: 230,
    stroke: 3,
    opacity: 0.17,
    blur: 0,
    squares: [
      [22, 16, 46, -8, 0],
      [106, 92, 34, 12, 5],
      [36, 150, 40, 6, 8],
      [122, 190, 24, -14, 3],
    ],
  },
  {
    speed: 0.42,
    w: 240,
    h: 320,
    stroke: 4,
    opacity: 0.15,
    blur: 1.3,
    squares: [
      [24, 20, 70, -8, 1],
      [150, 124, 56, 12, 4],
      [48, 206, 84, 6, 7],
      [170, 250, 48, -12, 2],
    ],
  },
];

const SIDES = ["left", "right"] as const;

/**
 * Сдвиг слоя при данной прокрутке: только transform, раскладка не трогается.
 * Правый слой ещё и отражён: узор начинается от края экрана, как у левого, а
 * слой не шире своей полосы (широкий слой с will-change — лишняя видеопамять).
 */
const layerTransform = (side: (typeof SIDES)[number], L: Layer, scrollY: number) =>
  `translate3d(0, ${wallOffset(scrollY, L.speed, L.h, wallPhase(side, L.h))}px, 0)${side === "right" ? " scaleX(-1)" : ""}`;

// Края гаснут: к колонке и к краю экрана, сверху и снизу. В маске важна только
// прозрачность, поэтому чёрный — это «видно», а не цвет.
const mask = (to: "right" | "left") =>
  `linear-gradient(to ${to}, transparent 0, black 12%, black 38%, transparent 90%), ` +
  "linear-gradient(to bottom, transparent 0, black 12%, black 88%, transparent 100%)";

export function DecorWall() {
  const uid = useId();
  // Выключено флагом rumik_decor — стену убираем целиком, вместе со слушателем.
  const off = usePublicConfig()?.flags.rumik_decor === false;
  // Шесть слоёв: сначала три левых, потом три правых (порядок как в LAYERS).
  const layers = useRef<(SVGSVGElement | null)[]>([]);

  useEffect(() => {
    if (off) return;
    const wide = window.matchMedia(`(min-width: ${WALL_MIN_WIDTH}px)`);
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let listening = false;

    // will-change — пока стена может ехать (широкое окно, без «меньше движения»);
    // стоящей стене отдельные слои на видеокарте не нужны.
    const place = (scrollY: number, moving: boolean) => {
      SIDES.forEach((side, s) =>
        LAYERS.forEach((L, l) => {
          const el = layers.current[s * LAYERS.length + l];
          if (!el) return;
          el.style.transform = layerTransform(side, L, scrollY);
          el.style.willChange = moving ? "transform" : "";
        }),
      );
    };
    const apply = () => {
      frame = 0;
      place(window.scrollY, true);
    };
    // Не больше одного кадра на пачку событий прокрутки; в покое ничего не крутится.
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const sync = () => {
      const move = wide.matches && !calm.matches;
      if (move && !listening) {
        window.addEventListener("scroll", onScroll, { passive: true });
        listening = true;
        apply();
      } else if (!move && listening) {
        window.removeEventListener("scroll", onScroll);
        listening = false;
        cancelAnimationFrame(frame);
        frame = 0;
        place(0, false);
      }
    };

    sync();
    wide.addEventListener("change", sync);
    calm.addEventListener("change", sync);
    return () => {
      wide.removeEventListener("change", sync);
      calm.removeEventListener("change", sync);
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [off]);

  if (off) return null;

  return (
    <>
      {SIDES.map((side, s) => (
        <div
          key={side}
          aria-hidden="true"
          data-decor-wall={side}
          className={cn(
            "pointer-events-none fixed inset-y-0 -z-10 hidden w-[calc(50%-600px)] overflow-hidden min-[1700px]:block",
            side === "left" ? "left-0" : "right-0",
            DECOR_OFF,
          )}
          style={{
            maskImage: mask(side === "left" ? "right" : "left"),
            WebkitMaskImage: mask(side === "left" ? "right" : "left"),
            maskComposite: "intersect",
            WebkitMaskComposite: "source-in",
          }}
        >
          {LAYERS.map((L, l) => {
            const id = `${uid}-wall-${s}${l}`;
            return (
              <svg
                key={l}
                ref={(el) => {
                  layers.current[s * LAYERS.length + l] = el;
                }}
                focusable="false"
                className="absolute inset-x-0 top-0 block w-full"
                style={{
                  height: `calc(100% + ${L.h}px)`,
                  opacity: L.opacity,
                  filter: L.blur ? `blur(${L.blur}px)` : undefined,
                  transform: layerTransform(side, L, 0),
                }}
              >
                <defs>
                  <pattern id={id} patternUnits="userSpaceOnUse" width={L.w} height={L.h}>
                    {L.squares.map(([x, y, size, rotate, color], i) => (
                      <rect
                        key={i}
                        x={x}
                        y={y}
                        width={size}
                        height={size}
                        rx={Math.round(size * 0.32 * 10) / 10}
                        strokeWidth={L.stroke}
                        transform={`rotate(${rotate} ${x + size / 2} ${y + size / 2})`}
                        style={{ fill: "none", stroke: avatarColorVar(color) }}
                      />
                    ))}
                  </pattern>
                </defs>
                <rect width="100%" height="100%" style={{ fill: `url(#${id})` }} />
              </svg>
            );
          })}
        </div>
      ))}
    </>
  );
}
