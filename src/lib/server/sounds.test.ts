import { describe, expect, it } from "vitest";
import {
  ENTER_SOUND_ATTRIBUTE,
  BUILTIN_SOUND_IDS,
  isCustomSoundId,
  isSoundId,
  parseEnterSoundAttribute,
  parseSoundPacket,
} from "@/lib/api/contract";
import { enterSoundAttributes, parseSoundId, soundPacket } from "./sounds";

describe("разбор звука соундборда", () => {
  it("знает ровно восемь звуков, без повторов", () => {
    expect(BUILTIN_SOUND_IDS).toHaveLength(8);
    expect(new Set(BUILTIN_SOUND_IDS).size).toBe(BUILTIN_SOUND_IDS.length);
    for (const s of BUILTIN_SOUND_IDS) expect(parseSoundId({ sound: s })).toBe(s);
  });

  it("чужое и мусор — null", () => {
    for (const sound of ["RIMSHOT", "", " tada", "a", "../x", "x".repeat(40), 0, null, undefined, {}, ["fail"]]) {
      expect(parseSoundId({ sound })).toBeNull();
      expect(isSoundId(sound)).toBe(false);
    }
    // Имя свойства из прототипа — не звук.
    expect(isSoundId("toString")).toBe(false);
  });

  it("имена из набора и своих звуков комнаты принимаются по виду", () => {
    for (const id of ["airhorn", "vine-boom", "c_0123456789ab", "meme_01"]) expect(isSoundId(id)).toBe(true);
    expect(isCustomSoundId("c_0123456789ab")).toBe(true);
    for (const bad of ["c_xyz", "c_0123456789abc", "tada", "C_0123456789ab"]) expect(isCustomSoundId(bad)).toBe(false);
  });

  it("поле можно назвать иначе (звук входа в запросе токена)", () => {
    expect(parseSoundId({ enterSound: "tada" }, "enterSound")).toBe("tada");
    expect(parseSoundId({ sound: "tada" }, "enterSound")).toBeNull();
  });

  it("пакет: identity из аргумента, время сервера", () => {
    expect(soundPacket("u_a", "crickets", 123)).toEqual({ identity: "u_a", sound: "crickets", at: 123 });
  });

  it("пакет из сети: верный проходит, кривой — null", () => {
    expect(parseSoundPacket({ identity: "u_a", sound: "horn", at: 5 })).toEqual({
      identity: "u_a",
      sound: "horn",
      at: 5,
    });
    for (const raw of [
      null,
      "horn",
      [],
      { identity: "", sound: "horn", at: 5 },
      { identity: "u_a", sound: "BOO!", at: 5 },
      { identity: "u_a", sound: "horn", at: Number.NaN },
      { identity: "u_a", sound: "horn", at: "5" },
      { identity: 7, sound: "horn", at: 5 },
    ]) {
      expect(parseSoundPacket(raw)).toBeNull();
    }
  });
});

describe("звук входа в атрибутах", () => {
  it("есть звук — один атрибут; нет — атрибутов нет вовсе", () => {
    expect(enterSoundAttributes("tada")).toEqual({ [ENTER_SOUND_ATTRIBUTE]: "tada" });
    expect(enterSoundAttributes(null)).toBeUndefined();
  });

  it("читается обратно; чужое значение и пустые атрибуты — null", () => {
    expect(parseEnterSoundAttribute({ [ENTER_SOUND_ATTRIBUTE]: "applause" })).toBe("applause");
    expect(parseEnterSoundAttribute({ [ENTER_SOUND_ATTRIBUTE]: "BOO!" })).toBeNull();
    expect(parseEnterSoundAttribute({})).toBeNull();
    expect(parseEnterSoundAttribute(undefined)).toBeNull();
  });
});
