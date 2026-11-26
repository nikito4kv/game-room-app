import { describe, expect, it } from "vitest";
import {
  IDLE_VOICE_SYNC,
  VOICE_SYNC_CONFIRM_MS,
  VOICE_SYNC_DEBOUNCE_MS,
  afterVoiceSync,
  planVoiceSync,
  type VoiceSync,
} from "./voicePresence";

const off = { deafened: false, ptt: false };
const deaf = { deafened: true, ptt: false };
const NOW = 1_000_000;
const sending = (sync: VoiceSync): VoiceSync => ({ ...sync, inFlight: true });

describe("planVoiceSync", () => {
  it("другие видят то же — слать нечего", () => {
    expect(planVoiceSync(off, off, IDLE_VOICE_SYNC, NOW).sendInMs).toBeNull();
  });

  it("расхождение — отправка после короткой паузы", () => {
    expect(planVoiceSync(deaf, off, IDLE_VOICE_SYNC, NOW).sendInMs).toBe(VOICE_SYNC_DEBOUNCE_MS);
  });

  it("после входа заново атрибутов нет — состояние уходит снова само", () => {
    // Своё «звук выкл» осталось, а новая сессия LiveKit пришла без атрибутов.
    expect(planVoiceSync({ deafened: true, ptt: true }, off, IDLE_VOICE_SYNC, NOW).sendInMs).toBe(
      VOICE_SYNC_DEBOUNCE_MS,
    );
  });

  it("запрос в пути — второй не шлём", () => {
    const sync = sending(IDLE_VOICE_SYNC);
    expect(planVoiceSync(deaf, off, sync, NOW)).toEqual({ sync, sendInMs: null });
  });

  it("сервер принял, атрибуты ещё в пути — то же не шлём сразу, а новое — сразу", () => {
    const accepted = afterVoiceSync(sending(IDLE_VOICE_SYNC), { ok: true, sent: deaf }, NOW);
    // Ответ пришёл раньше атрибутов: повтор того же — только через паузу подтверждения.
    expect(planVoiceSync(deaf, off, accepted, NOW).sendInMs).toBe(VOICE_SYNC_CONFIRM_MS);
    // Человек уже передумал — новое состояние уходит с обычной паузой.
    expect(planVoiceSync({ deafened: true, ptt: true }, off, accepted, NOW).sendInMs).toBe(
      VOICE_SYNC_DEBOUNCE_MS,
    );
  });

  it("после сбоя ждём своей паузы, а сошлось — сбои забыты", () => {
    const failed = afterVoiceSync(sending(IDLE_VOICE_SYNC), { ok: false }, NOW);
    expect(planVoiceSync(deaf, off, failed, NOW + 1_000).sendInMs).toBe(4_000);
    expect(planVoiceSync(deaf, off, failed, NOW + 9_000).sendInMs).toBe(VOICE_SYNC_DEBOUNCE_MS);
    expect(planVoiceSync(deaf, deaf, failed, NOW + 1_000)).toEqual({ sync: IDLE_VOICE_SYNC, sendInMs: null });
  });
});

describe("afterVoiceSync", () => {
  it("успех — сбои забыты, запомнили принятое", () => {
    const sync = afterVoiceSync({ inFlight: true, failures: 3, notBefore: NOW, accepted: null }, { ok: true, sent: deaf }, NOW);
    expect(sync).toEqual({ inFlight: false, failures: 0, notBefore: NOW + VOICE_SYNC_CONFIRM_MS, accepted: deaf });
  });

  it("сбои подряд — паузы 5, 10, 20, 40 с, дальше раз в минуту", () => {
    let sync = IDLE_VOICE_SYNC;
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      sync = afterVoiceSync(sending(sync), { ok: false }, NOW);
      waits.push(sync.notBefore - NOW);
    }
    expect(waits).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
    expect(sync.inFlight).toBe(false);
  });

  it("RATE_LIMITED: ждём retryAfterSec, если она длиннее своей паузы", () => {
    expect(afterVoiceSync(IDLE_VOICE_SYNC, { ok: false, retryAfterSec: 8 }, NOW).notBefore).toBe(NOW + 8_000);
    expect(afterVoiceSync(IDLE_VOICE_SYNC, { ok: false, retryAfterSec: 2 }, NOW).notBefore).toBe(NOW + 5_000);
  });

  it("сервер раз за разом «принимает», а атрибуты не меняются — по кругу не шлём", () => {
    // Так было бы, если бы сервер молча пропускал запись: паузы растут, как у сбоев.
    let sync = IDLE_VOICE_SYNC;
    const waits: number[] = [];
    for (let i = 0; i < 4; i++) {
      sync = afterVoiceSync(sending(sync), { ok: true, sent: deaf }, NOW);
      waits.push(planVoiceSync(deaf, off, sync, NOW).sendInMs ?? -1);
    }
    expect(waits).toEqual([VOICE_SYNC_CONFIRM_MS, 5_000, 10_000, 20_000]);
  });
});
