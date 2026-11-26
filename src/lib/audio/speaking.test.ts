import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RemoteLevelMonitor,
  SILENT,
  SPEAKING_TUNING,
  levelFromDb,
  nextSpeaking,
  createSpeakingStore,
  ringsVisible,
  rmsDb,
  shouldPollLevels,
  speakingStore,
  type RingVisibility,
  type SpeakingState,
} from "./speaking";

const run = (levels: number[], dt = 50): SpeakingState[] => {
  const out: SpeakingState[] = [];
  let s = SILENT;
  for (const db of levels) {
    s = nextSpeaking(s, db, dt);
    out.push(s);
  }
  return out;
};

describe("nextSpeaking", () => {
  it("заговорил — сразу (первый же замер выше порога)", () => {
    const [s] = run([-30]);
    expect(s.speaking).toBe(true);
    expect(s.level).toBeGreaterThan(0);
  });
  it("тишина (нули после порога отправителя) — не говорит", () => {
    expect(run([-Infinity, -80, -60]).every((s) => !s.speaking)).toBe(true);
  });
  it("короткие паузы между слогами не гасят кольцо (удержание)", () => {
    const states = run([-25, -70, -70, -70, -25]); // 150 мс тишины < 300 мс
    expect(states.every((s) => s.speaking)).toBe(true);
  });
  it("после паузы дольше удержания — замолчал", () => {
    const quiet = Array(Math.ceil(SPEAKING_TUNING.holdMs / 50) + 1).fill(-70);
    const states = run([-25, ...quiet]);
    expect(states.at(-1)?.speaking).toBe(false);
  });
  it("гистерезис: между порогами состояние держится, ниже offDb — считаем тишиной", () => {
    const mid = (SPEAKING_TUNING.onDb + SPEAKING_TUNING.offDb) / 2;
    expect(run([mid]).every((s) => !s.speaking)).toBe(true); // не начинает
    expect(run([-25, mid, mid, mid, mid, mid, mid, mid]).every((s) => s.speaking)).toBe(true); // не бросает
  });
  it("тишина без изменений возвращает тот же объект (нет лишних уведомлений)", () => {
    expect(nextSpeaking(SILENT, -90, 50)).toBe(SILENT);
  });
});

describe("уровни", () => {
  it("levelFromDb: 0 ниже пола, 1 у потолка, шаг 0,1", () => {
    expect(levelFromDb(-Infinity)).toBe(0);
    expect(levelFromDb(SPEAKING_TUNING.floorDb - 5)).toBe(0);
    expect(levelFromDb(SPEAKING_TUNING.ceilDb)).toBe(1);
    expect(levelFromDb(0)).toBe(1);
    const mid = levelFromDb((SPEAKING_TUNING.floorDb + SPEAKING_TUNING.ceilDb) / 2);
    expect(mid).toBe(0.5);
    expect(Math.round(mid * 10)).toBe(mid * 10);
  });
  it("rmsDb: синус амплитуды 1 ≈ −3 дБ, тишина — −∞", () => {
    const sine = new Float32Array(4800).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000));
    expect(rmsDb(sine)).toBeCloseTo(-3.01, 1);
    expect(rmsDb(new Float32Array(16))).toBe(-Infinity);
  });
});

describe("speakingStore", () => {
  it("уведомляет только подписчиков этого участника и только при изменении", () => {
    const anna = vi.fn();
    const boris = vi.fn();
    const offA = speakingStore.subscribe("anna", anna);
    const offB = speakingStore.subscribe("boris", boris);
    speakingStore.set("anna", true, 0.5);
    speakingStore.set("anna", true, 0.5); // то же — без уведомления
    expect(anna).toHaveBeenCalledTimes(1);
    expect(boris).not.toHaveBeenCalled();
    expect(speakingStore.speaking("anna")).toBe(true);
    expect(speakingStore.level("anna")).toBe(0.5);
    speakingStore.delete("anna");
    expect(speakingStore.speaking("anna")).toBeNull();
    expect(anna).toHaveBeenCalledTimes(2);
    offA();
    offB();
  });

  it("«говорит ли кто-нибудь»: будит только на смену тишина ↔ речь", () => {
    const store = createSpeakingStore();
    const any = vi.fn();
    store.subscribeAny(any);
    expect(store.anySpeaking()).toBe(false);
    store.set("anna", true, 0.3);
    store.set("boris", true, 0.4); // уже кто-то говорит — без уведомления
    store.set("anna", true, 0.6); // уровень — без уведомления
    expect(any).toHaveBeenCalledTimes(1);
    store.set("anna", false, 0);
    expect(store.anySpeaking()).toBe(true);
    store.delete("boris"); // ушёл говорящим — тишина
    expect(store.anySpeaking()).toBe(false);
    expect(any).toHaveBeenCalledTimes(2);
    store.delete("anna"); // молчал — счёт не уходит в минус
    store.set("vika", true, 0.2);
    expect(store.anySpeaking()).toBe(true);
    expect(any).toHaveBeenCalledTimes(3);
  });
});

