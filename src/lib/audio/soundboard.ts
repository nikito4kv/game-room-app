// Соундборд — короткие звуки «для всех» (ба-дум-тсс, та-дам, сверчки…). Как и
// звуки интерфейса (sfx.ts), это СИНТЕЗ на Web Audio: ни файлов, ни лицензий на
// чужие мемы. По сети идёт только имя звука (раздел «Соундборд» контракта),
// каждый браузер собирает звук сам — одинаково у всех.
//
// Звук — функция-рецепт: расставляет тоны и шумовые удары по времени и
// возвращает свою длину. Рецепты не знают, куда играют: renderSound годится и
// для живого контекста комнаты, и для OfflineAudioContext (проверка громкости
// и длины, scripts/soundboard-render.mjs), и для поддельного контекста в тестах.
//
// Модуль-синглтон, как sfx.ts: громкость и «слышать звуки других» — в
// localStorage (clientStorage), здесь горячая копия. Звучит через общий контекст
// воспроизведения (playback.ts) — в выбранное устройство вывода.

import { SOUND_FILE_MAX_SEC, type BuiltinSoundId, type SoundId } from "@/lib/api/contract";
import {
  getBoardEnabled,
  getBoardVolume,
  setBoardEnabled as persistEnabled,
  setBoardVolume as persistVolume,
} from "@/lib/clientStorage";
import { getPlaybackContext } from "./playback";

/** Самый длинный звук, с: шутка не должна перекрывать разговор. Тест держит рецепты в этом пределе. */
export const SOUND_MAX_SEC = 2.6;
/** Сколько звуков звучит сразу; следующие пропускаем, пока какой-то не кончится. */
export const MAX_VOICES = 3;

// ───────────────────────────── Синтез ─────────────────────────────

/** Где и когда играть: контекст, вход цепочки и начало звука (с, по часам контекста). */
type Stage = { ctx: BaseAudioContext; out: AudioNode; t0: number; rand: () => number };

type Filter = { type: BiquadFilterType; freq: number; q?: number; to?: number };

type ToneSpec = {
  freq: number;
  at?: number;
  dur: number;
  gain: number;
  type?: OscillatorType;
  /** Атака, с (по умолчанию 10 мс). */
  attack?: number;
  /** Удержание: сколько секунд звук стоит на пике перед спадом (у духовых). */
  hold?: number;
  /** Частота к концу тона (глиссандо). */
  glideTo?: number;
  /** Вибрато: частота и глубина в Гц, начинается через delay секунд. */
  vibrato?: { rate: number; depth: number; delay?: number };
  /** Расстройка, центы (вторая «труба» в аккорде звучит живее). */
  detune?: number;
  filter?: Filter;
  /** Перегруз (воздушная дудка): насколько сильно гнуть волну. */
  drive?: number;
};

type NoiseSpec = {
  at?: number;
  dur: number;
  gain: number;
  filter: Filter;
  attack?: number;
};

const SILENT = 0.0001;

/** Огибающая: тишина → пик за attack → держим hold → экспоненциальный спад к концу. */
function envelope(param: AudioParam, start: number, dur: number, peak: number, attack: number, hold: number): void {
  const a = Math.min(attack, dur * 0.4);
  const h = Math.min(hold, Math.max(0, dur - a - 0.02));
  param.setValueAtTime(SILENT, start);
  param.exponentialRampToValueAtTime(Math.max(SILENT, peak), start + a);
  if (h > 0) param.setValueAtTime(Math.max(SILENT, peak), start + a + h);
  param.exponentialRampToValueAtTime(SILENT, start + dur);
}

function makeFilter(s: Stage, f: Filter, start: number, dur: number): BiquadFilterNode {
  const node = s.ctx.createBiquadFilter();
  node.type = f.type;
  node.frequency.setValueAtTime(f.freq, start);
  if (f.to) node.frequency.exponentialRampToValueAtTime(f.to, start + dur);
  node.Q.value = f.q ?? 0.7;
  return node;
}

