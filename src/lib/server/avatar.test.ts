import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { AVATAR_MAX_BYTES, isAvatarId, parseAvatarAttribute } from "@/lib/api/contract";
import { ipNet } from "@/lib/ratelimit";
import { avatarIdOf, avatarIdOfParticipant, checkAvatarPng, parseAvatarBody } from "./avatar";
import { PNG_SIGNATURE, noisyPng, pngChunk, testPng } from "./testPng";

// Распаковку подглядываем: «бомба» должна обрываться на потолке, а не распаковываться целиком.
vi.mock("node:zlib", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:zlib")>();
  return { ...real, inflateSync: vi.fn(real.inflateSync) };
});

const problem = (buf: Buffer) => {
  const r = checkAvatarPng(buf);
  return r.ok ? "ok" : r.problem;
};
const chunkTypes = (buf: Buffer) => {
  const out: string[] = [];
  for (let off = 8; off < buf.length; off += 12 + buf.readUInt32BE(off)) out.push(buf.toString("latin1", off + 4, off + 8));
  return out;
};

describe("checkAvatarPng: настоящий PNG 286×240", () => {
  it("обычный рисунок с канвы проходит как есть", () => {
    const png = testPng();
    const r = checkAvatarPng(png);
    expect(r.ok).toBe(true);
    expect(r.ok && r.png).toBe(png);
    // RGB без прозрачности тоже PNG.
    expect(problem(testPng({ color: 2 }))).toBe("ok");
  });

  it("другой размер — size", () => {
    expect(problem(testPng({ width: 572, height: 480 }))).toBe("size");
    expect(problem(testPng({ width: 240, height: 286 }))).toBe("size");
  });

  it("анимация (APNG: acTL, fcTL, fdAT) — animated", () => {
    const actl = Buffer.alloc(8);
    actl.writeUInt32BE(2, 0);
    expect(problem(testPng({ before: [pngChunk("acTL", actl)] }))).toBe("animated");
    expect(problem(testPng({ after: [pngChunk("fdAT", Buffer.alloc(8))] }))).toBe("animated");
  });

  it("не PNG — not_png; больше AVATAR_MAX_BYTES — too_big", () => {
    expect(problem(Buffer.from("GIF89a……"))).toBe("not_png");
    expect(problem(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(100)]))).toBe("not_png");
    expect(problem(PNG_SIGNATURE)).toBe("not_png");
    expect(problem(testPng({ trailing: Buffer.alloc(AVATAR_MAX_BYTES) }))).toBe("too_big");
  });

  it("битый файл — broken: CRC, хвост после IEND, порядок чанков, данные", () => {
    const png = testPng();
    const badCrc = Buffer.from(png);
    badCrc[40] ^= 0xff; // байт внутри IDAT
    expect(problem(badCrc)).toBe("broken");
    expect(problem(testPng({ trailing: Buffer.from("<script>") }))).toBe("broken");
    expect(problem(png.subarray(0, png.length - 12))).toBe("broken"); // без IEND
    // IDAT раньше IHDR.
    const idatFirst = Buffer.concat([PNG_SIGNATURE, pngChunk("IDAT", deflateSync(Buffer.alloc(10))), png.subarray(8)]);
    expect(problem(idatFirst)).toBe("broken");
    // Неизвестный критический чанк.
    expect(problem(testPng({ before: [pngChunk("ABCD", Buffer.alloc(4))] }))).toBe("broken");
    // Сжатые данные не того размера или вовсе не zlib.
    expect(problem(testPng({ idat: deflateSync(Buffer.alloc(100)) }))).toBe("broken");
    expect(problem(testPng({ idat: Buffer.from("это не zlib") }))).toBe("broken");
    // Фильтр строки вне 0–4.
    const row = 1 + 286 * 4;
    const raw = Buffer.alloc(row * 240);
    raw[row * 3] = 9;
    expect(problem(testPng({ idat: deflateSync(raw) }))).toBe("broken");
    // Чересстрочный.
    expect(problem(testPng({ interlace: 1 }))).toBe("broken");
  });

  it("лишние чанки (текст, EXIF, метки) выкидываются; id считается по очищенному", () => {
    const plain = testPng();
    const noisy = testPng({
      before: [pngChunk("tEXt", Buffer.from("Comment\0секрет", "utf8")), pngChunk("sRGB", Buffer.from([0]))],
      after: [pngChunk("eXIf", Buffer.alloc(16)), pngChunk("iDOT", Buffer.alloc(28))],
    });
    const r = checkAvatarPng(noisy);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(chunkTypes(r.png)).toEqual(["IHDR", "sRGB", "IDAT", "IEND"]);
    expect(problem(r.png)).toBe("ok");
    expect(avatarIdOf(r.png)).not.toBe(avatarIdOf(plain)); // sRGB остался — это другой файл
  });

  it("шум, который не сжимается, упирается в размер", () => {
    expect(problem(noisyPng())).toBe("too_big");
  });

  it("IDAT, который распаковывается в мегабайты, обрывается на размере картинки (maxOutputLength)", () => {
    // 24 МБ нулей сжимаются в ~24 КБ: файл проходит потолок размера, а распаковка — нет.
    const bomb = deflateSync(Buffer.alloc(24 * 1024 * 1024));
    const png = testPng({ idat: bomb });
    expect(png.length).toBeLessThan(AVATAR_MAX_BYTES);
    const inflate = vi.mocked(inflateSync);
    inflate.mockClear();
    expect(problem(png)).toBe("broken");
    const expected = (1 + 286 * 4) * 240;
    expect(inflate).toHaveBeenCalledTimes(1);
    expect(inflate.mock.calls[0]![1]).toEqual({ maxOutputLength: expected + 1 });
    // Упала на потолке — 24 МБ в память так и не легли.
    expect(inflate.mock.results[0]!.type).toBe("throw");
  });
});

