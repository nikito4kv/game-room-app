// Общие кирпичики офлайн-оценки: WAV, ресемплинг, генераторы шумов клуба.
// Всё детерминировано (свой ГПСЧ), чтобы прогоны с разными настройками были сравнимы.
import fs from "node:fs";

export const SR = 48000;

/** Детерминированный ГПСЧ (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Гауссов шум из равномерного (Бокс — Мюллер). */
export function gauss(rand) {
  const u = Math.max(1e-12, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Читает PCM 16 бит WAV → { sampleRate, data: Float32Array (моно, среднее каналов) }. */
export function readWav(file) {
  const b = fs.readFileSync(file);
  let p = 12;
  let fmt;
  let data;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === "fmt ") fmt = { channels: b.readUInt16LE(p + 10), sampleRate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === "data") data = b.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size & 1);
  }
  if (!fmt || !data || fmt.bits !== 16) throw new Error(`${file}: ожидали PCM 16 бит`);
  const n = Math.floor(data.length / 2 / fmt.channels);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < fmt.channels; c++) s += data.readInt16LE((i * fmt.channels + c) * 2);
    out[i] = s / fmt.channels / 32768;
  }
  return { sampleRate: fmt.sampleRate, data: out };
}

/** Пишет моно Float32Array как PCM 16 бит WAV. */
export function writeWav(file, data, sampleRate = SR) {
  const b = Buffer.alloc(44 + data.length * 2);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + data.length * 2, 4);
  b.write("WAVEfmt ", 8, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) {
    const v = Math.max(-1, Math.min(1, data[i]));
    b.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, b);
}

/** Ресемплинг в целое число раз вверх (16 → 48 кГц) через sinc с окном Блэкмана. */
export function upsample(x, factor) {
  const half = 32 * factor;
  const taps = 2 * half + 1;
  const h = new Float64Array(taps);
  for (let i = 0; i < taps; i++) {
    const t = (i - half) / factor;
    const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    h[i] = sinc * w;
  }
  const y = new Float32Array(x.length * factor);
  for (let n = 0; n < y.length; n++) {
    let acc = 0;
    // вклад дают только x[k], для которых n − k·factor попадает в фильтр
    const kMin = Math.max(0, Math.ceil((n - half) / factor));
    const kMax = Math.min(x.length - 1, Math.floor((n + half) / factor));
    for (let k = kMin; k <= kMax; k++) acc += x[k] * h[n - k * factor + half];
    y[n] = acc;
  }
  return y;
}

/** Обрезает тишину по краям (порог −60 дБFS). */
export function trimSilence(x) {
  const thr = 1e-3;
  let a = 0;
  let b = x.length;
  while (a < b && Math.abs(x[a]) < thr) a++;
  while (b > a && Math.abs(x[b - 1]) < thr) b--;
  return x.slice(a, b);
}

/** Уровень активной речи: RMS по кадрам 10 мс громче (пик − 40 дБ). */
export function activeLevelDb(x) {
  const F = 480;
  const pw = [];
  for (let k = 0; k + F <= x.length; k += F) {
    let s = 0;
    for (let i = k; i < k + F; i++) s += x[i] * x[i];
    pw.push(s / F);
  }
  const peak = Math.max(...pw);
  const act = pw.filter((p) => p > peak * 1e-4);
  const mean = act.reduce((a, b) => a + b, 0) / Math.max(1, act.length);
  return 10 * Math.log10(mean + 1e-20);
}

export function scaleTo(x, targetDb, currentDb = activeLevelDb(x)) {
  const g = Math.pow(10, (targetDb - currentDb) / 20);
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] * g;
  return y;
}

/** Однополюсный ФНЧ/ФВЧ — грубая окраска для «далёкого» звука и шума. */
export function onePole(x, cutoffHz, type = "low") {
  const a = Math.exp((-2 * Math.PI * cutoffHz) / SR);
  const y = new Float32Array(x.length);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    s = (1 - a) * x[i] + a * s;
    y[i] = type === "low" ? s : x[i] - s;
  }
  return y;
}

/**
 * Реверберация «сосед в зале»: свёртка с синтетической импульсной
 * характеристикой (затухающий шум, RT60) плюс прямой звук. Свёртка блочная
 * по разреженной ИХ — быстрая и достаточная для оценки.
 */
export function reverb(x, rt60 = 0.5, wet = 0.6, seed = 7) {
  const rand = rng(seed);
  const len = Math.round(rt60 * SR);
  const decay = Math.log(1000) / len; // −60 дБ за rt60
  // Разреженная ИХ: отражение каждые ~0,5 мс со случайной амплитудой.
  const taps = [];
  for (let t = Math.round(0.004 * SR); t < len; t += 12 + Math.floor(rand() * 24)) {
    taps.push([t, gauss(rand) * Math.exp(-decay * t)]);
  }
  const norm = Math.sqrt(taps.reduce((s, [, a]) => s + a * a, 0));
  const y = new Float32Array(x.length + len);
  for (let i = 0; i < x.length; i++) y[i] += x[i] * (1 - wet * 0.5);
  for (const [t, a] of taps) {
    const g = (a / norm) * wet;
    for (let i = 0; i < x.length; i++) y[i + t] += x[i] * g;
  }
  return y;
}

/** Розовый шум (фильтр Пола Келлета) — кулеры, гул зала. */
export function pinkNoise(n, rand) {
  const y = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = gauss(rand) * 0.1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    y[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return y;
}

/** Сетевой гул 50 Гц с гармониками. */
export function hum(n, amp) {
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    y[i] = amp * (Math.sin(2 * Math.PI * 50 * t) + 0.5 * Math.sin(2 * Math.PI * 100 * t + 1) + 0.3 * Math.sin(2 * Math.PI * 150 * t + 2));
  }
  return y;
}

/**
 * Один удар клавиши (нажатие или отпускание): короткий шумовой щелчок с
 * резонансом корпуса. peak — пиковая амплитуда.
 */
export function keyClick(rand, peak) {
  const len = Math.round(0.025 * SR);
  const y = new Float32Array(len);
  const f1 = 2500 + rand() * 3000;
  const f2 = 600 + rand() * 900;
  const tauNoise = 0.0015 + rand() * 0.002;
  const tauRes = 0.004 + rand() * 0.004;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    y[i] =
      gauss(rand) * Math.exp(-t / tauNoise) +
      0.8 * Math.sin(2 * Math.PI * f1 * t) * Math.exp(-t / tauRes) +
      0.5 * Math.sin(2 * Math.PI * f2 * t) * Math.exp(-t / (tauRes * 2));
  }
  let max = 0;
  for (const v of y) max = Math.max(max, Math.abs(v));
  for (let i = 0; i < len; i++) y[i] *= peak / max;
  return y;
}

/** Смешать src в dst с позиции at (в сэмплах). */
export function mixInto(dst, src, at, gain = 1) {
  for (let i = 0; i < src.length && at + i < dst.length; i++) if (at + i >= 0) dst[at + i] += src[i] * gain;
}

/** RMS кадров по 480 сэмплов → массив мощностей. */
export function framePowers(x, F = 480) {
  const n = Math.floor(x.length / F);
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = k * F; i < (k + 1) * F; i++) s += x[i] * x[i];
    out[k] = s / F;
  }
  return out;
}

export const db = (p) => 10 * Math.log10(p + 1e-20);
