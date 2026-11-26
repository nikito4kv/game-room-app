import { describe, expect, it } from "vitest";
import { VOICE_ATTRIBUTES, parseVoiceAttributes } from "@/lib/api/contract";
import { parseVoiceState, voiceAttributes } from "./voice";

describe("parseVoiceState", () => {
  it("оба флага строго boolean", () => {
    expect(parseVoiceState({ deafened: true, ptt: false })).toEqual({ deafened: true, ptt: false });
    expect(parseVoiceState({ deafened: "true", ptt: false })).toBeNull();
    expect(parseVoiceState({ deafened: true })).toBeNull();
    expect(parseVoiceState({ deafened: 1, ptt: 0 })).toBeNull();
  });

  it("лишние поля тела не попадают в состояние", () => {
    expect(parseVoiceState({ deafened: false, ptt: true, identity: "u_чужой" })).toEqual({
      deafened: false,
      ptt: true,
    });
  });
});

describe("voiceAttributes ↔ parseVoiceAttributes", () => {
  it("да — «1», нет — пустая строка (LiveKit удаляет такой ключ)", () => {
    expect(voiceAttributes({ deafened: true, ptt: false })).toEqual({
      [VOICE_ATTRIBUTES.deafened]: "1",
      [VOICE_ATTRIBUTES.ptt]: "",
    });
  });

  it("туда и обратно — то же состояние", () => {
    for (const deafened of [false, true]) {
      for (const ptt of [false, true]) {
        const attrs = Object.fromEntries(
          Object.entries(voiceAttributes({ deafened, ptt })).filter(([, v]) => v !== ""),
        );
        expect(parseVoiceAttributes(attrs)).toEqual({ deafened, ptt });
      }
    }
  });

  it("чего нет или что не «1» — false; чужие ключи не мешают", () => {
    expect(parseVoiceAttributes(undefined)).toEqual({ deafened: false, ptt: false });
    expect(parseVoiceAttributes({ [VOICE_ATTRIBUTES.deafened]: "true", other: "1" })).toEqual({
      deafened: false,
      ptt: false,
    });
  });
});
