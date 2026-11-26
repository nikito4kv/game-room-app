import { describe, expect, it } from "vitest";
import { isVolumeMap, trackVolume, type VolumeMaps } from "./volume";

const maps = (over: Partial<VolumeMaps> = {}): VolumeMaps => ({
  master: 1,
  voice: {},
  stream: {},
  mutes: {},
  ...over,
});

describe("trackVolume", () => {
  it("по умолчанию — 100%", () => {
    expect(trackVolume(maps(), "Анна", "voice")).toBe(1);
    expect(trackVolume(maps(), "Анна", "stream")).toBe(1);
  });

  it("master умножается на персональную громкость", () => {
    const v = maps({ master: 0.5, voice: { Анна: 1.6 } });
    expect(trackVolume(v, "Анна", "voice")).toBeCloseTo(0.8);
    expect(trackVolume(v, "Борис", "voice")).toBeCloseTo(0.5);
  });

  it("звук демонстрации без своей настройки берёт громкость голоса", () => {
    const v = maps({ voice: { Анна: 1.5 } });
    expect(trackVolume(v, "Анна", "stream")).toBe(1.5);
  });

  it("своя громкость демонстрации не трогает голос", () => {
    const v = maps({ voice: { Анна: 1.5 }, stream: { Анна: 0.2 } });
    expect(trackVolume(v, "Анна", "stream")).toBe(0.2);
    expect(trackVolume(v, "Анна", "voice")).toBe(1.5);
  });

  it("«заглушить для себя» глушит и голос, и демонстрацию", () => {
    const v = maps({ voice: { Анна: 2 }, mutes: { Анна: true } });
    expect(trackVolume(v, "Анна", "voice")).toBe(0);
    expect(trackVolume(v, "Анна", "stream")).toBe(0);
  });

  it("мусор из хранилища не ломает звук", () => {
    expect(trackVolume(maps({ master: NaN }), "Анна", "voice")).toBe(1);
    expect(trackVolume(maps({ voice: { Анна: Infinity } }), "Анна", "voice")).toBe(1);
    expect(trackVolume(maps({ voice: { Анна: -3 } }), "Анна", "voice")).toBe(0);
  });
});

describe("isVolumeMap", () => {
  it("принимает объект «строка → число»", () => {
    expect(isVolumeMap({})).toBe(true);
    expect(isVolumeMap({ Анна: 0.5, Борис: 2 })).toBe(true);
  });

  it("отклоняет всё остальное", () => {
    expect(isVolumeMap(null)).toBe(false);
    expect(isVolumeMap([1, 2])).toBe(false);
    expect(isVolumeMap("x")).toBe(false);
    expect(isVolumeMap({ Анна: "громко" })).toBe(false);
  });
});