const driveCurves = new Map<number, Float32Array<ArrayBuffer>>();
function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  let curve = driveCurves.get(amount);
  if (!curve) {
    curve = new Float32Array(1024);
    const norm = Math.tanh(amount);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(amount * x) / norm;
    }
    driveCurves.set(amount, curve);
  }
  return curve;
}

function tone(s: Stage, t: ToneSpec): void {
  const start = s.t0 + (t.at ?? 0);
  const osc = s.ctx.createOscillator();
  osc.type = t.type ?? "sine";
  osc.frequency.setValueAtTime(t.freq, start);
  if (t.glideTo) osc.frequency.exponentialRampToValueAtTime(t.glideTo, start + t.dur);
  if (t.detune) osc.detune.value = t.detune;

  let head: AudioNode = osc;
  if (t.drive) {
    const shaper = s.ctx.createWaveShaper();
    shaper.curve = driveCurve(t.drive);
    head = head.connect(shaper);
  }
  if (t.filter) head = head.connect(makeFilter(s, t.filter, start, t.dur));
  const g = s.ctx.createGain();
  envelope(g.gain, start, t.dur, t.gain, t.attack ?? 0.01, t.hold ?? 0);
  head.connect(g).connect(s.out);

  const stop = start + t.dur + 0.05;
  if (t.vibrato) {
    const lfo = s.ctx.createOscillator();
    lfo.frequency.value = t.vibrato.rate;
    const depth = s.ctx.createGain();
    depth.gain.setValueAtTime(0, start);
    depth.gain.linearRampToValueAtTime(t.vibrato.depth, start + (t.vibrato.delay ?? 0) + 0.05);
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(start);
    lfo.stop(stop);
  }
  osc.start(start);
  osc.stop(stop);
}

/** Белый шум на секунду — один буфер на контекст, удары берут из него кусок. */
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext, rand: () => number): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

function noise(s: Stage, n: NoiseSpec): void {
  const start = s.t0 + (n.at ?? 0);
  const src = s.ctx.createBufferSource();
  src.buffer = noiseBuffer(s.ctx, s.rand);
  src.loop = true;
  const g = s.ctx.createGain();
  envelope(g.gain, start, n.dur, n.gain, n.attack ?? 0.002, 0);
  src
    .connect(makeFilter(s, n.filter, start, n.dur))
    .connect(g)
    .connect(s.out);
  // Случайное место в буфере: два удара подряд не звучат одинаково.
  src.start(start, s.rand() * 0.9);
  src.stop(start + n.dur + 0.05);
}

/** Медная «труба»: две слегка расстроенные пилы, фильтр раскрывается на атаке. */
function brass(s: Stage, freq: number, at: number, dur: number, gain: number, vibrato?: ToneSpec["vibrato"]): void {
  for (const detune of [-6, 6]) {
    tone(s, {
      freq,
      at,
      dur,
      gain: gain / 2,
      type: "sawtooth",
      attack: 0.03,
      hold: dur * 0.6,
      detune,
      vibrato,
      filter: { type: "lowpass", freq: 900, to: 2600, q: 1.2 },
    });
  }
}

/** Колокольчик: основной тон и два обертона, верхние гаснут быстрее. */
function bell(s: Stage, freq: number, at: number, dur: number, gain: number): void {
  tone(s, { freq, at, dur, gain, attack: 0.003 });
  tone(s, { freq: freq * 2, at, dur: dur * 0.6, gain: gain * 0.35, attack: 0.003 });
  tone(s, { freq: freq * 3.01, at, dur: dur * 0.3, gain: gain * 0.12, attack: 0.003 });
}

// ───────────────────────────── Рецепты ─────────────────────────────

type Recipe = (s: Stage) => number;

