import { describe, expect, it } from "vitest";
import { GAME_TOPIC } from "@/lib/api/contract";
import { BUBBLE_GESTURES, BUBBLE_VIEW } from "../reactions/gesture";
import { readGameData } from "./useGameFeed";
import {
  GAME_VIEW,
  answerReady,
  diceBubble,
  nameList,
  readyText,
  tallyReady,
  type GameBubble,
  type ReadyCheck,
} from "./view";

const NAMES: Record<string, string> = { u_a: "Аня", u_b: "Боря", u_c: "Вика", u_d: "Глеб", u_e: "Даня" };
const nameOf = (id: string) => NAMES[id] ?? id;

function check(expected: string[]): ReadyCheck {
  return { id: "abcdefgh12345678", asker: expected[0], expected, answers: new Map() };
}

describe("«Все готовы?»", () => {
  it("ответы собираются; кто вошёл позже — не считается", () => {
    let c = check(["u_a", "u_b", "u_c"]);
    c = answerReady(c, "u_a", true);
    c = answerReady(c, "u_z", true);
    expect(tallyReady(c)).toEqual({ ready: ["u_a"], notReady: [], waiting: ["u_b", "u_c"], done: false });
    c = answerReady(c, "u_b", false);
    c = answerReady(c, "u_c", true);
    expect(tallyReady(c)).toEqual({ ready: ["u_a", "u_c"], notReady: ["u_b"], waiting: [], done: true });
  });

  it("ответ не меняет прежний опрос (неизменяемый)", () => {
    const c = check(["u_a", "u_b"]);
    const next = answerReady(c, "u_b", true);
    expect(c.answers.size).toBe(0);
    expect(next.answers.get("u_b")).toBe(true);
  });

  it("тексты: пока идёт, все готовы, не все", () => {
    let c = answerReady(check(["u_a", "u_b", "u_c"]), "u_a", true);
    expect(readyText(tallyReady(c), nameOf, false)).toEqual({ title: "Все готовы?", description: "Готовы 1 из 3" });
    expect(readyText(tallyReady(c), nameOf, true)).toEqual({
      title: "Готовы 1 из 3",
      description: "Не готовы: Боря, Вика",
    });
    c = answerReady(answerReady(c, "u_b", true), "u_c", true);
    expect(readyText(tallyReady(c), nameOf, true)).toEqual({ title: "Все готовы!", description: "3 из 3" });
  });

  it("длинный список ников сворачивается", () => {
    expect(nameList(["Аня", "Боря"])).toBe("Аня, Боря");
    expect(nameList(["Аня", "Боря", "Вика", "Глеб", "Даня"])).toBe("Аня, Боря, Вика и ещё 2");
  });
});

describe("пузыри игр", () => {
  it("грань кубика по значению, за пределами — край", () => {
    expect(diceBubble(1)).toBe("dice1");
    expect(diceBubble(6)).toBe("dice6");
    expect(diceBubble(9)).toBe("dice6");
    expect(GAME_VIEW.dice4.glyph).toEqual({ icon: "dice", text: "4" });
  });

  it("у каждого пузыря игры есть вид и жест в общем наборе", () => {
    for (const k of Object.keys(GAME_VIEW) as GameBubble[]) {
      expect(BUBBLE_VIEW[k].glyph).toBeTruthy();
      expect(BUBBLE_GESTURES[k].pose).toBeTruthy();
    }
  });
});

describe("приём пакета игры", () => {
  const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
  const dice = { kind: "dice", identity: "u_a", value: 3, at: 1 };

  it("пакет сервера с темой игр — принят; от участника — подделка", () => {
    expect(readGameData(bytes(dice), undefined, GAME_TOPIC)).toEqual(dice);
    expect(readGameData(bytes(dice), { identity: "u_b" }, GAME_TOPIC)).toBeNull();
    expect(readGameData(bytes(dice), undefined, "reaction")).toBeNull();
  });
});
