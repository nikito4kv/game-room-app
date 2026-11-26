import { describe, expect, it } from "vitest";
import {
  REACTION_BURST,
  REACTION_KINDS,
  REACTION_TOPIC,
  REACTION_WINDOW_MS,
  SOUND_BURST,
  SOUND_TOPIC,
  SOUND_WINDOW_MS,
} from "@/lib/api/contract";
import { ANNOUNCE_GAP_MS, createReactionAnnouncer, reactionPhrase, readReactionData, readSoundData } from "./feed";
import { BUBBLE_GESTURES, BUBBLE_VIEW, REACTION_GESTURES, REACTION_VIEW, gestureFor } from "./gesture";
import { REACTION_FADE_MS, REACTION_TTL_MS, burstWait, createReactionStore } from "./reactionStore";

/** Ручные часы: время и таймеры двигаются только по tick(). */
function fakeClock(start = 1_000) {
  let now = start;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout: (fn: () => void, ms: number) => {
      timers.set(++seq, { at: now + ms, fn });
      return seq;
    },
    clearTimeout: (id: unknown) => {
      timers.delete(id as number);
    },
    tick(ms: number) {
      const until = now + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = until;
    },
    pending: () => timers.size,
  };
}

const ME = "u_me";
const BORYA = "u_borya";
const ANYA = "u_anya";

describe("хранилище реакций", () => {
  it("чужая реакция по пакету живёт ≈2 с: показ, таяние, уход; таймеры после — ноль", () => {
    const clock = fakeClock();
    const store = createReactionStore(clock);
    const r = store.receive({ identity: BORYA, kind: "fire", at: 999_999 }, ME);
    expect(r).toEqual({ kind: "fire", at: 1_000 });
    expect(store.get(BORYA)).toBe(r);
    expect(store.leaving(BORYA)).toBe(false);

    clock.tick(REACTION_TTL_MS - REACTION_FADE_MS - 1);
    expect(store.leaving(BORYA)).toBe(false);
    clock.tick(1);
    expect(store.leaving(BORYA)).toBe(true);
    // Пока тает — тот же объект: жест Румика не перерисовывается.
    expect(store.get(BORYA)).toBe(r);

    clock.tick(REACTION_FADE_MS);
    expect(store.get(BORYA)).toBeNull();
    expect(store.leaving(BORYA)).toBe(false);
    expect(clock.pending()).toBe(0);
  });

  it("своё эхо от сервера пропускается: своя показана сразу по клику", () => {
    const clock = fakeClock();
    const store = createReactionStore(clock);
    const mine = store.show(ME, "gg");
    clock.tick(300);
    expect(store.receive({ identity: ME, kind: "gg", at: 5 }, ME)).toBeNull();
    // Не всплыла второй раз и не продлилась.
    expect(store.get(ME)).toBe(mine);
    clock.tick(REACTION_TTL_MS - 300);
    expect(store.get(ME)).toBeNull();
  });

  it("новая реакция того же человека сменяет прежнюю и заводит срок заново; at растёт и в ту же мс", () => {
    const clock = fakeClock();
    const store = createReactionStore(clock);
    const first = store.show(BORYA, "like");
    const second = store.show(BORYA, "lol");
    expect(second.at).toBeGreaterThan(first.at);
    expect(store.get(BORYA)).toEqual({ kind: "lol", at: second.at });
    clock.tick(REACTION_TTL_MS - 1);
    expect(store.get(BORYA)).toBe(second);
    clock.tick(1);
    expect(store.get(BORYA)).toBeNull();
  });

  it("подписка по человеку: реакция Бори будит только Борю", () => {
    const clock = fakeClock();
    const store = createReactionStore(clock);
    const calls: string[] = [];
    const offB = store.subscribe(BORYA, () => calls.push("B"));
    store.subscribe(ANYA, () => calls.push("A"));
    store.show(BORYA, "fire");
    clock.tick(REACTION_TTL_MS);
    // Показ, таяние, уход.
    expect(calls).toEqual(["B", "B", "B"]);
    offB();
    store.show(BORYA, "fire");
    expect(calls).toHaveLength(3);
  });

  it("retract убирает только ту же реакцию (своя не дошла до сервера)", () => {
    const clock = fakeClock();
    const store = createReactionStore(clock);
    const first = store.show(ME, "like");
    const second = store.show(ME, "fire");
    store.retract(ME, first);
    expect(store.get(ME)).toBe(second);
    store.retract(ME, second);
    expect(store.get(ME)).toBeNull();
    expect(clock.pending()).toBe(0);
  });

  it("clear: всё убрано, подписчики узнали, таймеров нет", () => {
    const clock = fakeClock();
    const store = createReactionStore(clock);
    let woke = 0;
    store.subscribe(ANYA, () => woke++);
    store.show(ANYA, "gg");
    store.show(BORYA, "gg");
    store.clear();
    expect(store.get(ANYA)).toBeNull();
    expect(store.get(BORYA)).toBeNull();
    expect(woke).toBe(2);
    expect(clock.pending()).toBe(0);
  });
});

