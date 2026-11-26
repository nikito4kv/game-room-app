import { describe, expect, it } from "vitest";
import { AXIS_X, BODY, LEG, PARTS, POSES, VIEW, handAt, type RumikPart } from "./geometry";
import {
  PAINT_H,
  PAINT_W,
  PART_SHAPES,
  STAGE,
  buildPartMap,
  checkPaintUpload,
  floodFillPart,
  hexToRgb,
  isBlankPixels,
  mirrorX,
  parseHex,
  partAt,
  pickPaintColor,
  pointInShape,
  readPngSize,
  rgbToHex,
  samePicture,
  stageToWorld,
  toPixel,
  traceShape,
  UPLOAD_ERROR,
  type PathSink,
  type PixelBuffer,
} from "./paint";
import { PAINT_BASE, PAINT_PALETTE } from "./palette";

const idx = (part: RumikPart) => PARTS.indexOf(part);
/** Пара части при отражении: левая ↔ правая. */
const MIRROR: Record<RumikPart, RumikPart> = {
  legL: "legR",
  legR: "legL",
  armL: "armR",
  armR: "armL",
  body: "body",
  handL: "handR",
  handR: "handL",
};

/** Маленький холст для тестов: рамка VIEW в половину (143×120). */
const S = 0.5;
const W = VIEW.w * S;
const H = VIEW.h * S;
const blank = (): PixelBuffer => ({ data: new Uint8ClampedArray(W * H * 4), width: W, height: H });
const px = (x: number, y: number): [number, number] => toPixel(x, y, S);

describe("размеры холста", () => {
  it("рамка VIEW × 2 = 572×480, рамка рисовалки — внутри VIEW и симметрична оси", () => {
    expect([PAINT_W, PAINT_H]).toEqual([572, 480]);
    expect(STAGE.x).toBeGreaterThanOrEqual(VIEW.x);
    expect(STAGE.x + STAGE.w).toBeLessThanOrEqual(VIEW.x + VIEW.w);
    expect(STAGE.y + STAGE.h).toBeLessThanOrEqual(VIEW.y + VIEW.h);
    expect(STAGE.x + STAGE.w / 2).toBe(AXIS_X);
    expect(stageToWorld(0.5, 0)).toEqual([AXIS_X, STAGE.y]);
  });
});

describe("части фигуры", () => {
  it("точка внутри и снаружи скруглённого прямоугольника", () => {
    const body = PART_SHAPES.body;
    expect(pointInShape(body, BODY.x + BODY.w / 2, BODY.y + BODY.h / 2)).toBe(true);
    // Угол рамки срезан скруглением r = 42.
    expect(pointInShape(body, BODY.x + 2, BODY.y + 2)).toBe(false);
    expect(pointInShape(body, BODY.x + 2, BODY.y + BODY.h / 2)).toBe(true);
    expect(pointInShape(body, BODY.x - 2, BODY.y + BODY.h / 2)).toBe(false);
  });

  it("рука повёрнута вместе с плечом, кисть — на её конце", () => {
    const [sx, sy, angle] = POSES.stand.l;
    const along = (d: number, side = 0): [number, number] => {
      const a = (angle * Math.PI) / 180;
      return [sx - d * Math.sin(a) + side * Math.cos(a), sy + d * Math.cos(a) + side * Math.sin(a)];
    };
    expect(pointInShape(PART_SHAPES.armL, ...along(30))).toBe(true);
    expect(pointInShape(PART_SHAPES.armL, ...along(30, 13))).toBe(true);
    expect(pointInShape(PART_SHAPES.armL, ...along(30, 16))).toBe(false);
    const [hx, hy] = handAt(POSES.stand.l);
    expect(partAt(hx, hy)).toBe(idx("handL"));
  });

  it("видна верхняя часть: тело закрывает плечо, кисть — конец руки", () => {
    expect(partAt(100, 80)).toBe(idx("body"));
    expect(partAt(BODY.x + 6, 92)).toBe(idx("body")); // и рука, и тело — видно тело
    expect(partAt(LEG.left + LEG.w / 2, 175)).toBe(idx("legL"));
    expect(partAt(LEG.right + LEG.w / 2, 175)).toBe(idx("legR"));
    expect(partAt(100, 175)).toBe(-1); // между ног
    expect(partAt(VIEW.x + 1, VIEW.y + 1)).toBe(-1);
  });

  it("фигура симметрична: отражённая точка — в парной части", () => {
    for (let y = VIEW.y; y < VIEW.y + VIEW.h; y += 3.7) {
      for (let x = VIEW.x; x < VIEW.x + VIEW.w; x += 3.3) {
        const a = partAt(x, y);
        const b = partAt(mirrorX(x), y);
        if (a < 0) expect(b).toBe(-1);
        else expect(PARTS[b]).toBe(MIRROR[PARTS[a]]);
      }
    }
    expect(mirrorX(AXIS_X)).toBe(AXIS_X);
    expect(mirrorX(80)).toBe(120);
  });
});

