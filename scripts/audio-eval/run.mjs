// Офлайн-оценка обработки своего голоса (цепочка worklet «voice-processor»).
//
//   node scripts/audio-eval/run.mjs            — варианты настроек порога/цепочки на сценариях клуба
//   node scripts/audio-eval/run.mjs --models   — RNNoise против GTCRN (шумодав без порога)
//   node scripts/audio-eval/run.mjs --wav      — заодно сохранить выходы для прослушивания
//
// Сценарии: свой голос (TTS «Pavel» и запись .dev-stack/speech.wav) у микрофона,
// сосед в зале на 15/20/25 дБ тише, клавиатура, кулеры, гул 50 Гц. Цепочка — та же
// TS-логика, что и в браузере (src/lib/audio/worklet/dsp), собранная esbuild, + RNNoise wasm.
// Кэш TTS и результаты — в .cache/audio-eval/ (в git не идут).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { SR, db, framePowers, writeWav } from "./lib.mjs";
import { buildScenario } from "./scenario.mjs";
import { computeMetrics, ownActiveFrames, siSdr } from "./metrics.mjs";
import { createGtcrnDenoiser } from "./gtcrn.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CACHE = path.join(ROOT, ".cache", "audio-eval");
const ARGS = new Set(process.argv.slice(2));
fs.mkdirSync(CACHE, { recursive: true });

