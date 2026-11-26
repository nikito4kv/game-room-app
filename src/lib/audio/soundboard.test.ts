import { describe, expect, it } from "vitest";
import { BUILTIN_SOUND_IDS } from "@/lib/api/contract";
import { SOUND_MAX_SEC, renderSound } from "./soundboard";

// Поддельный контекст Web Audio: записывает всё, что рецепт запланировал, и
// падает там, где упал бы браузер (экспоненциальный спад к нулю, NaN).

type Event = { what: string; t: number };

function fakeContext() {
  const events: Event[] = [];
  let nodes = 0;
  const check = (what: string, t: number, v?: number) => {
    if (!Number.isFinite(t) || t < 0) throw new Error(`${what}: время ${t}`);
    if (v !== undefined && !Number.isFinite(v)) throw new Error(`${what}: значение ${v}`);
    events.push({ what, t });
  };
  const param = (name: string) => ({
    value: 0,
    setValueAtTime: (v: number, t: number) => check(`${name}.set`, t, v),
    linearRampToValueAtTime: (v: number, t: number) => check(`${name}.linear`, t, v),
    exponentialRampToValueAtTime: (v: number, t: number) => {
      // Браузер бросает RangeError на ноль: спад делается к 0.0001.
      if (v <= 0) throw new RangeError(`${name}: экспоненциальный спад к ${v}`);
      check(`${name}.exp`, t, v);
    },
  });
  const node = (extra: Record<string, unknown> = {}) => {
    nodes++;
    return {
      connect: (to: unknown) => to,
      disconnect: () => {},
      ...extra,
    };
  };
  const source = (kind: string) =>
    node({
      start: (t: number, offset?: number) => {
        check(`${kind}.start`, t);
        if (offset !== undefined && !(offset >= 0 && offset < 1)) throw new Error(`смещение ${offset}`);
      },
      stop: (t: number) => check(`${kind}.stop`, t),
    });
  const ctx = {
    sampleRate: 48_000,
    currentTime: 0,
    createOscillator: () => ({ ...source("osc"), type: "sine", frequency: param("freq"), detune: param("detune") }),
    createGain: () => ({ ...node(), gain: param("gain") }),
    createBiquadFilter: () => ({ ...node(), type: "lowpass", frequency: param("cutoff"), Q: param("q") }),
    createWaveShaper: () => ({ ...node(), curve: null }),
    createBufferSource: () => ({ ...source("noise"), buffer: null, loop: false }),
    createBuffer: (_ch: number, length: number) => {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
  };
  return { ctx: ctx as unknown as BaseAudioContext, events, nodes: () => nodes };
}

/** Повторяемый «случайный» ряд: тест не зависит от Math.random. */
function seeded(seed = 1) {
  let x = seed;
  return () => {
    x = (x * 16807) % 2147483647;
    return (x - 1) / 2147483646;
  };
}

describe("рецепты соундборда", () => {
  for (const id of BUILTIN_SOUND_IDS) {
    it(`${id}: собирается без ошибок браузера, длина в пределе, всё внутри своей длины`, () => {
      const { ctx, events, nodes } = fakeContext();
      const t0 = 10;
      const out = {} as AudioNode;
      const len = renderSound(ctx, out, id, t0, seeded());
      expect(len).toBeGreaterThan(0.3);
      expect(len).toBeLessThanOrEqual(SOUND_MAX_SEC);
      expect(events.length).toBeGreaterThan(0);
      for (const e of events) {
        expect(e.t, `${e.what} раньше начала`).toBeGreaterThanOrEqual(t0);
        // Хвост остановки — до 50 мс после конца огибающей.
        expect(e.t, `${e.what} после конца звука`).toBeLessThanOrEqual(t0 + len + 0.06);
      }
      // Звук что-то запускает и всё запущенное останавливает.
      const starts = events.filter((e) => e.what.endsWith(".start")).length;
      const stops = events.filter((e) => e.what.endsWith(".stop")).length;
      expect(starts).toBeGreaterThan(0);
      expect(stops).toBe(starts);
      // Нод немного: десять звуков подряд не должны подвесить слабый ноутбук.
      expect(nodes()).toBeLessThan(500);
    });
  }
});