describe("маски частей", () => {
  const map = buildPartMap(S);

  it("каждый пиксель — одной части или ничей, и это та же часть, что по арифметике", () => {
    expect(map.length).toBe(W * H);
    for (let i = 0; i < map.length; i += 7) {
      const x = VIEW.x + ((i % W) + 0.5) / S;
      const y = VIEW.y + (Math.floor(i / W) + 0.5) / S;
      expect(map[i]).toBe(partAt(x, y));
    }
  });

  it("у каждой части есть свои пиксели, площадь тела — как у скруглённого прямоугольника", () => {
    const counts = PARTS.map((_, i) => map.filter((v) => v === i).length);
    for (const c of counts) expect(c).toBeGreaterThan(0);
    const bodyArea = (BODY.w * BODY.h - (4 - Math.PI) * BODY.r ** 2) * S * S;
    expect(Math.abs(counts[idx("body")] - bodyArea) / bodyArea).toBeLessThan(0.03);
  });

  it("маска зеркальна относительно оси", () => {
    let mismatch = 0;
    let figure = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const a = map[y * W + x];
        // Центр пикселя x отражается в центр пикселя x′ = (2·(AXIS_X − VIEW.x))·S − 1 − x.
        const xm = 2 * (AXIS_X - VIEW.x) * S - 1 - x;
        if (xm < 0 || xm >= W) continue;
        const b = map[y * W + xm];
        if (a >= 0) figure++;
        if ((a < 0 ? -1 : PARTS.indexOf(MIRROR[PARTS[a]])) !== b) mismatch++;
      }
    }
    expect(figure).toBeGreaterThan(1000);
    expect(mismatch).toBeLessThan(figure * 0.002);
  });
});

