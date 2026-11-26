// Геометрия Румика — одна на всех: SVG-компонент (components/ui/Rumik.tsx) и
// рисовалка (R2) берут эти числа, чтобы рисунок ложился точно на фигуру.
//
// Координаты «мировые»: тело 132×128 стоит в точке (34, 18), середина фигуры по
// горизонтали — x = 100. Видимая рамка VIEW шире фигуры: в ней помещаются шапки,
// поднятые руки и значок «?» над головой.

export const VIEW = { x: -38, y: -26, w: 286, h: 240 } as const;
/** Ширина к высоте рамки: высота Румика шириной w — w / RUMIK_ASPECT. */
export const RUMIK_ASPECT = VIEW.w / VIEW.h;
/** Середина тела по горизонтали: граница левых и правых четвертей цвета. */
export const AXIS_X = 100;

export const BODY = { x: 34, y: 18, w: 132, h: 128, r: 42 } as const;
/** Тёмная плашка лица: на ней глаза читаются на любом цвете тела. */
export const PLATE = { x: 52, y: 34, w: 96, h: 76, r: 30 } as const;
/** Ноги: левая и правая начинаются в x = 62 и 108. */
export const LEG = { y: 134, w: 30, h: 52, r: 15, left: 62, right: 108 } as const;
/** Рука висит от плеча вниз: прямоугольник от top до top + h, кисть — на len. */
export const ARM = { w: 28, h: 72, r: 14, top: -10, len: 62 } as const;
export const HAND_R = 15;
/** Толщина обводки — монолиния, как штрихи логотипа. */
export const STROKE = 5;
/** Глаза: кольцо слева «слушает», лаймовый круг справа «говорит» (как в логотипе). */
export const EYE = { ring: { x: 80, y: 72, r: 10.5 }, dot: { x: 122, y: 71, r: 11.5 }, stroke: 3.8 } as const;

/** Плечо: точка крепления руки и угол в градусах (0 — рука висит вниз, по часовой — плюс). */
export type Shoulder = readonly [x: number, y: number, angle: number];
export type Pose = { readonly l: Shoulder; readonly r: Shoulder };

export const POSES = {
  stand: { l: [34, 88, 16], r: [166, 88, -16] },
  wave: { l: [34, 88, 16], r: [166, 84, -148] },
  waveL: { l: [34, 84, 148], r: [166, 88, -16] },
  cheer: { l: [34, 84, 148], r: [166, 84, -148] },
  point: { l: [34, 88, 16], r: [166, 88, -92] },
  sit: { l: [34, 92, 38], r: [166, 92, -38] },
  hold: { l: [34, 90, 62], r: [166, 90, -62] },
  // Смеётся: держится за живот — кисти на нижнем крае тела (жест 😂).
  laugh: { l: [34, 88, -50], r: [166, 88, 50] },
} as const satisfies Record<string, Pose>;

export type RumikPose = keyof typeof POSES;
export const RUMIK_POSES = Object.keys(POSES) as RumikPose[];

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Центр кисти: конец руки длиной ARM.len, повёрнутой на угол плеча. */
export function handAt([x, y, angle]: Shoulder): [number, number] {
  return [x - ARM.len * Math.sin(rad(angle)), y + ARM.len * Math.cos(rad(angle))];
}

/** Ноги сидящего чуть разведены (градусы, левая — плюс, правая — минус). */
export function legSwing(pose: RumikPose): number {
  return pose === "sit" ? 9 : 0;
}

/**
 * Части фигуры в порядке отрисовки (снизу вверх). Тот же порядок у силуэта в
 * Rumik.tsx, у масок рисовалки и у раскраски: каждый пиксель рисунка
 * принадлежит ровно одной видимой части в позе «стоит».
 */
export const PARTS = ["legL", "legR", "armL", "armR", "body", "handL", "handR"] as const;
export type RumikPart = (typeof PARTS)[number];

/**
 * Отражение рисунка руки поперёк её оси в позе «стоит». В этой позе внутренняя
 * половина руки спрятана за телом, и в слое краски там краска тела. Когда рука
 * поднимается, эту половину закрашиваем отражением видимой — иначе у плеча
 * виден клин цвета туловища.
 */
export function armMirror(part: "armL" | "armR"): string {
  const [x, y, a] = POSES.stand[part === "armL" ? "l" : "r"];
  return `translate(${x} ${y}) rotate(${a}) scale(-1 1) rotate(${-a}) translate(${-x} ${-y})`;
}

/** Рамка «голова» (квадрат): тело с лицом и шапкой, без ног — для списков и стопок. */
export const HEAD_VIEW = { x: 24, y: -18, w: 152, h: 152 } as const;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Как перенести рисунок части из позы «стоит» в позу `pose` (SVG transform или
 * undefined, если часть не двигается). Рисуют всегда стоящего Румика, а в
 * других позах руки, кисти и ноги поворачиваются вместе со своей краской.
 */
export function partTransform(pose: RumikPose, part: RumikPart): string | undefined {
  const from = POSES.stand;
  const to = POSES[pose] ?? from;
  const swing = legSwing(pose);
  switch (part) {
    case "legL":
      return swing ? `rotate(${swing} ${LEG.left + LEG.w / 2} 140)` : undefined;
    case "legR":
      return swing ? `rotate(${-swing} ${LEG.right + LEG.w / 2} 140)` : undefined;
    case "armL":
    case "armR":
    case "handL":
    case "handR": {
      const side = part.endsWith("L") ? "l" : "r";
      const a = from[side];
      const b = to[side];
      if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) return undefined;
      // Кисть едет за концом руки, рука — за плечом; обе поворачиваются на разницу углов.
      const [ax, ay] = part.startsWith("hand") ? handAt(a) : [a[0], a[1]];
      const [bx, by] = part.startsWith("hand") ? handAt(b) : [b[0], b[1]];
      return `translate(${r3(bx)} ${r3(by)}) rotate(${b[2] - a[2]}) translate(${r3(-ax)} ${r3(-ay)})`;
    }
    default:
      return undefined;
  }
}