describe("очередь своих реакций", () => {
  it(`до ${REACTION_BURST} подряд можно, следующая — когда старейшая выйдет из окна`, () => {
    const sent: number[] = [];
    let now = 0;
    for (let i = 0; i < REACTION_BURST; i++) {
      expect(burstWait(sent, now)).toBe(0);
      sent.push(now);
      now += 100;
    }
    expect(burstWait(sent, now)).toBe(REACTION_WINDOW_MS - now);
    expect(burstWait(sent, REACTION_WINDOW_MS - 1)).toBe(1);
    expect(burstWait(sent, REACTION_WINDOW_MS)).toBe(0);
  });

  it("старые отправки не считаются", () => {
    expect(burstWait([0, 1, 2, 3, 4, 5, 6], 20_000)).toBe(0);
  });

  it(`звуки — свои правила: ${SOUND_BURST} за ${SOUND_WINDOW_MS / 1000} с`, () => {
    const sent = [0, 1_000, 2_000];
    expect(burstWait(sent.slice(0, SOUND_BURST - 1), 2_500, SOUND_BURST, SOUND_WINDOW_MS)).toBe(0);
    expect(burstWait(sent, 2_500, SOUND_BURST, SOUND_WINDOW_MS)).toBe(SOUND_WINDOW_MS - 2_500);
    expect(burstWait(sent, SOUND_WINDOW_MS, SOUND_BURST, SOUND_WINDOW_MS)).toBe(0);
  });
});

describe("жест и вид реакции", () => {
  it("у каждой реакции есть жест и значок", () => {
    for (const kind of REACTION_KINDS) {
      expect(REACTION_GESTURES[kind].pose).toBeTruthy();
      expect(REACTION_VIEW[kind].glyph).toBeTruthy();
      expect(REACTION_VIEW[kind].label).toBeTruthy();
    }
  });

  it("звук над местом — одна «реакция» для хранилища: значок, жест и показ", () => {
    expect(BUBBLE_GESTURES.sound.pose).toBeTruthy();
    expect(BUBBLE_VIEW.sound.glyph.icon).toBe("music");
    const store = createReactionStore(fakeClock());
    expect(gestureFor(store.show(BORYA, "sound"))).toMatchObject({ kind: "sound", pose: "cheer" });
  });

  it("👍 машет, 🔥 руки вверх, 😂 держится и жмурится, GG — руки вверх и круглые глаза", () => {
    expect(gestureFor({ kind: "like", at: 7 })).toEqual({ kind: "like", pose: "wave", at: 7 });
    expect(gestureFor({ kind: "fire", at: 7 })).toEqual({ kind: "fire", pose: "cheer", at: 7 });
    expect(gestureFor({ kind: "lol", at: 7 })).toEqual({ kind: "lol", pose: "laugh", eyes: "wink", at: 7 });
    expect(gestureFor({ kind: "gg", at: 7 })).toEqual({ kind: "gg", pose: "cheer", eyes: "wide", at: 7 });
    // Без глаз — ключа eyes нет вовсе: стол не затрёт свои глаза undefined.
    expect("eyes" in gestureFor({ kind: "like", at: 1 })).toBe(false);
  });
});

describe("приём пакета реакции", () => {
  const packet = { identity: BORYA, kind: "fire", at: 5 };
  const bytes = (v: unknown) => new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v));

  it("пакет сервера (participant пустой) с темой реакций — принят", () => {
    expect(readReactionData(bytes(packet), undefined, REACTION_TOPIC)).toEqual(packet);
    expect(readReactionData(bytes(packet), null, REACTION_TOPIC)).toEqual(packet);
  });

  it("пакет от участника — подделка, отброшен, даже если он целый", () => {
    const sender = { identity: ANYA };
    expect(readReactionData(bytes(packet), sender, REACTION_TOPIC)).toBeNull();
    // И от имени самого отправителя тоже: реакции ходят только через сервер.
    expect(readReactionData(bytes({ ...packet, identity: ANYA }), sender, REACTION_TOPIC)).toBeNull();
  });

  it("чужая тема, кривой JSON и неизвестная реакция — null", () => {
    expect(readReactionData(bytes(packet), undefined, "chat")).toBeNull();
    expect(readReactionData(bytes(packet), undefined, undefined)).toBeNull();
    expect(readReactionData(bytes("{не json"), undefined, REACTION_TOPIC)).toBeNull();
    expect(readReactionData(bytes({ ...packet, kind: "heart" }), undefined, REACTION_TOPIC)).toBeNull();
  });
});

