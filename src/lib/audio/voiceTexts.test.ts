import { describe, expect, it } from "vitest";
import type { MicStatus } from "./micProcessor";
import { calibrationText, noiseSuppressionText, sensitivityText } from "./voiceTexts";

const status = (state: MicStatus["state"], reason?: MicStatus["reason"]): MicStatus => ({
  state,
  reason,
  blocked: false,
});

describe("noiseSuppressionText", () => {
  it("выключен человеком — так и говорим", () => {
    expect(noiseSuppressionText({ enabled: false, status: status("ready"), waitingForGesture: false }).text).toMatch(
      /^Выключено/,
    );
  });
  it("ждёт клика — честно, что пока работает браузерный", () => {
    const t = noiseSuppressionText({ enabled: true, status: status("idle"), waitingForGesture: true });
    expect(t.tone).toBe("caution");
    expect(t.text).toMatch(/первого клика/);
  });
  it("сбой — работает встроенный в браузер, предупреждение", () => {
    for (const reason of ["worklet", "wasm", "timeout", "sample-rate"] as const) {
      const t = noiseSuppressionText({ enabled: true, status: status("error", reason), waitingForGesture: false });
      expect(t.tone).toBe("caution");
      expect(t.text).toMatch(/встроенный в браузер/);
    }
  });
  it("загрузка и работа", () => {
    expect(noiseSuppressionText({ enabled: true, status: status("loading"), waitingForGesture: false }).text).toBe(
      "Загружается…",
    );
    expect(noiseSuppressionText({ enabled: true, status: status("ready"), waitingForGesture: false }).tone).toBe(
      "normal",
    );
  });
});

describe("calibrationText", () => {
  const base = { voiceDb: -21.6, noiseDb: -58, thresholdDb: -32.4, speechMs: 2100 };
  it("успех — уровень голоса и порог", () => {
    expect(calibrationText({ ok: true, ...base }).text).toBe("Готово: ваш голос −22 дБ, порог −32 дБ");
  });
  it("неудачи — что сделать", () => {
    expect(calibrationText({ ok: false, reason: "no-speech", ...base }).text).toMatch(/Не услышали речь/);
    expect(calibrationText({ ok: false, reason: "too-quiet", ...base }).text).toMatch(/еле-еле/);
    expect(calibrationText({ ok: false, reason: "noisy", ...base }).text).toMatch(/шума/);
    expect(calibrationText({ ok: false, reason: "unavailable", ...base }).tone).toBe("caution");
  });
});

describe("sensitivityText", () => {
  it("знак и дБ, ноль — просто 0", () => {
    expect(sensitivityText(0)).toBe("0");
    expect(sensitivityText(3)).toBe("+3 дБ");
    expect(sensitivityText(-5)).toBe("−5 дБ");
    expect(sensitivityText(0.4)).toBe("0");
  });
});