describe("когда опрашивать уровни", () => {
  it("кольца видны, пока видна вкладка или открыта мини-комната", () => {
    expect(ringsVisible({ pageVisible: true, miniRoomOpen: false })).toBe(true);
    expect(ringsVisible({ pageVisible: false, miniRoomOpen: true })).toBe(true);
    expect(ringsVisible({ pageVisible: false, miniRoomOpen: false })).toBe(false);
  });
  it("опрос — только если есть незаглушённая дорожка и кольца кто-то видит", () => {
    expect(shouldPollLevels(2, true)).toBe(true);
    expect(shouldPollLevels(0, true)).toBe(false);
    expect(shouldPollLevels(2, false)).toBe(false);
  });
});

describe("RemoteLevelMonitor", () => {
  /** Анализатор с постоянным уровнем: 0,3 ≈ −10 дБFS — «говорит». */
  function fakeAnalyser(value = 0.3) {
    const read = vi.fn((buf: Float32Array) => buf.fill(value));
    return { node: { fftSize: 64, getFloatTimeDomainData: read } as unknown as AnalyserNode, read };
  }
  function fakeVisibility(initial = true) {
    let visible = initial;
    let onChange: (() => void) | null = null;
    const v: RingVisibility = {
      visible: () => visible,
      watch(cb) {
        onChange = cb;
        return () => {
          onChange = null;
        };
      },
    };
    return {
      v,
      set(next: boolean) {
        visible = next;
        onChange?.();
      },
      watching: () => onChange !== null,
    };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("все заглушены — ни одного опроса; открыли дорожку — опрос пошёл", () => {
    const vis = fakeVisibility();
    const m = new RemoteLevelMonitor(vis.v);
    const a = fakeAnalyser();
    m.add("vika", a.node, false);
    vi.advanceTimersByTime(1000);
    expect(a.read).not.toHaveBeenCalled();
    expect(speakingStore.speaking("vika")).toBe(false); // запись есть — признак сервера не нужен
    m.setActive("vika", a.node, true);
    vi.advanceTimersByTime(100);
    expect(a.read).toHaveBeenCalled();
    expect(speakingStore.speaking("vika")).toBe(true);
    m.remove("vika", a.node);
  });

  it("дорожку заглушили — кольцо гаснет сразу, а таймер встаёт", () => {
    const m = new RemoteLevelMonitor(fakeVisibility().v);
    const a = fakeAnalyser();
    m.add("gleb", a.node);
    vi.advanceTimersByTime(100);
    expect(speakingStore.speaking("gleb")).toBe(true);
    m.setActive("gleb", a.node, false);
    expect(speakingStore.speaking("gleb")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    m.remove("gleb", a.node);
  });

  it("вкладку спрятали без мини-комнаты — опрос на паузе и кольца гаснут; вернулись — снова", () => {
    const vis = fakeVisibility();
    const m = new RemoteLevelMonitor(vis.v);
    const a = fakeAnalyser();
    m.add("anna", a.node);
    vi.advanceTimersByTime(100);
    expect(speakingStore.speaking("anna")).toBe(true);
    vis.set(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(speakingStore.speaking("anna")).toBe(false);
    a.read.mockClear();
    vi.advanceTimersByTime(1000);
    expect(a.read).not.toHaveBeenCalled();
    vis.set(true);
    vi.advanceTimersByTime(100);
    expect(speakingStore.speaking("anna")).toBe(true);
    m.remove("anna", a.node);
  });

  it("опрашивает только незаглушённых; последний ушёл — отписка от видимости", () => {
    const vis = fakeVisibility();
    const m = new RemoteLevelMonitor(vis.v);
    const talk = fakeAnalyser();
    const quiet = fakeAnalyser();
    m.add("boris", talk.node);
    m.add("dima", quiet.node, false);
    vi.advanceTimersByTime(200);
    expect(talk.read).toHaveBeenCalled();
    expect(quiet.read).not.toHaveBeenCalled();
    m.remove("boris", talk.node);
    expect(vi.getTimerCount()).toBe(0); // остался только заглушённый
    expect(vis.watching()).toBe(true);
    m.remove("dima", quiet.node);
    expect(vis.watching()).toBe(false);
  });

  it("старый анализатор (дорожку заменили) не трогает новую", () => {
    const m = new RemoteLevelMonitor(fakeVisibility().v);
    const old = fakeAnalyser();
    const fresh = fakeAnalyser();
    m.add("lena", old.node);
    m.add("lena", fresh.node);
    m.setActive("lena", old.node, false);
    m.remove("lena", old.node);
    vi.advanceTimersByTime(100);
    expect(fresh.read).toHaveBeenCalled();
    expect(speakingStore.speaking("lena")).toBe(true);
    m.remove("lena", fresh.node);
    expect(speakingStore.speaking("lena")).toBeNull();
  });
});
