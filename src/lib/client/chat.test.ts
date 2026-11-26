import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/api/contract";
import {
  CHAT_LOG_LIMIT,
  appendEntry,
  confirmEntry,
  decodeChatPacket,
  failEntry,
  groupEntries,
  localId,
  mergeHistory,
  parseChatMessage,
  pendingEntry,
  receiveMessage,
  retryEntry,
  roomTabTitle,
  splitLinks,
  type ChatEntry,
} from "./chat";

const ME = { identity: "u_me", name: "Саня" };
const NIKA = { identity: "u_nika", name: "Ника" };

const msg = (id: string, ts: number, from = NIKA, text = `текст ${id}`): ChatMessage => ({
  id,
  ts,
  from,
  text,
});

describe("parseChatMessage / decodeChatPacket", () => {
  it("принимает правильное сообщение", () => {
    expect(parseChatMessage(msg("a", 1))).toEqual(msg("a", 1));
    const bytes = new TextEncoder().encode(JSON.stringify(msg("b", 2)));
    expect(decodeChatPacket(bytes)).toEqual(msg("b", 2));
  });

  it("сообщение администрации сохраняет пометку system, остальное — без неё", () => {
    const sys = { ...msg("s", 1, { identity: "system", name: "Администрация" }), system: true };
    expect(parseChatMessage(sys)).toEqual(sys);
    expect(parseChatMessage({ ...msg("x", 1), system: "yes" })).toEqual(msg("x", 1));
  });

  it("пустое имя заменяет identity", () => {
    expect(parseChatMessage({ ...msg("a", 1), from: { identity: "u_x", name: "" } })?.from.name).toBe("u_x");
  });

  it("отвергает мусор", () => {
    expect(parseChatMessage(null)).toBeNull();
    expect(parseChatMessage({ ...msg("a", 1), id: "" })).toBeNull();
    expect(parseChatMessage({ ...msg("a", 1), id: "local:1" })).toBeNull();
    expect(parseChatMessage({ ...msg("a", 1), ts: "1" })).toBeNull();
    expect(parseChatMessage({ ...msg("a", 1), text: "" })).toBeNull();
    expect(parseChatMessage({ ...msg("a", 1), from: { name: "x" } })).toBeNull();
    expect(parseChatMessage({ ...msg("a", 1), text: "я".repeat(5000) })).toBeNull();
    expect(decodeChatPacket(new TextEncoder().encode("{не json"))).toBeNull();
  });
});