describe("заливка и пипетка", () => {
  const map = buildPartMap(S);
  const red = hexToRgb("#e5484d");

  it("на чистой части красит всю часть и только её", () => {
    const img = blank();
    expect(floodFillPart(img, map, ...px(100, 120), red)).toBe(true);
    for (let i = 0; i < map.length; i++) {
      const painted = img.data[i * 4 + 3] === 255;
      expect(painted).toBe(map[i] === idx("body"));
    }
    // Второй раз тем же цветом — нечего красить.
    expect(floodFillPart(img, map, ...px(100, 120), red)).toBe(false);
  });

  it("мимо фигуры ничего не красит", () => {
    const img = blank();
    expect(floodFillPart(img, map, ...px(100, 175), red)).toBe(false);
    expect(floodFillPart(img, map, -1, 5, red)).toBe(false);
    expect(isBlankPixels(img.data)).toBe(true);
  });

  it("растекается по похожему цвету: полоса делит тело", () => {
    const img = blank();
    // Тёмная вертикальная полоса через всё тело по x = 100.
    const [sx] = px(100, 0);
    for (let y = 0; y < H; y++) {
      for (const x of [sx - 1, sx, sx + 1]) {
        const i = (y * W + x) * 4;
        img.data.set([20, 22, 27, 255], i);
      }
    }
    expect(floodFillPart(img, map, ...px(60, 100), red)).toBe(true);
    const at = (x: number, y: number) => {
      const [a, b] = px(x, y);
      return [...img.data.slice((b * W + a) * 4, (b * W + a) * 4 + 3)];
    };
    expect(at(60, 100)).toEqual([...red]);
    expect(at(140, 100)).toEqual([0, 0, 0]); // правая половина не тронута
    expect(at(100, 100)).toEqual([20, 22, 27]); // полоса тоже
  });

  it("заливка чистого места подкладывает цвет под сглаженный край штриха — без светлых «волосков»", () => {
    const img = blank();
    // Красный штрих по x = 100 с полупрозрачными краями (сглаживание кисти).
    const [sx] = px(100, 0);
    for (let y = 0; y < H; y++) {
      if (map[y * W + sx] !== idx("body")) continue;
      img.data.set([...red, 255], (y * W + sx) * 4);
      img.data.set([...red, 140], (y * W + sx - 1) * 4);
      img.data.set([...red, 60], (y * W + sx + 1) * 4);
    }
    expect(floodFillPart(img, map, ...px(60, 100), red)).toBe(true);
    const [, y] = px(100, 100);
    const left = (y * W + sx - 1) * 4;
    expect([...img.data.slice(left, left + 4)]).toEqual([...red, 255]);
    // Правая половина за штрихом не залита — её край не трогаем.
    const right = (y * W + sx + 1) * 4;
    expect([...img.data.slice(right, right + 4)]).toEqual([...red, 60]);
  });

  it("заливка штриха перекрашивает его край, прозрачность края остаётся", () => {
    const img = blank();
    const blue = hexToRgb("#52cff3");
    const [sx] = px(100, 0);
    for (let y = 0; y < H; y++) {
      if (map[y * W + sx] !== idx("body")) continue;
      for (const x of [sx - 2, sx - 1, sx, sx + 1]) img.data.set([...red, 255], (y * W + x) * 4);
      img.data.set([...red, 100], (y * W + sx + 2) * 4);
    }
    expect(floodFillPart(img, map, ...px(100, 100), blue)).toBe(true);
    const [, y] = px(100, 100);
    const edge = (y * W + sx + 2) * 4;
    expect([...img.data.slice(edge, edge + 4)]).toEqual([...blue, 100]);
    // Чистое тело рядом не тронуто.
    const clean = (y * W + sx + 4) * 4;
    expect(img.data[clean + 3]).toBe(0);
  });

  it("пипетка: краска, полупрозрачная поверх белого, некрашеное — белый, мимо — null", () => {
    const img = blank();
    const [x, y] = px(100, 120);
    const i = (y * W + x) * 4;
    expect(pickPaintColor(img, map, x, y)).toBe(PAINT_BASE);
    img.data.set([229, 72, 77, 255], i);
    expect(pickPaintColor(img, map, x, y)).toBe("#e5484d");
    img.data.set([20, 22, 27, 128], i);
    const [r] = hexToRgb(pickPaintColor(img, map, x, y)!);
    expect(r).toBeGreaterThan(20);
    expect(r).toBeLessThan(241);
    expect(pickPaintColor(img, map, ...px(100, 175))).toBeNull();
  });
});

describe("цвет", () => {
  it("HEX: регистр, без решётки, короткий; мусор — null", () => {
    expect(parseHex("#89C3FE")).toBe("#89c3fe");
    expect(parseHex(" 89c3fe ")).toBe("#89c3fe");
    expect(parseHex("#abc")).toBe("#aabbcc");
    expect(parseHex("#ggg")).toBeNull();
    expect(parseHex("#12345")).toBeNull();
    expect(parseHex("")).toBeNull();
    expect(rgbToHex(hexToRgb("#0a0b0c"))).toBe("#0a0b0c");
  });

  it("палитра — данные рисунка: 15 разных hex, белый Румик первым", () => {
    const hexes = PAINT_PALETTE.map((s) => s.hex);
    expect(new Set(hexes).size).toBe(15);
    for (const h of hexes) expect(parseHex(h)).toBe(h);
    expect(hexes[0]).toBe(PAINT_BASE);
  });
});

