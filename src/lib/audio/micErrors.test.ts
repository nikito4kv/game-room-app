import { describe, expect, it } from "vitest";
import { classifyMicError, isMicError, micError, toMicError } from "./micErrors";

const err = (name: string, extra: Record<string, unknown> = {}) => Object.assign(new Error("x"), { name, ...extra });

describe("classifyMicError", () => {
  it("нет разрешения", () => {
    expect(classifyMicError(err("NotAllowedError"))).toBe("denied");
    expect(classifyMicError(err("PermissionDeniedError"))).toBe("denied");
    expect(classifyMicError(err("SecurityError"))).toBe("denied");
  });
  it("микрофона нет", () => {
    expect(classifyMicError(err("NotFoundError"))).toBe("not-found");
    expect(classifyMicError(err("DevicesNotFoundError"))).toBe("not-found");
  });
  it("занят другой программой (частое на Windows)", () => {
    expect(classifyMicError(err("NotReadableError"))).toBe("busy");
    expect(classifyMicError(err("TrackStartError"))).toBe("busy");
    expect(classifyMicError(err("AbortError"))).toBe("busy");
  });
  it("OverconstrainedError по deviceId — устройство пропало, иначе — настройки", () => {
    expect(classifyMicError(err("OverconstrainedError", { constraint: "deviceId" }))).toBe("not-found");
    expect(classifyMicError(err("OverconstrainedError", { constraint: "sampleRate" }))).toBe("constraints");
  });
  it("всё прочее и мусор — unknown, не падает", () => {
    expect(classifyMicError(err("TypeError"))).toBe("unknown");
    expect(classifyMicError("строка")).toBe("unknown");
    expect(classifyMicError(null)).toBe("unknown");
    expect(classifyMicError({ name: 42 })).toBe("unknown");
  });
});

describe("тексты ошибок", () => {
  it("у каждого вида свой понятный заголовок и «вас не слышно»", () => {
    const kinds = ["denied", "not-found", "busy", "constraints", "unknown"] as const;
    const titles = new Set(kinds.map((k) => micError(k).title));
    expect(titles.size).toBe(kinds.length);
    for (const k of kinds) expect(micError(k).description).toMatch(/Вас не слышно/);
  });
  it("toMicError даёт готовую ошибку, isMicError её узнаёт", () => {
    const e = toMicError(err("NotReadableError"));
    expect(e.kind).toBe("busy");
    expect(e.title).toBe("Микрофон занят");
    expect(isMicError(e)).toBe(true);
    expect(isMicError(new Error("x"))).toBe(false);
    expect(isMicError(null)).toBe(false);
  });
});
