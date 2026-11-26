import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OG, roomTitleSize } from "./ogCard";

// Тёмная тема — всё до блока светлой: [data-theme="light"].
const tokens = readFileSync(join(process.cwd(), "design-system", "tokens.css"), "utf8");
const dark = tokens.slice(0, tokens.indexOf('[data-theme="light"]'));
const token = (name: string) => new RegExp(`--gr-${name}:\\s*(#[0-9a-f]{6})`, "i").exec(dark)?.[1].toLowerCase();

describe("OG-палитра", () => {
  it("совпадает с тёмной темой design-system/tokens.css", () => {
    expect(OG.canvas).toBe(token("canvas"));
    expect(OG.sunken).toBe(token("sunken"));
    expect(OG.ink).toBe(token("ink"));
    expect(OG.ink2).toBe(token("ink-2"));
    expect(OG.ink3).toBe(token("ink-3"));
    expect(OG.signal).toBe(token("signal"));
    expect(OG.avatarInk).toBe(token("avatar-ink"));
    OG.avatars.forEach((color, i) => expect(color).toBe(token(`avatar-${i}`)));
  });
});

describe("roomTitleSize", () => {
  it("короткое название — крупно, длинное — мельче", () => {
    expect(roomTitleSize("Катка")).toBe(96);
    expect(roomTitleSize("Вечерняя катка в клубе")).toBe(76);
    expect(roomTitleSize("Закрытая тусовка с очень длинным названием")).toBe(60);
  });
});