describe("сеть адреса для лимитов рисунков (ipNet)", () => {
  it("IPv4 — как есть; IPv6 — /64 в одном написании", () => {
    expect(ipNet("10.0.0.9")).toBe("10.0.0.9");
    expect(ipNet("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(ipNet("2001:0DB8:0001:0002::1")).toBe("2001:db8:1:2::/64");
    expect(ipNet("[2001:db8::1]")).toBe("2001:db8:0:0::/64");
    expect(ipNet("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(ipNet("::1")).toBe("0:0:0:0::/64");
  });

  it("IPv4 внутри IPv6 — как IPv4; не адрес — как есть", () => {
    expect(ipNet("::ffff:192.0.2.7")).toBe("192.0.2.7");
    expect(ipNet("::ffff:c000:207")).toBe("192.0.2.7");
    expect(ipNet("local")).toBe("local");
    expect(ipNet("1:2:3")).toBe("1:2:3");
    expect(ipNet("1::2::3")).toBe("1::2::3");
    expect(ipNet("::ffff:300.1.1.1")).toBe("::ffff:300.1.1.1");
  });
});

describe("parseAvatarBody", () => {
  it("null — снять; base64 PNG — проверенный файл", () => {
    expect(parseAvatarBody({ png: null })).toEqual({ ok: true, png: null });
    const png = testPng();
    const r = parseAvatarBody({ png: png.toString("base64") });
    expect(r.ok && r.png?.equals(png)).toBe(true);
  });

  it("нет поля, не строка, пусто — bad_request; не base64 или data URL — not_png", () => {
    expect(parseAvatarBody({})).toEqual({ ok: false, problem: "bad_request" });
    expect(parseAvatarBody({ png: 42 })).toEqual({ ok: false, problem: "bad_request" });
    expect(parseAvatarBody({ png: "" })).toEqual({ ok: false, problem: "bad_request" });
    expect(parseAvatarBody({ png: "не base64!" })).toEqual({ ok: false, problem: "not_png" });
    expect(parseAvatarBody({ png: `data:image/png;base64,${testPng().toString("base64")}` })).toEqual({
      ok: false,
      problem: "not_png",
    });
  });

  it("строка длиннее, чем base64 от AVATAR_MAX_BYTES, — too_big без декодирования", () => {
    expect(parseAvatarBody({ png: "A".repeat(Math.ceil(AVATAR_MAX_BYTES / 3) * 4 + 4) })).toEqual({
      ok: false,
      problem: "too_big",
    });
  });
});

describe("id рисунка", () => {
  it("16 символов base64url, одинаковое содержимое — одинаковый id", () => {
    const a = avatarIdOf(testPng());
    expect(isAvatarId(a)).toBe(true);
    expect(a).toHaveLength(16);
    expect(avatarIdOf(testPng())).toBe(a);
    expect(avatarIdOf(testPng({ fill: [10, 200, 30] }))).not.toBe(a);
  });

  it("атрибут: клиент видит avatar.id, сервер — avatarId (camelCase SDK); кривой — null", () => {
    const id = avatarIdOf(testPng());
    expect(parseAvatarAttribute({ "avatar.id": id })).toBe(id);
    expect(parseAvatarAttribute({ "avatar.id": "../../etc/passwd" })).toBeNull();
    expect(parseAvatarAttribute(undefined)).toBeNull();
    expect(avatarIdOfParticipant({ attributes: { avatarId: id } })).toBe(id);
    expect(avatarIdOfParticipant({ attributes: { "avatar.id": id } })).toBe(id);
    expect(avatarIdOfParticipant({ attributes: { avatarId: "x" } })).toBeNull();
  });
});