describe("файл PNG", () => {
  const png = (w: number, h: number) => {
    const b = new Uint8Array(33);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const view = new DataView(b.buffer);
    view.setUint32(16, w);
    view.setUint32(20, h);
    return b;
  };

  it("размер из заголовка", () => {
    expect(readPngSize(png(572, 480))).toEqual({ width: 572, height: 480 });
    expect(readPngSize(png(70000, 3))).toEqual({ width: 70000, height: 3 });
    expect(readPngSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(30).fill(0)]))).toBeNull();
    expect(readPngSize(png(1, 1).slice(0, 20))).toBeNull();
  });

  it("принимает 572×480 и 286×240, остальное — понятная ошибка", () => {
    expect(checkPaintUpload(png(572, 480))).toEqual({ ok: true, width: 572, height: 480 });
    expect(checkPaintUpload(png(286, 240))).toEqual({ ok: true, width: 286, height: 240 });
    // Причина одна и простая: размеры и форматы человеку не нужны.
    for (const bad of [
      checkPaintUpload(png(1024, 768)),
      checkPaintUpload(new Uint8Array(40).fill(0xff)),
      checkPaintUpload(png(572, 480), 5 * 1024 * 1024),
    ]) {
      expect(bad).toEqual({ ok: false, error: UPLOAD_ERROR });
    }
    expect(UPLOAD_ERROR).not.toMatch(/\d/);
  });

  it("тот же рисунок после перекодирования узнаётся, другой — нет", () => {
    const a = blank();
    for (let i = 0; i < a.data.length; i += 4) a.data.set([229, 72, 77, (i / 4) % 7 === 0 ? 128 : 255], i);
    const b = { ...a, data: new Uint8ClampedArray(a.data) };
    // Перекодирование: полупрозрачные пиксели сдвинулись на единицу.
    for (let i = 0; i < b.data.length; i += 4) if (b.data[i + 3] === 128) b.data[i + 1] += 1;
    expect(samePicture(a, b)).toBe(true);
    // Штрих другим цветом — уже другой рисунок.
    const c = { ...a, data: new Uint8ClampedArray(a.data) };
    for (let i = 0; i < 400 * 4; i += 4) c.data.set([82, 207, 243, 255], i);
    expect(samePicture(a, c)).toBe(false);
    expect(samePicture(a, { ...a, width: 10 })).toBe(false);
  });
});

describe("контур для холста", () => {
  it("скругления через arcTo (без roundRect), круг — через arc", () => {
    const calls: string[] = [];
    const sink: PathSink = {
      moveTo: () => void calls.push("moveTo"),
      arcTo: () => void calls.push("arcTo"),
      arc: () => void calls.push("arc"),
      closePath: () => void calls.push("closePath"),
    };
    traceShape(sink, PART_SHAPES.armL);
    expect(calls).toEqual(["moveTo", "arcTo", "arcTo", "arcTo", "arcTo", "closePath"]);
    calls.length = 0;
    traceShape(sink, PART_SHAPES.handR);
    expect(calls).toEqual(["moveTo", "arc", "closePath"]);
  });

  it("повёрнутая рука: контур начинается на её границе, а углы — по её повёрнутой рамке", () => {
    const pts: [number, number][] = [];
    const sink: PathSink = {
      moveTo: (x, y) => void pts.push([x, y]),
      arcTo: (x1, y1) => void pts.push([x1, y1]),
      arc: () => {},
      closePath: () => {},
    };
    traceShape(sink, PART_SHAPES.armR);
    const [x0, y0] = pts[0];
    expect(pointInShape(PART_SHAPES.armR, x0, y0)).toBe(true);
    // Углы рамки (опорные точки arcTo) — снаружи скруглённой руки, но рядом с ней.
    for (const [x, y] of pts.slice(1)) {
      expect(pointInShape(PART_SHAPES.armR, x, y)).toBe(false);
      expect(Math.hypot(x - POSES.stand.r[0], y - POSES.stand.r[1])).toBeLessThan(80);
    }
  });
});
