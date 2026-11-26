// Метрики офлайн-оценки. Всё считается во «времени содержимого»: выход цепочки
// заранее сдвинут на её задержку, так что кадр f выхода — это кадр f входа.
import { db, framePowers, SR } from "./lib.mjs";

const F = 480;
const FRAME_MS = (F / SR) * 1000;
/** Охрана вокруг своей речи: удержание + отпускание после и упреждение до. */
const GUARD_AFTER = 40; // 400 мс
const GUARD_BEFORE = 3; // 30 мс

/** Кадры «своей речи»: дорожка своего голоса не тише её уровня минус 31 дБ (−55 дБFS для −24). */
function ownActiveFrames(ownP, ownDb = -24) {
  return Array.from(ownP, (p) => p > Math.pow(10, (ownDb - 31) / 10));
}

function nearOwn(active) {
  const near = new Array(active.length).fill(false);
  for (let f = 0; f < active.length; f++) {
    if (!active[f]) continue;
    for (let k = Math.max(0, f - GUARD_BEFORE); k <= Math.min(active.length - 1, f + GUARD_AFTER); k++) near[k] = true;
  }
  return near;
}

/** Фразы своей речи: активные кадры, склеенные через паузы < 300 мс. */
function utterances(active) {
  const out = [];
  let start = -1;
  let last = -1;
  for (let f = 0; f < active.length; f++) {
    if (!active[f]) continue;
    if (start < 0) start = f;
    else if (f - last > 30) {
      out.push([start, last]);
      start = f;
    }
    last = f;
  }
  if (start >= 0) out.push([start, last]);
  return out;
}

const pct = (arr, p) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
};

/**
 * gains — множитель огибающей порога по сэмплам (во времени содержимого);
 * out — выход цепочки, выровненный по входу.
 */
