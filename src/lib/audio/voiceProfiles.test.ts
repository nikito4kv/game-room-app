import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isVoiceProfiles,
  loadVoiceProfile,
  plausibleProfile,
  profileKey,
  saveVoiceProfile,
  upsertProfile,
  type VoiceProfile,
} from "./voiceProfiles";

// Окружение тестов — node: localStorage подменяем простой картой.
function stubStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  return map;
}

const p = (voiceDb: number, savedAt: number, noiseDb: number | null = -60): VoiceProfile => ({ voiceDb, noiseDb, savedAt });

describe("profileKey", () => {
  it("по физическому устройству: groupId, а без него — deviceId", () => {
    expect(profileKey({ deviceId: "default", groupId: "g-hx" })).toBe("g-hx");
    expect(profileKey({ deviceId: "mic-hx", groupId: "" })).toBe("mic-hx");
    expect(profileKey({})).toBeNull();
  });
});

describe("plausibleProfile", () => {
  it("голос в разумных пределах и громче фона", () => {
    expect(plausibleProfile(-22, -58)).toBe(true);
    expect(plausibleProfile(-22, NaN)).toBe(true);
    expect(plausibleProfile(NaN, -60)).toBe(false);
    expect(plausibleProfile(-80, -90)).toBe(false);
    expect(plausibleProfile(-30, -20)).toBe(false);
  });
});

describe("upsertProfile", () => {
  it("обновляет и держит только самые свежие", () => {
    let map = {};
    for (let i = 0; i < 10; i++) map = upsertProfile(map, `m${i}`, p(-20 - i, i), 8);
    expect(Object.keys(map)).toHaveLength(8);
    expect(map).not.toHaveProperty("m0");
    expect(map).toHaveProperty("m9");
    map = upsertProfile(map, "m2", p(-30, 100), 8);
    expect((map as Record<string, VoiceProfile>).m2.voiceDb).toBe(-30);
  });
});

describe("хранение", () => {
  beforeEach(() => {
    stubStorage();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("сохраняет правдоподобное (округлив) и читает обратно", () => {
    expect(saveVoiceProfile("g-hx", -21.37, -57.81, 1000)).toBe(true);
    expect(loadVoiceProfile("g-hx")).toEqual({ voiceDb: -21.4, noiseDb: -57.8, savedAt: 1000 });
  });
  it("фон неизвестен — null вместо NaN (JSON не умеет NaN)", () => {
    saveVoiceProfile("g-cam", -25, NaN, 1);
    expect(loadVoiceProfile("g-cam")?.noiseDb).toBeNull();
  });
  it("мусор не сохраняется и не читается", () => {
    expect(saveVoiceProfile("g-x", NaN, -60)).toBe(false);
    expect(loadVoiceProfile("g-x")).toBeNull();
    localStorage.setItem("gr.audio.voiceProfiles", '{"g-y":{"voiceDb":"громко"}}');
    expect(loadVoiceProfile("g-y")).toBeNull();
    expect(isVoiceProfiles({ a: p(-20, 1) })).toBe(true);
    expect(isVoiceProfiles([p(-20, 1)])).toBe(false);
  });
});
