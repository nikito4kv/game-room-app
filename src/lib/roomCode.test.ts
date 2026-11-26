import { describe, expect, it } from "vitest";
import { generateRoomCode } from "@/lib/livekit";
import { ROOM_CODE_ALPHABET, cleanRoomCodeInput, isRoomCode } from "./roomCode";

const code = (input: string) => cleanRoomCodeInput(input).code;

describe("isRoomCode", () => {
  it("6 символов из алфавита — код", () => {
    expect(isRoomCode("K7QMP4")).toBe(true);
  });

  it("нижний регистр, длина и похожие символы — не код", () => {
    expect(isRoomCode("k7qmp4")).toBe(false);
    expect(isRoomCode("K7QMP")).toBe(false);
    expect(isRoomCode("K7QMP44")).toBe(false);
    expect(isRoomCode("K0QMP4")).toBe(false);
    expect(isRoomCode("KLQMP4")).toBe(false);
  });

  it("алфавит совпадает с серверным генератором кодов", () => {
    for (let i = 0; i < 500; i++) expect(isRoomCode(generateRoomCode())).toBe(true);
    for (const ch of "OIL01") expect(ROOM_CODE_ALPHABET).not.toContain(ch);
  });
});

describe("cleanRoomCodeInput: ссылки", () => {
  it("достаёт код из вставленной ссылки", () => {
    expect(cleanRoomCodeInput("https://club.game-room.space/room/k7qmp4")).toEqual({
      code: "K7QMP4",
      note: null,
    });
  });

  it("ссылка без протокола, с query и хэшем", () => {
    expect(code("club.game-room.space/room/K7QMP4")).toBe("K7QMP4");
    expect(code("https://game-room.space/room/K7QMP4?from=tg#chat")).toBe("K7QMP4");
    expect(code("/room/K7QMP4/")).toBe("K7QMP4");
  });

  it("ссылка внутри сообщения", () => {
    expect(code("го сюда https://club.game-room.space/room/K7QMP4 пароль 1234")).toBe("K7QMP4");
  });

  it("кириллица в ссылке, в том числе закодированная", () => {
    expect(code("https://game-room.space/room/%D0%9A7QMP4")).toBe("K7QMP4");
    expect(code("https://game-room.space/room/к7qmp4")).toBe("K7QMP4");
  });

  it("ссылка не на комнату — пусто и подсказка", () => {
    expect(cleanRoomCodeInput("https://game-room.space/rooms")).toEqual({ code: "", note: "link" });
    expect(cleanRoomCodeInput("www.youtube.com")).toEqual({ code: "", note: "link" });
  });
});

describe("cleanRoomCodeInput: кириллица и регистр", () => {
  it("кириллическая «К» становится латинской", () => {
    expect(cleanRoomCodeInput("К7QMP4")).toEqual({ code: "K7QMP4", note: null });
  });

  it("все русские двойники, строчные и заглавные", () => {
    expect(code("кмр2се")).toBe("KMP2CE");
    expect(code("НАТВХУ")).toBe("HATBXY");
    expect(code("ёЁ")).toBe("EE");
  });

  it("нижний регистр латиницы — в верхний", () => {
    expect(code("k7qmp4")).toBe("K7QMP4");
  });

  it("полноширинные символы", () => {
    expect(code("Ｋ７ＱＭＰ４")).toBe("K7QMP4");
  });
});

describe("cleanRoomCodeInput: лишние символы", () => {
  it("пробелы, дефисы и решётка — молча", () => {
    expect(cleanRoomCodeInput(" #K7Q-MP4 ")).toEqual({ code: "K7QMP4", note: null });
    expect(code("K7Q MP4")).toBe("K7QMP4");
    expect(code("K7Q·MP4")).toBe("K7QMP4");
  });

  it("не длиннее 6 символов", () => {
    expect(code("K7QMP4ZZ")).toBe("K7QMP4");
  });

  it("0, O, 1, I, L выбрасываются с подсказкой", () => {
    expect(cleanRoomCodeInput("K0QMP4")).toEqual({ code: "KQMP4", note: "confusable" });
    expect(cleanRoomCodeInput("1L")).toEqual({ code: "", note: "confusable" });
    // Кириллическая «О» — двойник «O», которой в кодах тоже нет.
    expect(cleanRoomCodeInput("О")).toEqual({ code: "", note: "confusable" });
  });

  it("русские буквы без двойника — подсказка про раскладку", () => {
    // «K7QMP4», набранный на русской раскладке.
    expect(cleanRoomCodeInput("л7йьз4")).toEqual({ code: "74", note: "layout" });
  });

  it("прочие алфавиты", () => {
    expect(cleanRoomCodeInput("K7Ω")).toEqual({ code: "K7", note: "invalid" });
  });

  it("раскладка важнее остальных подсказок", () => {
    expect(cleanRoomCodeInput("0л")).toEqual({ code: "", note: "layout" });
  });
});

describe("cleanRoomCodeInput: сообщение целиком", () => {
  it("находит слово-код среди слов", () => {
    expect(code("Код: K7QMP4, пароль 1234")).toBe("K7QMP4");
  });

  it("слово с цифрой важнее похожего слова", () => {
    expect(code("THANKS K7QMP4")).toBe("K7QMP4");
  });

  it("код из двух половин", () => {
    expect(code("K7Q MP4")).toBe("K7QMP4");
  });

  it("пусто и пробелы", () => {
    expect(cleanRoomCodeInput("")).toEqual({ code: "", note: null });
    expect(cleanRoomCodeInput("   ")).toEqual({ code: "", note: null });
  });

  it("на чистом коде ничего не меняет", () => {
    for (const c of ["K7QMP4", "K7Q", "ABCDEF", "234567"]) expect(cleanRoomCodeInput(c)).toEqual({ code: c, note: null });
  });
});