const RECIPES: Readonly<Record<BuiltinSoundId, Recipe>> = {
  // «Ба-дум-тсс»: малый, том и тарелка — после шутки.
  rimshot(s) {
    noise(s, { dur: 0.16, gain: 0.5, filter: { type: "bandpass", freq: 1900, q: 0.8 } });
    tone(s, { freq: 190, glideTo: 140, dur: 0.14, gain: 0.35, type: "triangle", attack: 0.002 });
    tone(s, { freq: 120, glideTo: 70, at: 0.2, dur: 0.32, gain: 0.6, attack: 0.002 });
    noise(s, { at: 0.2, dur: 0.08, gain: 0.15, filter: { type: "lowpass", freq: 900 } });
    // Тарелка: высокий шум с длинным хвостом и металлический «звон» из квадратов.
    noise(s, { at: 0.45, dur: 0.95, gain: 0.3, filter: { type: "highpass", freq: 7000, q: 0.5 } });
    for (const f of [410, 609, 739, 1045, 1080, 1600]) {
      tone(s, {
        freq: f,
        at: 0.45,
        dur: 0.7,
        gain: 0.035,
        type: "square",
        attack: 0.002,
        filter: { type: "bandpass", freq: 8000, q: 0.9 },
      });
    }
    return 1.45;
  },

  // «Та-дам!»: затакт и мажорный аккорд медью, под ним удар литавры.
  tada(s) {
    brass(s, 392, 0, 0.13, 0.2);
    brass(s, 523.25, 0, 0.13, 0.24);
    const vib = { rate: 5.5, depth: 4, delay: 0.3 };
    for (const f of [523.25, 659.25, 783.99, 1046.5]) brass(s, f, 0.17, 1.2, 0.15, vib);
    tone(s, { freq: 130.8, glideTo: 110, at: 0.17, dur: 0.6, gain: 0.45, attack: 0.004 });
    noise(s, { at: 0.17, dur: 0.25, gain: 0.12, filter: { type: "lowpass", freq: 500 } });
    return 1.45;
  },

  // Грустный тромбон «уа-уа-уа-уаааа»: четыре ноты вниз, «уа» — фильтр как сурдина.
  fail(s) {
    const notes: [number, number, number][] = [
      [196, 0, 0.42],
      [185, 0.45, 0.42],
      [174.61, 0.9, 0.42],
      [164.81, 1.35, 1.1],
    ];
    for (const [freq, at, dur] of notes) {
      const last = dur > 0.5;
      tone(s, {
        freq,
        at,
        dur,
        gain: 0.3,
        type: "sawtooth",
        attack: 0.05,
        hold: dur * 0.55,
        glideTo: last ? freq * 0.97 : undefined,
        vibrato: last ? { rate: 6, depth: 5, delay: 0.25 } : undefined,
        filter: { type: "lowpass", freq: 380, to: last ? 700 : 1300, q: 4 },
      });
    }
    return 2.5;
  },

  // Воздушная дудка: два коротких гудка и длинный — перегруженные пилы в кварту.
  horn(s) {
    const blasts: [number, number][] = [
      [0, 0.17],
      [0.24, 0.17],
      [0.48, 0.85],
    ];
    for (const [at, dur] of blasts) {
      for (const [freq, detune] of [
        [415, -8],
        [415, 9],
        [554, 0],
        [830, 4],
      ] as const) {
        tone(s, {
          freq: freq * 0.95,
          glideTo: freq,
          at,
          dur,
          gain: 0.075,
          type: "sawtooth",
          attack: 0.015,
          hold: dur * 0.7,
          detune,
          drive: 3,
          filter: { type: "highpass", freq: 320, q: 0.7 },
        });
      }
    }
    return 1.4;
  },

  // Сверчки — неловкая тишина: два сверчка, у каждого трели по три импульса.
  crickets(s) {
    const cricket = (freq: number, offset: number, chirps: number) => {
      for (let c = 0; c < chirps; c++) {
        for (let p = 0; p < 3; p++) {
          tone(s, { freq, at: offset + c * 0.55 + p * 0.042, dur: 0.028, gain: 0.3, attack: 0.004 });
        }
      }
    };
    cricket(4400, 0, 4);
    cricket(4050, 0.27, 3);
    return 2.2;
  },

  // «Верно!»: два колокольчика вверх, как в викторине.
  correct(s) {
    bell(s, 880, 0, 0.55, 0.32);
    bell(s, 1318.5, 0.14, 0.8, 0.32);
    return 1.0;
  },

  // «Мимо»: двойной зуммер — низкие квадраты бьются друг о друга.
  wrong(s) {
    for (const [at, dur] of [
      [0, 0.2],
      [0.27, 0.5],
    ] as const) {
      for (const freq of [98, 103.8]) {
        tone(s, {
          freq,
          at,
          dur,
          gain: 0.11,
          type: "square",
          attack: 0.008,
          hold: dur * 0.75,
          filter: { type: "lowpass", freq: 1500, q: 0.7 },
        });
      }
    }
    return 0.85;
  },

  // Аплодисменты: десятки хлопков в случайные моменты, волна нарастает и стихает.
  applause(s) {
    const len = 2.2;
    const swell = (t: number) =>
      t < 0.35 ? 0.4 + (t / 0.35) * 0.6 : t > 1.5 ? Math.max(0.15, 1 - (t - 1.5) / 0.75) : 1;
    for (let i = 0; i < 80; i++) {
      const at = s.rand() * (len - 0.1);
      noise(s, {
        at,
        dur: 0.03 + s.rand() * 0.04,
        gain: (0.3 + s.rand() * 0.45) * swell(at),
        filter: { type: "bandpass", freq: 900 + s.rand() * 1400, q: 1.1 },
        attack: 0.001,
      });
    }
    noise(s, { dur: len, gain: 0.2, attack: 0.2, filter: { type: "bandpass", freq: 1500, q: 0.5 } });
    return len + 0.1;
  },
};