describe("лента: склейка по id", () => {
  it("один и тот же id дважды — одно сообщение и тот же массив", () => {
    const a = receiveMessage([], msg("a", 1), ME.identity);
    expect(receiveMessage(a, msg("a", 1), ME.identity)).toBe(a);
    expect(a).toHaveLength(1);
    expect(a[0].state).toBe("sent");
  });

  it("опоздавшее сообщение встаёт по времени", () => {
    let list = receiveMessage([], msg("a", 10), ME.identity);
    list = receiveMessage(list, msg("c", 30), ME.identity);
    list = receiveMessage(list, msg("b", 20), ME.identity);
    expect(list.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("своё: pending → ответ POST заменяет его серверной версией", () => {
    let list = appendEntry([], pendingEntry(localId(1), ME, "привет", 5));
    expect(list[0].state).toBe("pending");
    list = confirmEntry(list, localId(1), msg("s1", 6, ME, "привет"));
    expect(list).toEqual([{ ...msg("s1", 6, ME, "привет"), state: "sent" }]);
  });

  it("своё: пакет пришёл раньше ответа POST — без дубля", () => {
    let list = appendEntry([], pendingEntry(localId(1), ME, "привет", 5));
    list = receiveMessage(list, msg("s1", 6, ME, "привет"), ME.identity);
    expect(list.map((e) => e.id)).toEqual(["s1"]);
    list = confirmEntry(list, localId(1), msg("s1", 6, ME, "привет"));
    expect(list.map((e) => e.id)).toEqual(["s1"]);
  });

  it("одинаковые тексты подряд сопоставляются по порядку", () => {
    let list = appendEntry([], pendingEntry(localId(1), ME, "ок", 1));
    list = appendEntry(list, pendingEntry(localId(2), ME, "ок", 2));
    list = receiveMessage(list, msg("s1", 3, ME, "ок"), ME.identity);
    expect(list.map((e) => e.id)).toEqual(["s1", localId(2)]);
  });

  it("свои неподтверждённые держатся в конце, чужие встают перед ними", () => {
    let list = appendEntry([], pendingEntry(localId(1), ME, "моё", 100));
    list = receiveMessage(list, msg("n1", 101), ME.identity);
    expect(list.map((e) => e.id)).toEqual(["n1", localId(1)]);
  });

  it("не ушло → «Повторить» → снова отправляется", () => {
    let list: readonly ChatEntry[] = appendEntry([], pendingEntry(localId(1), ME, "x", 1));
    list = failEntry(list, localId(1), "Хост выключил чат");
    expect(list[0]).toMatchObject({ state: "failed", error: "Хост выключил чат" });
    list = retryEntry(list, localId(1));
    expect(list[0]).toMatchObject({ state: "pending", error: undefined });
  });

  it("история вливается без дублей и не съедает новое своё с тем же текстом", () => {
    let list = receiveMessage([], msg("b", 20), ME.identity);
    list = appendEntry(list, pendingEntry(localId(1), ME, "ок", 50));
    list = mergeHistory(list, [msg("a", 10), msg("b", 20), msg("old", 15, ME, "ок")], ME.identity);
    expect(list.map((e) => e.id)).toEqual(["a", "old", "b", localId(1)]);
  });

  it("держит не больше лимита — старые уходят", () => {
    let list: readonly ChatEntry[] = [];
    for (let i = 0; i < CHAT_LOG_LIMIT + 5; i++) list = receiveMessage(list, msg(`m${i}`, i), ME.identity);
    expect(list).toHaveLength(CHAT_LOG_LIMIT);
    expect(list[0].id).toBe("m5");
  });
});

describe("splitLinks", () => {
  it("http(s) — ссылки, остальное — текст", () => {
    expect(splitLinks("лобби: https://steamcommunity.com/joinlobby/730/1 го")).toEqual([
      { kind: "text", text: "лобби: " },
      {
        kind: "link",
        text: "https://steamcommunity.com/joinlobby/730/1",
        href: "https://steamcommunity.com/joinlobby/730/1",
      },
      { kind: "text", text: " го" },
    ]);
  });

  it("javascript: и data: остаются текстом", () => {
    expect(splitLinks("javascript:alert(1) data:text/html,x")).toEqual([
      { kind: "text", text: "javascript:alert(1) data:text/html,x" },
    ]);
  });

  it("пунктуация в конце предложения — не часть ссылки", () => {
    const parts = splitLinks("смотри http://ya.ru/a, и https://x.com/b!");
    expect(parts.filter((p) => p.kind === "link").map((p) => p.text)).toEqual([
      "http://ya.ru/a",
      "https://x.com/b",
    ]);
    expect(parts.map((p) => p.text).join("")).toBe("смотри http://ya.ru/a, и https://x.com/b!");
  });

  it("скобки: парная остаётся в адресе, закрывающая предложение — нет", () => {
    const wiki = splitLinks("https://ru.wikipedia.org/wiki/Мир_(значения)");
    expect(wiki[0]).toMatchObject({ kind: "link", text: "https://ru.wikipedia.org/wiki/Мир_(значения)" });
    const inParens = splitLinks("(см. https://ya.ru)");
    expect(inParens.find((p) => p.kind === "link")?.text).toBe("https://ya.ru");
    expect(inParens.map((p) => p.text).join("")).toBe("(см. https://ya.ru)");
  });

  it("разметка в тексте — просто текст", () => {
    expect(splitLinks("<b>hi</b>")).toEqual([{ kind: "text", text: "<b>hi</b>" }]);
  });
});

describe("groupEntries", () => {
  it("подряд от одного автора — одна группа, пауза и смена автора — новая", () => {
    const list = [
      msg("a", 0),
      msg("b", 60_000),
      msg("c", 120_000, ME),
      msg("d", 130_000),
      msg("e", 130_000 + 6 * 60_000),
    ].map((m): ChatEntry => ({ ...m, state: "sent" }));
    const groups = groupEntries(list, ME.identity);
    expect(groups.map((g) => g.entries.map((e) => e.id))).toEqual([["a", "b"], ["c"], ["d"], ["e"]]);
    expect(groups.map((g) => g.mine)).toEqual([false, true, false, false]);
  });

  it("сообщения администрации — своей группой и никогда не «мои»", () => {
    const ADMIN = { identity: "system", name: "Администрация" };
    const list: ChatEntry[] = [
      { ...msg("a", 0, ADMIN), system: true, state: "sent" },
      { ...msg("b", 1000, ADMIN), system: true, state: "sent" },
      { ...msg("c", 2000), state: "sent" },
    ];
    const groups = groupEntries(list, "system");
    expect(groups.map((g) => [g.system, g.mine, g.entries.length])).toEqual([
      [true, false, 2],
      [false, false, 1],
    ]);
  });

  it("разделитель «Новые» начинает новую группу", () => {
    const list = [msg("a", 0), msg("b", 1000), msg("c", 2000)].map((m): ChatEntry => ({ ...m, state: "sent" }));
    expect(groupEntries(list, ME.identity, "b").map((g) => g.entries.map((e) => e.id))).toEqual([
      ["a"],
      ["b", "c"],
    ]);
  });
});

describe("roomTabTitle", () => {
  it("с непрочитанными и без", () => {
    expect(roomTabTitle("Вечерняя катка", 0)).toBe("Вечерняя катка · Game Room");
    expect(roomTabTitle("Вечерняя катка", 3)).toBe("(3) Вечерняя катка · Game Room");
    expect(roomTabTitle("К", 150)).toBe("(99+) К · Game Room");
  });
});
