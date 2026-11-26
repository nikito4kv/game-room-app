import { describe, expect, it } from "vitest";
import { checkChatPolicy, validateChatText } from "./chatRules";

describe("validateChatText", () => {
  it("обычный текст — как есть, без пробелов по краям", () => {
    expect(validateChatText("  привет  ")).toEqual({ ok: true, text: "привет" });
  });

  it("вырезает управляющие символы, кроме перевода строки", () => {
    expect(validateChatText("при\u0000в\u0007ет\nмир\t!")).toEqual({ ok: true, text: "привет\nмир!" });
  });

  it("вырезает переворот текста (RLO и изоляторы), эмодзи с ZWJ оставляет", () => {
    expect(validateChatText("‮текст‬")).toEqual({ ok: true, text: "текст" });
    const family = "👨‍👩‍👧";
    expect(validateChatText(family)).toEqual({ ok: true, text: family });
  });

  it("\\r\\n → \\n, 3+ переводов строки → 2", () => {
    expect(validateChatText("a\r\n\r\n\r\n\r\nb")).toEqual({ ok: true, text: "a\n\nb" });
  });

  it("пустое после чистки — MESSAGE_EMPTY", () => {
    const r = validateChatText(" \u0000\n ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("MESSAGE_EMPTY");
  });

  it("500 символов можно, 501 — MESSAGE_TOO_LONG; огромный ввод режется сразу", () => {
    expect(validateChatText("я".repeat(500)).ok).toBe(true);
    const long = validateChatText("я".repeat(501));
    expect(!long.ok && long.error.code).toBe("MESSAGE_TOO_LONG");
    const huge = validateChatText("я".repeat(100_000));
    expect(!huge.ok && huge.error.code).toBe("MESSAGE_TOO_LONG");
  });

  it("длина — в кодовых точках: 500 эмодзи помещаются", () => {
    expect(validateChatText("😀".repeat(500)).ok).toBe(true);
  });

  it("не строка — BAD_REQUEST", () => {
    const r = validateChatText(42);
    expect(!r.ok && r.error.code).toBe("BAD_REQUEST");
  });
});

describe("checkChatPolicy", () => {
  const guest = { isHost: false, chatMuted: false };
  const host = { isHost: true, chatMuted: false };

  it("все пишут", () => {
    expect(checkChatPolicy("all", guest)).toBeNull();
  });

  it("выключен — никто, даже хост", () => {
    expect(checkChatPolicy("off", guest)?.code).toBe("CHAT_DISABLED");
    expect(checkChatPolicy("off", host)?.code).toBe("CHAT_DISABLED");
  });

  it("только хост", () => {
    expect(checkChatPolicy("host", guest)?.code).toBe("CHAT_HOST_ONLY");
    expect(checkChatPolicy("host", host)).toBeNull();
  });

  it("персональный запрет; хосту он не мешает", () => {
    expect(checkChatPolicy("all", { ...guest, chatMuted: true })?.code).toBe("CHAT_MUTED");
    expect(checkChatPolicy("all", { ...host, chatMuted: true })).toBeNull();
  });
});