export function computeMetrics({ tracks, out, gains, times, neighborDb, ownDb = -24, warmupSec = 15, agcTrace }) {
  const ownP = framePowers(tracks.own);
  const neiP = framePowers(tracks.neighbor);
  const keyP = framePowers(tracks.keys);
  const outP = framePowers(out);
  const frames = Math.min(ownP.length, outP.length, Math.floor(gains.length / F));
  const gP = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * F; i < (f + 1) * F; i++) s += gains[i] * gains[i];
    gP[f] = s / F;
  }
  const ownAct = ownActiveFrames(ownP, ownDb).slice(0, frames);
  const near = nearOwn(ownAct);
  const neiThr = Math.pow(10, (ownDb - neighborDb - 20) / 10);
  const warm = Math.round((warmupSec * 1000) / FRAME_MS);

  const sets = { neighbor: [], keys: [], quiet: [], neighborWarm: [] };
  for (let f = 0; f < frames; f++) {
    if (near[f]) continue;
    const nei = neiP[f] > neiThr;
    const key = keyP[f] > 1e-6;
    if (nei) (f < warm ? sets.neighborWarm : sets.neighbor).push(f);
    else if (f >= warm && key) sets.keys.push(f);
    else if (f >= warm) sets.quiet.push(f);
  }
  const openShare = (list) => (list.length ? list.filter((f) => gP[f] > 0.25).length / list.length : NaN);
  const leakDb = (list, refP) => {
    let o = 0;
    let r = 0;
    for (const f of list) {
      o += outP[f];
      r += refP[f];
    }
    return list.length ? db(o) - db(r) : NaN;
  };

  // Своя речь: «съеденные» кадры и потерянная энергия.
  let eaten = 0;
  let actCount = 0;
  let eOwn = 0;
  let eLost = 0;
  for (let f = 0; f < frames; f++) {
    if (!ownAct[f]) continue;
    actCount++;
    if (gP[f] < 0.25) eaten++;
    for (let i = f * F; i < (f + 1) * F; i++) {
      const s2 = tracks.own[i] * tracks.own[i];
      eOwn += s2;
      eLost += s2 * (1 - gains[i] * gains[i]);
    }
  }

  // Начало и конец фраз: сколько мс от начала речи до открытия (g ≥ 0,5)
  // и сколько мс конца фразы прошло при уже закрытом пороге.
  const thr = Math.pow(10, (ownDb - 26) / 20); // −50 дБFS для голоса −24
  const onsets = [];
  const offsets = [];
  for (const [a, b] of utterances(ownAct)) {
    let on = a * F;
    while (on < (b + 1) * F && Math.abs(tracks.own[on]) < thr) on++;
    let off = Math.min(gains.length - 1, (b + 1) * F - 1);
    while (off > on && Math.abs(tracks.own[off]) < thr) off--;
    let t = on;
    while (t <= off && gains[t] < 0.5) t++;
    onsets.push(((t - on) / SR) * 1000);
    let lastOpen = off;
    while (lastOpen > on && gains[lastOpen] < 0.5) lastOpen--;
    offsets.push(((off - lastOpen) / SR) * 1000);
  }

  // Щелчки: самый резкий шаг огибающей (в пересчёте — за сколько мс она прошла бы 0→1).
  let maxStep = 0;
  for (let i = 1; i < gains.length; i++) maxStep = Math.max(maxStep, Math.abs(gains[i] - gains[i - 1]));
  // «Дребезг»: сколько раз в минуту порог открывался.
  let opens = 0;
  for (let i = 1; i < gains.length; i += 48) if (gains[i] >= 0.5 && gains[i - 48 < 0 ? 0 : i - 48] < 0.5) opens++;

  const tSorted = Array.from(times).sort((a, b) => a - b);
  const meanMs = times.reduce((a, b) => a + b, 0) / times.length;

  // Своя автогромкость: уровень речи на выходе по фразам после прогрева.
  const uttLevels = [];
  for (const [a, b] of utterances(ownAct)) {
    if (a < warm) continue;
    let s = 0;
    for (let f = a; f <= b; f++) s += outP[f];
    uttLevels.push(db(s / (b - a + 1)));
  }
  const meanLvl = uttLevels.reduce((x, y) => x + y, 0) / Math.max(1, uttLevels.length);
  const sdLvl = Math.sqrt(uttLevels.reduce((x, y) => x + (y - meanLvl) ** 2, 0) / Math.max(1, uttLevels.length));

  return {
    neighborOpenPct: openShare(sets.neighbor) * 100,
    neighborLeakDb: leakDb(sets.neighbor, neiP),
    neighborWarmOpenPct: openShare(sets.neighborWarm) * 100,
    keysOpenPct: openShare(sets.keys) * 100,
    keysLeakDb: leakDb(sets.keys, keyP),
    quietOpenPct: openShare(sets.quiet) * 100,
    eatenPct: (eaten / Math.max(1, actCount)) * 100,
    lostEnergyPct: (eLost / Math.max(1e-20, eOwn)) * 100,
    onsetMeanMs: onsets.reduce((a, b) => a + b, 0) / Math.max(1, onsets.length),
    onsetMaxMs: Math.max(0, ...onsets),
    offsetMeanMs: offsets.reduce((a, b) => a + b, 0) / Math.max(1, offsets.length),
    offsetP90Ms: pct(offsets, 0.9),
    minRampMs: maxStep > 0 ? (1 / maxStep / SR) * 1000 : Infinity,
    opensPerMin: opens / (gains.length / SR / 60),
    cpuMeanMs: meanMs,
    cpuP99Ms: tSorted[Math.floor(tSorted.length * 0.99)],
    speechOutDb: meanLvl,
    speechOutSdDb: sdLvl,
    agcRange: agcTrace ? [Math.min(...agcTrace), Math.max(...agcTrace)] : null,
    frames: { neighbor: sets.neighbor.length, keys: sets.keys.length, quiet: sets.quiet.length, utterances: onsets.length },
  };
}

/** SI-SDR (дБ) выхода относительно чистого своего голоса по кадрам своей речи. */
export function siSdr(clean, est, frames) {
  let dot = 0;
  let ss = 0;
  for (const f of frames)
    for (let i = f * F; i < (f + 1) * F; i++) {
      dot += clean[i] * est[i];
      ss += clean[i] * clean[i];
    }
  const a = dot / Math.max(1e-20, ss);
  let num = 0;
  let den = 0;
  for (const f of frames)
    for (let i = f * F; i < (f + 1) * F; i++) {
      const t = a * clean[i];
      num += t * t;
      den += (est[i] - t) * (est[i] - t);
    }
  return db(num) - db(den);
}

export { ownActiveFrames, FRAME_MS };
