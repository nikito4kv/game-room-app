import { describe, expect, it } from "vitest";
import { presentFile, presentHttps, presentTurn, presentWs } from "./present";
import {
  deadFile,
  deadTurn,
  deadVoice,
  goodTurn,
  goodVoice,
  okFile,
  skippedFile,
  stalledFile,
} from "./testkit";

describe("presentFile", () => {
  it("замерзло: красная метка и слова про 16 КБ из 300 КБ", () => {
    const v = presentFile(stalledFile(2, 16 * 1024));
    expect(v).toMatchObject({ tone: "bad", badge: "Замерзло" });
    expect(v.detail).toBe("получено 16 КБ из 300 КБ, потом тишина 5 с");
  });

  it("ок, нет ответа, медленно, 404, пропуск", () => {
    expect(presentFile(okFile(0)).tone).toBe("ok");
    expect(presentFile(deadFile(0))).toMatchObject({ tone: "bad", badge: "Нет ответа" });
    expect(presentFile(okFile(3, { status: "timeout", receivedBytes: 300 * 1024, totalMs: 10_000 }))).toMatchObject({
      tone: "warn",
      badge: "Медленно",
    });
    expect(presentFile(okFile(0, { status: "error", receivedBytes: 0, httpStatus: 404 }))).toMatchObject({
      tone: "bad",
      detail: "сайт ответил кодом 404",
    });
    expect(presentFile(skippedFile(1)).tone).toBe("skip");
  });
});

describe("presentHttps и presentWs", () => {
  it("rtc ответил, WebSocket отказал без токена: обе строки зелёные", () => {
    expect(presentHttps(goodVoice()).tone).toBe("ok");
    const ws = presentWs(goodVoice());
    expect(ws.tone).toBe("ok");
    expect(ws.detail).toMatch(/без токена/);
  });

  it("rtc молчит: обе строки красные", () => {
    expect(presentHttps(deadVoice())).toMatchObject({ tone: "bad", badge: "Нет ответа" });
    expect(presentWs(deadVoice())).toMatchObject({ tone: "bad", badge: "Нет ответа" });
  });
});

describe("presentTurn", () => {
  it("ответил, молчит, браузер не умеет", () => {
    expect(presentTurn(goodTurn()).tone).toBe("ok");
    expect(presentTurn(deadTurn())).toMatchObject({ tone: "bad", badge: "Нет ответа" });
    expect(presentTurn(goodTurn({ status: "unsupported" }))).toMatchObject({ tone: "skip" });
  });
});