describe("приём пакета звука", () => {
  const packet = { identity: BORYA, sound: "rimshot", at: 5 };
  const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

  it("пакет сервера с темой звуков — принят; с темой реакций — нет", () => {
    expect(readSoundData(bytes(packet), undefined, SOUND_TOPIC)).toEqual(packet);
    expect(readSoundData(bytes(packet), undefined, REACTION_TOPIC)).toBeNull();
    // И наоборот: звук не прочитается как реакция.
    expect(readReactionData(bytes(packet), undefined, SOUND_TOPIC)).toBeNull();
  });

  it("пакет от участника — подделка; неизвестный звук — null", () => {
    expect(readSoundData(bytes(packet), { identity: ANYA }, SOUND_TOPIC)).toBeNull();
    expect(readSoundData(bytes({ ...packet, sound: "AIR HORN" }), undefined, SOUND_TOPIC)).toBeNull();
  });
});

describe("объявления для скринридера", () => {
  const counts = (...kinds: (keyof typeof REACTION_VIEW)[]) => {
    const m = new Map<string, number>();
    for (const k of kinds) m.set(REACTION_VIEW[k].spoken, (m.get(REACTION_VIEW[k].spoken) ?? 0) + 1);
    return m;
  };

  it("фраза: ник не склоняем, повторы — числом, виды в порядке прихода", () => {
    expect(reactionPhrase("Боря", counts("fire"))).toBe("Боря: огонь");
    expect(reactionPhrase("Боря", counts("fire", "lol", "fire", "fire"))).toBe("Боря: огонь 3 раза, смешно");
    expect(reactionPhrase("Боря", counts("gg", "gg", "gg", "gg", "gg"))).toBe("Боря: GG 5 раз");
  });

  it("звук объявляется так же, как реакция: «Боря: ба-дум-тсс»", () => {
    const m = new Map<string, number>([
      ["ба-дум-тсс", 2],
      ["огонь", 1],
    ]);
    expect(reactionPhrase("Боря", m)).toBe("Боря: ба-дум-тсс 2 раза, огонь");
  });

  it("повтор той же фразы через паузу — снова объявлен", () => {
    const clock = fakeClock();
    const said: string[] = [];
    const a = createReactionAnnouncer((t) => said.push(t), clock);
    a.push(BORYA, "Боря", "огонь");
    clock.tick(ANNOUNCE_GAP_MS);
    a.push(BORYA, "Боря", "огонь");
    expect(said).toEqual(["Боря: огонь", "Боря: огонь"]);
    expect(clock.pending()).toBe(0);
  });

  it("флуд одного человека: не чаще раза в 2 с, остальное — одной фразой в конце паузы", () => {
    const clock = fakeClock();
    const said: string[] = [];
    const a = createReactionAnnouncer((t) => said.push(t), clock);
    a.push(BORYA, "Боря", "огонь");
    for (let i = 0; i < 9; i++) {
      clock.tick(100);
      a.push(BORYA, "Боря", i < 6 ? "огонь" : "смешно");
    }
    expect(said).toEqual(["Боря: огонь"]);
    clock.tick(ANNOUNCE_GAP_MS - 900 - 1);
    expect(said).toHaveLength(1);
    clock.tick(1);
    expect(said).toEqual(["Боря: огонь", "Боря: огонь 6 раз, смешно 3 раза"]);
    expect(clock.pending()).toBe(0);
    // Следующая — снова не раньше чем через 2 с после склеенной.
    a.push(BORYA, "Боря", "GG");
    expect(said).toHaveLength(2);
    clock.tick(ANNOUNCE_GAP_MS);
    expect(said[2]).toBe("Боря: GG");
  });

  it("пауза — у каждого своя: Аня не ждёт Борю", () => {
    const clock = fakeClock();
    const said: string[] = [];
    const a = createReactionAnnouncer((t) => said.push(t), clock);
    a.push(BORYA, "Боря", "огонь");
    a.push(ANYA, "Аня", "класс");
    expect(said).toEqual(["Боря: огонь", "Аня: класс"]);
  });

  it("clear: отложенное не прозвучит, таймеров нет", () => {
    const clock = fakeClock();
    const said: string[] = [];
    const a = createReactionAnnouncer((t) => said.push(t), clock);
    a.push(BORYA, "Боря", "огонь");
    a.push(BORYA, "Боря", "огонь");
    a.clear();
    expect(clock.pending()).toBe(0);
    clock.tick(ANNOUNCE_GAP_MS * 2);
    expect(said).toEqual(["Боря: огонь"]);
  });
});
