import { describe, expect, it } from "vitest";
import { encode } from "uqr";
import { qrPath } from "./QrCode";

describe("QR-код", () => {
  it("путь: по прямоугольнику на каждую тёмную полосу строки", () => {
    expect(
      qrPath([
        [true, true, false, true],
        [false, false, false, false],
        [false, true, true, true],
      ]),
    ).toBe("M0 0h2v1h-2zM3 0h1v1h-1zM1 2h3v1h-3z");
    expect(qrPath([[false, false]])).toBe("");
  });

  it("ссылка на комнату кодируется, тёмных модулей примерно половина", () => {
    const qr = encode("https://club.game-room.space/room/K7QMP4", { ecc: "M", border: 3 });
    const dark = qr.data.flat().filter(Boolean).length;
    const inner = (qr.size - 6) ** 2;
    expect(dark / inner).toBeGreaterThan(0.35);
    expect(dark / inner).toBeLessThan(0.65);
  });
});