/**
 * Расставить звук в контексте: начало t0 (по часам контекста), выход out.
 * Возвращает длину звука в секундах. Без побочных эффектов, кроме нод в ctx.
 */
export function renderSound(
  ctx: BaseAudioContext,
  out: AudioNode,
  id: BuiltinSoundId,
  t0: number,
  rand: () => number = Math.random,
): number {
  return RECIPES[id]({ ctx, out, t0, rand });
}

// ─────────────────────────── Воспроизведение ───────────────────────────

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let volume = 0.5;
let deafened = false;

type Voice = { owner: string; gain: GainNode; end: number };
let voices: Voice[] = [];

function ensureGraph(): AudioContext | null {
  const c = getPlaybackContext();
  if (!c) return null;
  if (c !== ctx) {
    ctx = c;
    voices = [];
    // Звуки складываются: три сразу не должны хрипеть, поэтому компрессор на выходе.
    master = c.createGain();
    master.gain.value = volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    master.connect(comp).connect(c.destination);
  }
  return ctx;
}

function fadeOut(c: AudioContext, v: Voice): void {
  const now = c.currentTime;
  v.gain.gain.cancelScheduledValues(now);
  v.gain.gain.setValueAtTime(v.gain.gain.value, now);
  v.gain.gain.linearRampToValueAtTime(0, now + 0.05);
  setTimeout(() => v.gain.disconnect(), 120);
}

/** Вшитый ли это (синтезируемый) звук. */
export function isBuiltinSound(id: string): id is BuiltinSoundId {
  return Object.hasOwn(RECIPES, id);
}

// ── Звуки из файлов: готовый набор и свои звуки комнаты ──

/**
 * Откуда взять файл звука: адрес по имени, null — такого звука нет. Задаёт
 * каталог комнаты (sounds/catalog.ts): он знает и набор, и звуки комнаты.
 */
let resolveUrl: (id: string) => string | null = () => null;
export function setSoundResolver(fn: (id: string) => string | null): void {
  resolveUrl = fn;
}

/** Скачанные и разобранные файлы по адресу. Нет файла — null (и повторять не будем, пока не перезагрузят). */
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function loadBuffer(c: AudioContext, url: string): Promise<AudioBuffer | null> {
  let p = buffers.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((data) => (data ? c.decodeAudioData(data) : null))
      .catch(() => null);
    buffers.set(url, p);
    // Неудача не залипает: следующий запрос попробует снова.
    void p.then((b) => {
      if (!b) buffers.delete(url);
    });
  }
  return p;
}

