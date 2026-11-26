import { describe, expect, it } from "vitest";
import { SOUND_FILE_MAX_BYTES, SOUND_NAME_MAX } from "@/lib/api/contract";
import { cleanSoundName, customSoundId, parseSoundUpload, sniffAudio } from "./roomSounds";

const pad = (head: number[] | string, total = 64) => {
  const b = Buffer.alloc(total);
  if (typeof head === "string") b.write(head, "latin1");
  else Buffer.from(head).copy(b);
  return b;
};
const b64 = (b: Buffer) => b.toString("base64");

describe("файл звука комнаты", () => {
  it("тип по первым байтам: mp3, ogg, wav, m4a, webm", () => {
    expect(sniffAudio(pad("ID3"))).toBe("audio/mpeg");
    expect(sniffAudio(pad([0xff, 0xfb, 0x90, 0x00]))).toBe("audio/mpeg");
    expect(sniffAudio(pad("OggS"))).toBe("audio/ogg");
    const wav = pad("RIFF");
    wav.write("WAVE", 8, "latin1");
    expect(sniffAudio(wav)).toBe("audio/wav");
    const m4a = pad("");
    m4a.write("ftyp", 4, "latin1");
    expect(sniffAudio(m4a)).toBe("audio/mp4");
    expect(sniffAudio(pad([0x1a, 0x45, 0xdf, 0xa3]))).toBe("audio/webm");
  });

  it("не аудио — null: картинка, html, скрипт, пустое, короткое", () => {
    expect(sniffAudio(pad([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(sniffAudio(pad("<html><script>"))).toBeNull();
    expect(sniffAudio(pad("MZ"))).toBeNull();
    expect(sniffAudio(Buffer.alloc(0))).toBeNull();
    expect(sniffAudio(Buffer.from("ID3"))).toBeNull();
    // 0xFFE0 без слоя mp3 (биты слоя 00) — не кадр.
    expect(sniffAudio(pad([0xff, 0xf8, 0x00, 0x00]))).toBeNull();
  });

  it("название: без управляющих и разворота строки, пробелы схлопнуты, не длиннее лимита", () => {
    expect(cleanSoundName("  Ба-дум\u202e  тсс\u0007 ")).toBe("Ба-дум тсс");
    expect([...cleanSoundName("я".repeat(80))]).toHaveLength(SOUND_NAME_MAX);
    expect(cleanSoundName("🔥".repeat(40))).toBe("🔥".repeat(SOUND_NAME_MAX));
    expect(cleanSoundName("\u0007 \n")).toBe("");
  });

  it("загрузка: нормальный mp3 принят, id по содержимому", () => {
    const mp3 = pad("ID3", 2048);
    const up = parseSoundUpload({ name: " Вайн бум ", data: b64(mp3) });
    expect(up).toMatchObject({ name: "Вайн бум", mime: "audio/mpeg" });
    expect(up?.data.equals(mp3)).toBe(true);
    expect(customSoundId(mp3)).toMatch(/^c_[0-9a-f]{12}$/);
    expect(customSoundId(mp3)).toBe(customSoundId(Buffer.from(mp3)));
    expect(customSoundId(pad("ID3", 2049))).not.toBe(customSoundId(mp3));
  });

  it("загрузка: нет названия, не base64, не аудио, слишком большое — null", () => {
    const mp3 = b64(pad("ID3", 1024));
    expect(parseSoundUpload({ name: "", data: mp3 })).toBeNull();
    expect(parseSoundUpload({ data: mp3 })).toBeNull();
    expect(parseSoundUpload({ name: "x", data: "не base64!" })).toBeNull();
    expect(parseSoundUpload({ name: "x", data: b64(pad("<html>", 1024)) })).toBeNull();
    expect(parseSoundUpload({ name: "x", data: b64(pad("ID3", SOUND_FILE_MAX_BYTES + 1)) })).toBeNull();
    expect(parseSoundUpload({ name: "x", data: b64(pad("ID3", SOUND_FILE_MAX_BYTES)) })).not.toBeNull();
    expect(parseSoundUpload({ name: 5, data: 5 })).toBeNull();
  });
});
