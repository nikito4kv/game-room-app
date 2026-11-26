import { describe, expect, it } from "vitest";
import { checkNickname, cleanDisplayText, nicknameKey, suggestNickname } from "./nickname";

describe("cleanDisplayText", () => {
  it("NFKC: полноширинные и «стилизованные» буквы становятся обычными", () => {
    expect(cleanDisplayText("Ｖａｓｙａ")).toBe("Vasya");
    expect(cleanDisplayText("𝐕𝐚𝐬𝐲𝐚")).toBe("Vasya");
  });

  it("вырезает нулевую ширину, управление направлением, BOM и мягкий перенос", () => {
    expect(cleanDisplayText("Ва​ся")).toBe("Вася");
    expect(cleanDisplayText("‮Вася‬")).toBe("Вася");
    expect(cleanDisplayText("﻿Ва­ся⁦")).toBe("Вася");
  });

  it("вырезает управляющие символы и «пустые» буквы-невидимки", () => {
    expect(cleanDisplayText("Ва\nся\t")).toBe("Вася");
    expect(cleanDisplayText("ㅤㅤ")).toBe("");
    expect(cleanDisplayText("Вася⠀")).toBe("Вася");
  });

  it("схлопывает и обрезает пробелы любого вида", () => {
    expect(cleanDisplayText("  Вася  　 Пупкин  ")).toBe("Вася Пупкин");
  });

  it("гасит «залго»: не больше двух диакритик подряд", () => {
    const zalgo = "á̂̃̄̅";
    expect(cleanDisplayText(zalgo)).toBe("á̂".normalize("NFKC"));
  });

  it("эмодзи оставляет", () => {
    expect(cleanDisplayText("Вася 🎮")).toBe("Вася 🎮");
  });
});

describe("checkNickname", () => {
  it("обычный ник проходит и возвращается очищенным", () => {
    expect(checkNickname("  Аня ")).toEqual({ ok: true, name: "Аня" });
  });

  it("пустой, короче 2 и длиннее 24 — отказ с причиной", () => {
    expect(checkNickname("")).toEqual({ ok: false, reason: "empty" });
    expect(checkNickname("​​")).toEqual({ ok: false, reason: "empty" });
    expect(checkNickname(42)).toEqual({ ok: false, reason: "empty" });
    expect(checkNickname("Я")).toEqual({ ok: false, reason: "too_short" });
    expect(checkNickname("x".repeat(25))).toEqual({ ok: false, reason: "too_long" });
    expect(checkNickname("x".repeat(1000))).toEqual({ ok: false, reason: "too_long" });
  });

  it("длина — в кодовых точках: 24 эмодзи помещаются", () => {
    expect(checkNickname("🎮".repeat(24)).ok).toBe(true);
    expect(checkNickname("🎮".repeat(25)).ok).toBe(false);
  });

  it("невидимые символы не помогают обойти минимум длины", () => {
    expect(checkNickname("Я​​​")).toEqual({ ok: false, reason: "too_short" });
  });
});

describe("nicknameKey", () => {
  it("регистр, невидимые символы и диакритика не различаются", () => {
    const k = nicknameKey("Вася");
    expect(nicknameKey("ВАСЯ")).toBe(k);
    expect(nicknameKey("вася")).toBe(k);
    expect(nicknameKey("Ва​ся")).toBe(k);
    expect(nicknameKey("Ёж")).toBe(nicknameKey("Еж"));
  });

  it("латинские двойники кириллицы дают тот же ключ (регистр не различаем: «М» как «M»)", () => {
    // B, a, c — латиница; я — кириллица
    expect(nicknameKey("Bacя")).toBe(nicknameKey("Вася"));
    expect(nicknameKey("TOP")).toBe(nicknameKey("ТОР"));
    expect(nicknameKey("Kot")).toBe(nicknameKey("Кот"));
    expect(nicknameKey("POMA")).toBe(nicknameKey("Рома"));
  });

  it("разные ники различаются", () => {
    expect(nicknameKey("Вася")).not.toBe(nicknameKey("Петя"));
    expect(nicknameKey("Рома")).not.toBe(nicknameKey("Роза"));
  });
});

describe("suggestNickname", () => {
  const takenBy = (...names: string[]) => {
    const keys = new Set(names.map(nicknameKey));
    return (candidate: string) => keys.has(nicknameKey(candidate));
  };

  it("предлагает первый свободный номер", () => {
    expect(suggestNickname("Вася", takenBy("Вася"))).toBe("Вася 2");
    expect(suggestNickname("Вася", takenBy("Вася", "Вася 2", "вася 3"))).toBe("Вася 4");
  });

  it("не наращивает хвостовой номер дважды", () => {
    expect(suggestNickname("Вася 2", takenBy("Вася 2"))).toBe("Вася 3");
  });

  it("укладывается в 24 символа", () => {
    const long = "Абвгдеёжзийклмнопрстуфхц"; // 24
    const s = suggestNickname(long, takenBy(long));
    expect([...s].length).toBeLessThanOrEqual(24);
    expect(s.endsWith(" 2")).toBe(true);
  });
});
