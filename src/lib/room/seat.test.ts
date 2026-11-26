import { describe, expect, it } from "vitest";
import {
  nameBudget,
  pipVisibleCount,
  remoteSeatVoice,
  seatLabel,
  seatStatus,
  seatStatusText,
  shortName,
  sortByJoin,
} from "./seat";

const voice = { forceMuted: false, deafened: false, pttIdle: false, micOff: false };

describe("seatStatus", () => {
  it("всё включено — значка нет", () => {
    expect(seatStatus(voice)).toBeNull();
  });

  it("приоритет: хост заглушил > звук выкл > рация > мьют", () => {
    const all = { forceMuted: true, deafened: true, pttIdle: true, micOff: true };
    expect(seatStatus(all)).toBe("forceMuted");
    expect(seatStatus({ ...all, forceMuted: false })).toBe("deafened");
    expect(seatStatus({ ...all, forceMuted: false, deafened: false })).toBe("ptt");
    expect(seatStatus({ ...voice, micOff: true })).toBe("muted");
  });

  it("рация в ожидании не выглядит как мьют, хотя трек заглушён", () => {
    expect(seatStatus({ ...voice, micOff: true, pttIdle: true })).toBe("ptt");
  });
});

describe("remoteSeatVoice — чужой голос по атрибутам", () => {
  const base = { forceMuted: false, micOff: false, deafened: false, ptt: false };

  it("рация ждёт клавишу — значок рации, а не мьют", () => {
    expect(seatStatus(remoteSeatVoice({ ...base, ptt: true, micOff: true }))).toBe("ptt");
  });

  it("держит клавишу — трек открыт, значка нет (видно кольцо «говорит»)", () => {
    expect(seatStatus(remoteSeatVoice({ ...base, ptt: true, micOff: false }))).toBeNull();
  });

  it("«звук выкл» виден другим и важнее рации; хост заглушил — важнее всего", () => {
    expect(seatStatus(remoteSeatVoice({ ...base, deafened: true, ptt: true, micOff: true }))).toBe("deafened");
    expect(seatStatus(remoteSeatVoice({ ...base, forceMuted: true, deafened: true, micOff: true }))).toBe(
      "forceMuted",
    );
  });

  it("без атрибутов (старый клиент, ещё не дошли) — как раньше, по треку", () => {
    expect(seatStatus(remoteSeatVoice({ ...base, micOff: true }))).toBe("muted");
    expect(seatStatusText("ptt")).toBe("в режиме рации");
  });
});

describe("seatLabel", () => {
  const base = {
    name: "Тёма",
    me: false,
    host: false,
    speaking: false,
    status: null,
    streaming: false,
    poorLink: false,
    mutedForMe: false,
  };

  it("одна фраза со всем состоянием", () => {
    expect(seatLabel({ ...base, host: true, speaking: true, streaming: true })).toBe(
      "Тёма, хост, говорит, показывает экран",
    );
  });

  it("свои значки, заглушён для меня и слабая связь", () => {
    expect(seatLabel({ ...base, me: true, status: "deafened", poorLink: true, pingMs: 182 })).toBe(
      "Тёма, это вы, звук выключен, слабая связь, 182 мс",
    );
    expect(seatLabel({ ...base, status: "muted", mutedForMe: true, poorLink: true })).toBe(
      "Тёма, микрофон выключен, заглушён для вас, слабая связь",
    );
  });

  it("свой статус — словами после голоса", () => {
    expect(seatLabel({ ...base, status: "muted", manual: "в игре: CS2" })).toBe("Тёма, микрофон выключен, в игре: CS2");
    expect(seatLabel({ ...base, manual: null })).toBe("Тёма");
  });
});

describe("shortName", () => {
  it("короткий ник — как есть", () => {
    expect(shortName("Тёма", 15)).toBe("Тёма");
    expect(shortName("1234567890", 10)).toBe("1234567890");
  });

  it("длинный — до max символов вместе с «…»", () => {
    const short = shortName("Константин Константинопольский", 15);
    expect(short).toBe("Константин Кон…");
    expect(Array.from(short)).toHaveLength(15);
  });

  it("перед «…» не остаётся пробела и подчёркивания — без дыры", () => {
    expect(shortName("Артемий Вознесенский", 9)).toBe("Артемий…");
    expect(shortName("Лёха_2007_pro", 6)).toBe("Лёха…");
  });

  it("эмодзи не разваливаются на половинки", () => {
    expect(shortName("🔥🔥🔥🔥🔥🔥", 4)).toBe("🔥🔥🔥…");
    expect(shortName("👨‍👩‍👧👨‍👩‍👧👨‍👩‍👧", 2)).toBe("👨‍👩‍👧…");
  });
});

describe("nameBudget", () => {
  it("корона, «· вы» и значок «заглушён для вас» отнимают место", () => {
    const none = { host: false, me: false, mutedForMe: false };
    expect(nameBudget("lg", none)).toBe(14);
    // 128 − корона − «· вы» = 81 px: «Артемий В…» (83 px) уже не влезает, «Артемий…» — да.
    expect(nameBudget("lg", { ...none, host: true, me: true })).toBe(9);
    expect(shortName("Артемий Вознесенский", nameBudget("lg", { ...none, host: true, me: true }))).toBe("Артемий…");
    expect(nameBudget("list", { ...none, mutedForMe: true })).toBe(18);
  });

  it("под Румиком «Экран» и связь в той же строке забирают место", () => {
    const none = { host: false, me: false, mutedForMe: false };
    expect(nameBudget("figure", none)).toBe(14);
    // 120 − «Экран» 28 = 92 px → 10 символов; ещё столбики связи 17 → 75 px → 8.
    expect(nameBudget("figure", { ...none, streaming: true })).toBe(10);
    expect(nameBudget("figure", { ...none, streaming: true, poorLink: true })).toBe(8);
  });

  it("значок статуса тоже забирает место", () => {
    const none = { host: false, me: false, mutedForMe: false };
    // 120 − значок 22 = 98 px → 11 символов.
    expect(nameBudget("figure", { ...none, manual: true })).toBe(11);
  });

  it("не меньше шести символов", () => {
    expect(nameBudget("md", { host: true, me: true, mutedForMe: true })).toBe(6);
  });
});

describe("pipVisibleCount", () => {
  it("в окно 360 — пятеро, шестой уходит в «+N» вместе с пятым", () => {
    expect(pipVisibleCount(3, 360, false)).toBe(3);
    expect(pipVisibleCount(5, 360, false)).toBe(5);
    expect(pipVisibleCount(6, 360, false)).toBe(4);
  });

  it("сжатое окно 260 — четыре аватара и кнопка микрофона", () => {
    expect(pipVisibleCount(4, 260, true)).toBe(4);
    expect(pipVisibleCount(7, 260, true)).toBe(3);
  });

  it("совсем узкое — хотя бы один", () => {
    expect(pipVisibleCount(5, 40, false)).toBe(1);
  });
});

describe("sortByJoin", () => {
  it("по времени входа, при равенстве — по identity", () => {
    const t = (s: number) => new Date(s * 1000);
    const list = [
      { identity: "u_c", joinedAt: t(20) },
      { identity: "u_b", joinedAt: t(10) },
      { identity: "u_a", joinedAt: t(10) },
    ];
    expect(sortByJoin(list).map((p) => p.identity)).toEqual(["u_a", "u_b", "u_c"]);
    // Исходный массив не меняется.
    expect(list[0].identity).toBe("u_c");
  });
});
