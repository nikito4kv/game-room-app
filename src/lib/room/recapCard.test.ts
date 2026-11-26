import { describe, expect, it } from "vitest";
import type { Recap } from "./recap";
import { ellipsize, recapCells, recapSubtitle, recapSummary, recapTiles } from "./recapCard";

const MIN = 60_000;
const base: Recap = {
  title: "Вечерняя катка",
  startedAt: new Date(2026, 9, 6, 20, 0).getTime(),
  durationMs: 135 * MIN,
  people: 5,
  peak: 4,
  top: { identity: "a", name: "Аня", talkMs: 48 * MIN },
  quiet: { identity: "g", name: "Глеб", talkMs: 2 * MIN },
  reactions: 37,
  sounds: 12,
  dice: 3,
};

describe("картинка итогов", () => {
  it("четыре клетки по важности", () => {
    expect(recapCells(base)).toEqual([
      { label: "Вместе", value: "2 ч 15 мин" },
      { label: "Компания", value: "5 человек" },
      { label: "Болтун вечера", value: "Аня · 48 мин" },
      { label: "Тише всех", value: "Глеб" },
    ]);
  });

  it("без болтуна и молчуна — реакции, звуки и кубик", () => {
    expect(recapCells({ ...base, people: 1, top: null, quiet: null, reactions: 1, sounds: 0, dice: 2 })).toEqual([
      { label: "Вместе", value: "2 ч 15 мин" },
      { label: "Эмоции", value: "1 реакция" },
      { label: "Кубик", value: "2 броска" },
    ]);
  });

  it("подзаголовок: название и дата", () => {
    expect(recapSubtitle(base)).toBe("«Вечерняя катка» · 6 октября");
  });

  it("длинная строка обрезается с «…» по ширине", () => {
    const measure = (s: string) => [...s].length * 10;
    expect(ellipsize("коротко", 100, measure)).toBe("коротко");
    expect(ellipsize("очень длинное название", 100, measure)).toBe("очень дли…");
  });

  it("плитки под картинкой: по показателю, нулевые не показываем", () => {
    expect(recapTiles(base).map((t) => `${t.icon}|${t.value}|${t.caption}`)).toEqual([
      "history|2 ч 15 мин|вместе",
      "users|5|человек",
      "mic|Аня|болтун вечера · 48 мин",
      "headphones|Глеб|тише всех",
      "smile-plus|37|реакций",
      "music|12|звуков",
      "dice|3|броска",
    ]);
    const lonely = recapTiles({ ...base, people: 1, top: null, quiet: null, reactions: 0, sounds: 0, dice: 0 });
    expect(lonely).toEqual([{ icon: "history", value: "2 ч 15 мин", caption: "вместе" }]);
  });

  it("описание картинки одной фразой", () => {
    expect(recapSummary({ ...base, top: null, quiet: null, reactions: 1, sounds: 0, dice: 0 })).toBe(
      "Итоги вечера, «Вечерняя катка» · 6 октября: 2 ч 15 мин вместе, 5 человек, 1 реакция.",
    );
  });
});