/** Подгрузить звук заранее (панель открыли — файлы уже готовы, нажатие без задержки). */
export function preloadBoardSound(id: SoundId): void {
  const url = resolveUrl(id);
  const c = getPlaybackContext();
  if (url && c) void loadBuffer(c, url);
}

/**
 * Сыграть звук. owner — чей он (identity): новый звук того же человека обрывает
 * его прежний. Больше MAX_VOICES сразу не звучит — лишний пропускаем.
 *   mine — свой звук по клику: выключатель «звуки других» его не глушит, «звук
 *          выкл» — глушит;
 *   preview — проба в настройках: звучит всегда.
 * Вшитые звучат сразу; файл, если он ещё не скачан, — когда скачается (в тот же
 * промежуток времени, что и у остальных). Возвращает, будет ли звук.
 */
export function playBoardSound(id: SoundId, owner: string, opts?: { mine?: boolean; preview?: boolean }): boolean {
  if (!opts?.preview && ((!enabled && !opts?.mine) || deafened)) return false;
  const c = ensureGraph();
  if (!c || !master) return false;
  const builtin = isBuiltinSound(id);
  const url = builtin ? null : resolveUrl(id);
  if (!builtin && !url) return false;
  if (c.state === "suspended") void c.resume();

  const now = c.currentTime;
  voices = voices.filter((v) => v.end > now);
  for (const v of voices.filter((x) => x.owner === owner)) fadeOut(c, v);
  voices = voices.filter((v) => v.owner !== owner);
  if (voices.length >= MAX_VOICES) return false;

  const gain = c.createGain();
  gain.connect(master);
  if (builtin) {
    const t0 = now + 0.01;
    const len = renderSound(c, gain, id, t0);
    const voice: Voice = { owner, gain, end: t0 + len };
    voices.push(voice);
    setTimeout(() => gain.disconnect(), (len + 0.3) * 1000);
    return true;
  }
  // Место в голосах занимаем сразу, чтобы второй звук не вклинился, пока файл едет.
  const voice: Voice = { owner, gain, end: now + SOUND_FILE_MAX_SEC };
  voices.push(voice);
  void loadBuffer(c, url as string).then((buf) => {
    // Пока скачивали, этот голос могли оборвать (новый звук того же человека, «звук выкл»).
    if (!buf || !voices.includes(voice)) {
      gain.disconnect();
      voices = voices.filter((v) => v !== voice);
      return;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    const len = Math.min(buf.duration, SOUND_FILE_MAX_SEC);
    // Длиннее потолка — обрезаем с лёгким затуханием, а не рубим.
    if (buf.duration > SOUND_FILE_MAX_SEC) {
      const t = c.currentTime + len;
      gain.gain.setValueAtTime(1, t - 0.1);
      gain.gain.linearRampToValueAtTime(0, t);
    }
    voice.end = c.currentTime + len;
    src.start();
    src.stop(c.currentTime + len + 0.05);
    setTimeout(() => gain.disconnect(), (len + 0.3) * 1000);
  });
  return true;
}

/** Один раз при входе: подтянуть настройки и поднять граф (после клика пользователя). */
export function initBoard(): void {
  enabled = getBoardEnabled();
  volume = getBoardVolume();
  ensureGraph();
  if (master) master.gain.value = volume;
}

export function setBoardEnabled(value: boolean): void {
  enabled = value;
  persistEnabled(value);
  // Выключили — то, что звучит, тоже замолкает.
  if (!value && ctx) for (const v of voices) fadeOut(ctx, v);
  if (!value) voices = [];
}
export function setBoardVolume(value: number): void {
  volume = value;
  persistVolume(value);
  if (master) master.gain.value = value;
}
/** «Звук выкл» в комнате глушит и соундборд. */
export function setBoardDeafened(value: boolean): void {
  deafened = value;
  if (value && ctx) for (const v of voices) fadeOut(ctx, v);
  if (value) voices = [];
}
