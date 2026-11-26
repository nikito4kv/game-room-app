import { describe, expect, it } from "vitest";
import {
  INITIAL_MIC_INTENT,
  micIntentReducer,
  micState,
  shouldTransmit,
  type MicIntent,
  type VoiceInputs,
} from "./voiceState";

const open: VoiceInputs = { mode: "toggle", enabled: true, pttHeld: false, deafened: false, forceMuted: false };
const ptt: VoiceInputs = { ...open, mode: "ptt" };

describe("shouldTransmit", () => {
  it("открытый микрофон: в эфире, пока включён", () => {
    expect(shouldTransmit(open)).toBe(true);
    expect(shouldTransmit({ ...open, enabled: false })).toBe(false);
  });
  it("рация: в эфире только с зажатой клавишей и когда готова", () => {
    expect(shouldTransmit(ptt)).toBe(false);
    expect(shouldTransmit({ ...ptt, pttHeld: true })).toBe(true);
    expect(shouldTransmit({ ...ptt, pttHeld: true, enabled: false })).toBe(false);
  });
  it("«Звук выкл» и заглушение хостом глушат и микрофон, и рацию", () => {
    expect(shouldTransmit({ ...open, deafened: true })).toBe(false);
    expect(shouldTransmit({ ...open, forceMuted: true })).toBe(false);
    expect(shouldTransmit({ ...ptt, pttHeld: true, deafened: true })).toBe(false);
    expect(shouldTransmit({ ...ptt, pttHeld: true, forceMuted: true })).toBe(false);
  });
});

describe("micState", () => {
  it("вид кнопки по состоянию", () => {
    expect(micState(open)).toBe("on");
    expect(micState({ ...open, enabled: false })).toBe("off");
    expect(micState(ptt)).toBe("ptt-idle");
    expect(micState({ ...ptt, pttHeld: true })).toBe("ptt-talk");
    expect(micState({ ...ptt, enabled: false })).toBe("off");
  });
  it("«Звук выкл» показывает микрофон выключенным, хост — важнее всего", () => {
    expect(micState({ ...open, deafened: true })).toBe("off");
    expect(micState({ ...ptt, deafened: true })).toBe("off");
    expect(micState({ ...open, forceMuted: true, deafened: true })).toBe("forced");
  });
});

describe("micIntentReducer", () => {
  const off: MicIntent = { enabled: false, beforePtt: null };

  it("ошибка рации из refactor.md: включили рацию при выключенном микрофоне — рация готова, в эфир звук не идёт", () => {
    const s = micIntentReducer(off, { type: "mode", mode: "ptt", forceMuted: false });
    expect(s.enabled).toBe(true);
    expect(shouldTransmit({ ...ptt, enabled: s.enabled })).toBe(false);
  });
  it("рация туда-обратно без переключений — как было до неё", () => {
    const inPtt = micIntentReducer(off, { type: "mode", mode: "ptt", forceMuted: false });
    expect(micIntentReducer(inPtt, { type: "mode", mode: "toggle", forceMuted: false }).enabled).toBe(false);
    const fromOn = micIntentReducer(INITIAL_MIC_INTENT, { type: "mode", mode: "ptt", forceMuted: false });
    expect(micIntentReducer(fromOn, { type: "mode", mode: "toggle", forceMuted: false }).enabled).toBe(true);
  });
  it("явное переключение внутри рации — последний выбор действует и после выхода", () => {
    let s = micIntentReducer(INITIAL_MIC_INTENT, { type: "mode", mode: "ptt", forceMuted: false });
    s = micIntentReducer(s, { type: "set", enabled: false });
    expect(micIntentReducer(s, { type: "mode", mode: "toggle", forceMuted: false }).enabled).toBe(false);
  });
  it("заглушённого хостом рация не готовит, а заглушение выключает микрофон", () => {
    expect(micIntentReducer(off, { type: "mode", mode: "ptt", forceMuted: true }).enabled).toBe(false);
    expect(micIntentReducer(INITIAL_MIC_INTENT, { type: "force-muted" })).toEqual(off);
  });
  it("set без изменений возвращает тот же объект (нет лишних перерисовок)", () => {
    expect(micIntentReducer(INITIAL_MIC_INTENT, { type: "set", enabled: true })).toBe(INITIAL_MIC_INTENT);
    expect(micIntentReducer(off, { type: "force-muted" })).toBe(off);
    expect(micIntentReducer(off, { type: "muted-remotely" })).toBe(off);
  });
  it("«выключить микрофоны всем»: микрофон выключен по-настоящему — трек больше не просится в эфир", () => {
    const s = micIntentReducer(INITIAL_MIC_INTENT, { type: "muted-remotely" });
    expect(s).toEqual(off);
    expect(shouldTransmit({ ...open, enabled: s.enabled })).toBe(false);
    // Мягко: включить можно самому, как обычно.
    expect(micIntentReducer(s, { type: "set", enabled: true }).enabled).toBe(true);
  });
  it("«выключить всем» во время рации: выход из рации не включает микрофон обратно", () => {
    let s = micIntentReducer(INITIAL_MIC_INTENT, { type: "mode", mode: "ptt", forceMuted: false });
    s = micIntentReducer(s, { type: "muted-remotely" });
    expect(shouldTransmit({ ...ptt, pttHeld: true, enabled: s.enabled })).toBe(false);
    expect(micIntentReducer(s, { type: "mode", mode: "toggle", forceMuted: false }).enabled).toBe(false);
  });
});
