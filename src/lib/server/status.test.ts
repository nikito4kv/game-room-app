import { describe, expect, it } from "vitest";
import { STATUS_ATTRIBUTES, STATUS_TEXT_MAX, cleanStatusText, parseStatusAttributes } from "@/lib/api/contract";
import { parseStatus, statusAttributes } from "./status";

describe("статус участника", () => {
  it("разбор тела: известный статус или null; текст — только у «В игре»", () => {
    expect(parseStatus({ kind: "game", text: "  CS2  " })).toEqual({ kind: "game", text: "CS2" });
    expect(parseStatus({ kind: "afk", text: "обед" })).toEqual({ kind: "afk", text: "" });
    expect(parseStatus({ kind: "listen" })).toEqual({ kind: "listen", text: "" });
    expect(parseStatus({ kind: null, text: "CS2" })).toEqual({ kind: null, text: "" });
  });

  it("мусор — null", () => {
    for (const body of [{}, { kind: "busy" }, { kind: "game", text: 5 }, { kind: undefined }, { kind: "toString" }]) {
      expect(parseStatus(body)).toBeNull();
    }
  });

  it("текст чистится: управляющие и разворот строки, пробелы, длина", () => {
    expect(cleanStatusText("Dota\u202e 2\u0007")).toBe("Dota 2");
    expect(cleanStatusText("a \n\t b")).toBe("a b");
    expect([...cleanStatusText("я".repeat(100))]).toHaveLength(STATUS_TEXT_MAX);
    // Эмодзи считаются целиком, не половинками.
    expect(cleanStatusText("🎮".repeat(30))).toBe("🎮".repeat(STATUS_TEXT_MAX));
  });

  it("атрибуты: оба ключа, пустое — снять", () => {
    expect(statusAttributes({ kind: "game", text: "CS2" })).toEqual({
      [STATUS_ATTRIBUTES.kind]: "game",
      [STATUS_ATTRIBUTES.text]: "CS2",
    });
    expect(statusAttributes({ kind: null, text: "" })).toEqual({
      [STATUS_ATTRIBUTES.kind]: "",
      [STATUS_ATTRIBUTES.text]: "",
    });
  });

  it("чтение атрибутов: чужое — без статуса, текст без «В игре» не показываем", () => {
    expect(parseStatusAttributes({ "status.kind": "game", "status.text": "Valorant" })).toEqual({
      kind: "game",
      text: "Valorant",
    });
    expect(parseStatusAttributes({ "status.kind": "afk", "status.text": "x" })).toEqual({ kind: "afk", text: "" });
    expect(parseStatusAttributes({ "status.kind": "sleep" })).toEqual({ kind: null, text: "" });
    expect(parseStatusAttributes(undefined)).toEqual({ kind: null, text: "" });
  });
});