const dspFile = path.join(CACHE, "dsp.mjs");
await build({
  stdin: {
    contents:
      'export * from "./dsp/pipeline"; export * from "./dsp/rnnoise"; export * from "./dsp/envelope"; export * from "./dsp/biquad";',
    resolveDir: path.join(ROOT, "src", "lib", "audio", "worklet"),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile: dspFile,
  logLevel: "error",
});
const dsp = await import(`${pathToFileURL(dspFile).href}?t=${Date.now()}`);
const wasmDir = path.join(ROOT, "node_modules", "@sapphi-red", "web-noise-suppressor", "dist");
const rnnoiseModule = await WebAssembly.compile(fs.readFileSync(path.join(wasmDir, "rnnoise_simd.wasm")));

const SECONDS = ARGS.has("--quick") ? 60 : 120;
const NEIGHBOR_LEVELS = [15, 20, 25];
const OWNS = ["pavel", "speech"];

console.log("Собираю сценарии…");
const scenarios = [];
for (const own of OWNS)
  for (const neighborDb of NEIGHBOR_LEVELS)
    scenarios.push({ own, neighborDb, ownDb: -24, tracks: buildScenario({ cacheDir: CACHE, root: ROOT, own, neighborDb, seconds: SECONDS, seed: 17 }) });
// Тихий микрофон (далеко от рта / низкая чувствительность): порог не должен «душить» голос.
scenarios.push({
  own: "pavel",
  neighborDb: 20,
  ownDb: -36,
  tracks: buildScenario({ cacheDir: CACHE, root: ROOT, own: "pavel", neighborDb: 20, ownDb: -36, seconds: SECONDS, seed: 23 }),
});

/** Прогон цепочки по кадрам. Возвращает выход (выровненный по входу), огибающую порога и время кадров. */
async function runChain(mix, { settings = {}, tuning = {}, denoiser = "rnnoise" }) {
  const p = new dsp.VoicePipeline(SR, settings, tuning);
  if (denoiser === "rnnoise") p.setDenoiser(await dsp.createRnnoise(rnnoiseModule));
  else if (denoiser === "gtcrn") p.setDenoiser(await createGtcrnDenoiser(fs.readFileSync(path.join(wasmDir, "gtcrn.wasm"))));
  let reported = false;
  p.onGateChange = (open) => {
    reported = open;
  };
  const F = 480;
  const frames = Math.floor(mix.length / F);
  const out = new Float32Array(frames * F);
  const targets = new Uint8Array(frames);
  const times = new Float64Array(frames);
  const agcTrace = [];
  const inBuf = new Float32Array(F);
  const outBuf = new Float32Array(F);
  const off = (settings.gateMode ?? "auto") === "off";
  // Кадр, который цепочка выводит на шаге n, — кадр содержимого n − delay.
  const delay = Math.floor(p.latency / F);
  for (let n = 0; n < frames; n++) {
    inBuf.set(mix.subarray(n * F, (n + 1) * F));
    const t0 = performance.now();
    p.process(inBuf, outBuf);
    times[n] = performance.now() - t0;
    out.set(outBuf, n * F);
    // Огибающая выводимого кадра ведётся к «открыт в нём или в любом кадре
    // упреждения» — ровно то, что сообщает onGateChange на этом шаге.
    if (n >= delay) targets[n - delay] = off || reported ? 1 : 0;
    agcTrace.push(p.agc.gainDb);
  }
  const t = { ...dsp.DEFAULT_PIPELINE_TUNING, ...tuning };
  const env = new dsp.GateEnvelope(SR, t.attackMs, t.releaseMs);
  const gains = new Float32Array(frames * F);
  const ones = new Float32Array(F);
  for (let f = 0; f < frames; f++) {
    ones.fill(1);
    env.apply(ones, targets[f] === 1);
    gains.set(ones, f * F);
  }
  const aligned = new Float32Array(mix.length);
  aligned.set(out.subarray(p.latency));
  return { out: aligned, gains, times, agcTrace: agcTrace.slice(Math.floor(frames / 2)) };
}

const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");

async function evalVariant(variant) {
  const rows = [];
  for (const sc of scenarios) {
    const r = await runChain(sc.tracks.mix, variant);
    const m = computeMetrics({ tracks: sc.tracks, out: r.out, gains: r.gains, times: r.times, neighborDb: sc.neighborDb, ownDb: sc.ownDb, agcTrace: r.agcTrace });
    rows.push({ ...sc, m, r });
  }
  return rows;
}

function summarize(name, rows) {
  const all = rows.filter((x) => x.ownDb === -24);
  const quietMic = rows.filter((x) => x.ownDb !== -24);
  const by = (db) => all.filter((x) => x.neighborDb === db);
  const avg = (list, k) => list.reduce((a, x) => a + x.m[k], 0) / list.length;
  return {
    name,
    quietMic: { eaten: avg(quietMic, "eatenPct"), onset: avg(quietMic, "onsetMeanMs"), open: avg(quietMic, "neighborOpenPct") },
    leak: NEIGHBOR_LEVELS.map((d) => ({ d, open: avg(by(d), "neighborOpenPct"), db: avg(by(d), "neighborLeakDb") })),
    warm: avg(all, "neighborWarmOpenPct"),
    keys: avg(all, "keysOpenPct"),
    quiet: avg(all, "quietOpenPct"),
    eaten: avg(all, "eatenPct"),
    lost: avg(all, "lostEnergyPct"),
    onset: avg(all, "onsetMeanMs"),
    onsetMax: Math.max(...all.map((x) => x.m.onsetMaxMs)),
    offset: avg(all, "offsetMeanMs"),
    ramp: Math.min(...all.map((x) => x.m.minRampMs)),
    opens: avg(all, "opensPerMin"),
    cpu: avg(all, "cpuMeanMs"),
    cpu99: Math.max(...all.map((x) => x.m.cpuP99Ms)),
    speechDb: avg(all, "speechOutDb"),
    speechSd: avg(all, "speechOutSdDb"),
  };
}

function table(sums) {
  const head =
    "| Вариант | Сосед −15: открыт % / энергия дБ | −20 | −25 | Старт (сосед первым), % | Клавиатура, % | Тишина, % | Съедено речи, % | Потеряно энергии речи, % | Начало фразы, мс (ср/макс) | Конец, мс | Открытий/мин | Самая быстрая рампа, мс | CPU кадр, мс (ср/p99) | Речь на выходе, дБFS (σ) | Тихий микрофон −36: съедено % / начало мс / сосед % |";
  const sep = `|${"---|".repeat(16)}`;
  const lines = sums.map(
    (s) =>
      `| ${s.name} | ${s.leak.map((l) => `${fmt(l.open)} / ${fmt(l.db)}`).join(" | ")} | ${fmt(s.warm)} | ${fmt(s.keys)} | ${fmt(s.quiet)} | ${fmt(s.eaten, 2)} | ${fmt(s.lost, 2)} | ${fmt(s.onset)} / ${fmt(s.onsetMax)} | ${fmt(s.offset)} | ${fmt(s.opens)} | ${fmt(s.ramp, 1)} | ${fmt(s.cpu, 3)} / ${fmt(s.cpu99, 3)} | ${fmt(s.speechDb)} (${fmt(s.speechSd)}) | ${fmt(s.quietMic.eaten, 2)} / ${fmt(s.quietMic.onset)} / ${fmt(s.quietMic.open)} |`,
  );
  return [head, sep, ...lines].join("\n");
}

if (ARGS.has("--models")) {
  await compareModels();
  process.exit(0);
}

/**
 * RNNoise против GTCRN: шумодав без порога и без автогромкости. Чище ли свой голос
 * (SI-SDR по кадрам речи), насколько тише клавиатура и кулеры в паузах, сколько
 * стоит кадр 10 мс и какая у модели своя задержка.
 */
async function compareModels() {
  const cases = [
    { label: "Pavel, без соседа", tracks: buildScenario({ cacheDir: CACHE, root: ROOT, own: "pavel", neighborDb: 300, seconds: SECONDS, seed: 17 }) },
    { label: "speech.wav, без соседа", tracks: buildScenario({ cacheDir: CACHE, root: ROOT, own: "speech", neighborDb: 300, seconds: SECONDS, seed: 17 }) },
    { label: "Pavel, сосед −20", tracks: scenarios.find((s) => s.own === "pavel" && s.neighborDb === 20).tracks },
  ];
  const lines = [
    "| Модель | Сценарий | SI-SDR своей речи, дБ | Клавиатура в паузах, дБ к входу | Кулер/гул в паузах, дБ к входу | CPU кадр 10 мс, мс (ср / p99) | Своя задержка, мс |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const model of ["none", "rnnoise", "gtcrn"]) {
    for (const c of cases) {
      const { tracks } = c;
      const r = await runChain(tracks.mix, {
        settings: { gateMode: "off", noiseSuppression: model !== "none", autoGain: false },
        denoiser: model === "none" ? null : model,
      });
      // Модель со своей задержкой (GTCRN) выравниваем по корреляции с чистым голосом.
      const lag = bestLag(tracks.own, r.out);
      const est = r.out.subarray(lag);
      // Эталон — чистый голос через тот же ФВЧ 80 Гц: иначе SI-SDR мерил бы сдвиг фазы фильтра, а не шумодав.
      const ref = Float32Array.from(tracks.own);
      dsp.Biquad.highpass(SR, dsp.DEFAULT_PIPELINE_TUNING.highpassHz).process(ref);
      const ownP = framePowers(tracks.own);
      const own = ownActiveFrames(ownP);
      const neiP = framePowers(tracks.neighbor);
      const keyP = framePowers(tracks.keys);
      const outP = framePowers(est);
      const inP = framePowers(tracks.mix);
      const speech = [];
      let ko = 0, ki = 0, fo = 0, fi = 0;
      for (let f = 1500; f < Math.min(outP.length, own.length); f++) {
        if (own[f]) speech.push(f);
        let near = false;
        for (let k = Math.max(0, f - 40); k <= f + 3 && k < own.length; k++) near ||= own[k];
        if (near || neiP[f] > 1e-9) continue;
        if (keyP[f] > 1e-6) { ko += outP[f]; ki += inP[f]; }
        else { fo += outP[f]; fi += inP[f]; }
      }
      const t = Array.from(r.times).sort((a, b) => a - b);
      const mean = t.reduce((a, b) => a + b, 0) / t.length;
      lines.push(
        `| ${model} | ${c.label} | ${fmt(siSdr(ref, est, speech))} | ${fmt(db(ko) - db(ki))} | ${fmt(db(fo) - db(fi))} | ${fmt(mean, 3)} / ${fmt(t[Math.floor(t.length * 0.99)], 3)} | ${fmt((lag / SR) * 1000, 1)} |`,
      );
    }
  }
  const text = lines.join("\n");
  console.log(text);
  fs.writeFileSync(path.join(CACHE, "models.md"), `${text}\n`);
}

/** Сдвиг выхода относительно чистого голоса (в сэмплах) по максимуму корреляции. */
function bestLag(clean, est) {
  let best = 0;
  let bestV = -Infinity;
  const from = 20 * SR;
  const len = 10 * SR;
  for (let lag = 0; lag < 6000; lag += 8) {
    let s = 0;
    for (let i = from; i < from + len; i += 4) s += clean[i] * est[i + lag];
    if (s > bestV) {
      bestV = s;
      best = lag;
    }
  }
  for (let lag = Math.max(0, best - 8); lag <= best + 8; lag++) {
    let s = 0;
    for (let i = from; i < from + len; i++) s += clean[i] * est[i + lag];
    if (s > bestV) {
      bestV = s;
      best = lag;
    }
  }
  return best;
}

const VARIANTS = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "variants.json"), "utf8"));
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const sums = [];
for (const v of VARIANTS) {
  if (only && !only.includes(v.name)) continue;
  const rows = await evalVariant(v);
  const s = summarize(v.name, rows);
  if (ARGS.has("--detail"))
    for (const x of rows)
      console.log(
        `  ${x.own} ${x.ownDb} n${x.neighborDb}: сосед ${fmt(x.m.neighborOpenPct)} % (${fmt(x.m.neighborLeakDb)} дБ), съедено ${fmt(x.m.eatenPct, 2)} %, начало ${fmt(x.m.onsetMeanMs)}/${fmt(x.m.onsetMaxMs)} мс, фраз ${x.m.frames.utterances}`,
      );
  sums.push(s);
  console.log(`${v.name}: сосед −20 открыт ${fmt(s.leak[1].open)} %, съедено ${fmt(s.eaten, 2)} %, начало ${fmt(s.onset)} мс`);
  if (ARGS.has("--wav") && v.name === VARIANTS[0].name) {
    for (const r of rows) {
      const tag = `${r.own}-n${r.neighborDb}`;
      writeWav(path.join(CACHE, `in-${tag}.wav`), r.tracks.mix);
      writeWav(path.join(CACHE, `out-${tag}.wav`), r.r.out);
    }
  }
}
const report = table(sums);
console.log(`\n${report}`);
fs.writeFileSync(path.join(CACHE, "report.md"), report + "\n");
