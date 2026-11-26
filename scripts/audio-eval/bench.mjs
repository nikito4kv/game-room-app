// Живая проверка обработки голоса в Chrome на своём дев-сервере:
//   node scripts/audio-eval/bench.mjs http://localhost:3102 [--csp=prod|nowasm]
//
// Собирает страницу-стенд (bench-page.ts + настоящий MicProcessor) во временную
// public/audio/bench, открывает её в headless Chrome с фейковым микрофоном
// (.dev-stack/speech.wav) и проверяет: статусы, звук идёт, порог открывается и
// закрывается, нет щелчков, метрики приходят ~30 раз/с, время кадра цепочки.
// Временная папка удаляется в конце.
//
// --csp=prod — подставить странице CSP как в production (next.config.ts: на dev её
// нет): worklet и wasm должны работать. --csp=nowasm — та же CSP без
// 'wasm-unsafe-eval': шумодав обязан честно сообщить error, а звук — идти дальше.
// --no-worklet — файл worklet не отдаётся: запасная цепочка (моно → усиление →
// лимитер), статус error/worklet, метрики уровня идут, событий порога нет.
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const BASE = process.argv[2] ?? "http://localhost:3102";
const CSP_MODE = process.argv.find((a) => a.startsWith("--csp="))?.slice(6);
const NO_WORKLET = process.argv.includes("--no-worklet");
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "public", "audio", "bench");
const WAV = path.join(ROOT, ".dev-stack", "speech.wav");
const SHOTS = process.env.BENCH_SHOTS;
const PROD_CSP = (wasm) =>
  [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${wasm ? " 'wasm-unsafe-eval'" : ""}`,
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");

fs.mkdirSync(OUT, { recursive: true });
await build({
  entryPoints: [path.join(import.meta.dirname, "bench-page.ts")],
  outfile: path.join(OUT, "bench.js"),
  bundle: true,
  format: "esm",
  target: "es2020",
  logLevel: "warning",
});
fs.writeFileSync(
  path.join(OUT, "tap.js"),
  `registerProcessor("tap", class extends AudioWorkletProcessor {
  process(inputs) { const x = inputs[0] && inputs[0][0]; if (x) this.port.postMessage(x.slice(0)); return true; }
});`,
);
fs.writeFileSync(
  path.join(OUT, "index.html"),
  '<!doctype html><meta charset="utf-8"><title>Стенд обработки голоса</title><script type="module" src="bench.js"></script>',
);

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${WAV}`,
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const page = await (await browser.newContext({ permissions: ["microphone"] })).newPage();
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
if (CSP_MODE || NO_WORKLET) {
  // Загрузку модуля AudioWorklet page.route не перехватывает — отрезаем worklet
  // через CSP: скрипты разрешены только из папки стенда.
  const csp = NO_WORKLET ? `script-src ${BASE}/audio/bench/ 'wasm-unsafe-eval'` : PROD_CSP(CSP_MODE === "prod");
  await page.route("**/audio/bench/index.html", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": csp } });
  });
}
await page.goto(`${BASE}/audio/bench/index.html`, { waitUntil: "load", timeout: 120000 });
await page.waitForFunction(() => window.__bench?.done, null, { timeout: 90000, polling: 500 });
if (SHOTS && process.env.BENCH_DUMP) {
  // Записи входа и выхода — для разбора на слух и в редакторе.
  const { writeWav } = await import("./lib.mjs");
  for (const key of ["out", "raw"]) {
    const data = await page.evaluate((k) => Array.from(window.__bench[k] ?? []), key);
    writeWav(path.join(SHOTS, `bench-${key}.wav`), Float32Array.from(data));
  }
}

const r = await page.evaluate(() => {
  const b = window.__bench;
  // «Скачок из тишины»: после ≥ 0,7 мс честной тишины сразу громко (атака порога
  // 5 мс так не умеет). Одиночный ноль не считается — это просто переход громкого
  // сигнала через ноль.
  const jumps = (x, minAmp) => {
    const at = [];
    let quiet = 0;
    for (let i = 0; i < x.length; i++) {
      const a = Math.abs(x[i]);
      if (a > minAmp && quiet >= 32) at.push(i);
      quiet = a < 1e-6 ? quiet + 1 : 0;
    }
    return at;
  };
  const stats = (x) => {
    if (!x) return null;
    let zeros = 0;
    let sum = 0;
    let maxJump = 0;
    for (let i = 1; i < x.length; i++) {
      if (x[i] === 0) zeros++;
      sum += x[i] * x[i];
      const d = Math.abs(x[i] - x[i - 1]);
      if (d > maxJump) maxJump = d;
    }
    return { seconds: x.length / 48000, zerosPct: (zeros / x.length) * 100, rmsDb: 10 * Math.log10(sum / x.length + 1e-20), maxJump, fromSilence: jumps(x, 0.01).length };
  };
  // Щелчок цепочки — скачок на выходе, у которого нет пары во входе на 0–75 мс
  // раньше (задержка обработки). Скачки самого исходника (склейки в speech.wav,
  // усиленные до 200 %) щелчками цепочки не считаются.
  // Первые 2 с не считаем: поток стартует посреди речи (как включение микрофона на
  // полуслове), у запасной цепочки — без плавного открытия порога.
  const outJumps = b.out ? jumps(b.out, 0.01).filter((t) => t > 2 * 48000) : [];
  const rawJumps = b.raw ? jumps(b.raw, 0.0005) : [];
  const unexplainedClicks = outJumps.filter((t) => !rawJumps.some((r) => t - r >= 0 && t - r <= 3600)).length;
  const meters = b.meters;
  const span = meters.length > 1 ? (meters[meters.length - 1].t - meters[0].t) / 1000 : 0;
  // время кадра — скользящее среднее в worklet; берём вторую половину прогона (JIT прогрет)
  const fm = meters.slice(Math.floor(meters.length / 2)).map((m) => m.frameMs).filter((v) => Number.isFinite(v));
  return {
    error: b.error,
    statuses: b.statuses.map((s) => `${s.t}мс ${s.state}${s.reason ? `/${s.reason}` : ""}${s.blocked ? " blocked" : ""}`),
    ns: b.ns,
    gates: b.gates.length,
    firstGates: b.gates.slice(0, 6).map((g) => `${g.t}:${g.open ? "откр" : "закр"}`),
    meterRate: span ? meters.length / span : 0,
    meterSample: meters[Math.floor(meters.length / 2)],
    frameMs: fm.length ? { mean: fm.reduce((a, c) => a + c, 0) / fm.length, max: Math.max(...fm), n: fm.length } : null,
    mainThread: b.mainThread,
    calibration: b.calibration,
    out: stats(b.out),
    raw: stats(b.raw),
    unexplainedClicks,
  };
});
await browser.close();
fs.rmSync(OUT, { recursive: true, force: true });

console.log(JSON.stringify(r, null, 2));
if (logs.length) console.log("консоль страницы:", logs.slice(0, 10));
const tag = NO_WORKLET ? "-no-worklet" : CSP_MODE ? `-csp-${CSP_MODE}` : "";
if (SHOTS) fs.writeFileSync(path.join(SHOTS, `bench${tag}.json`), JSON.stringify(r, null, 2));
const ready = r.statuses.some((s) => s.includes("ready"));
const sound = r.out?.rmsDb > -60 && r.unexplainedClicks === 0 && r.meterRate > 25;
let ok;
if (NO_WORKLET) {
  // запасная цепочка: звук идёт, статус честный, порога (и его событий) нет
  ok = r.statuses.some((s) => s.includes("error/worklet")) && r.ns.includes(false) && sound && r.gates === 0;
} else if (CSP_MODE === "nowasm") {
  // шумодав честно сломан (статус error, тумблер false), а голос идёт и порог работает
  ok = !ready && r.statuses.some((s) => s.includes("error")) && r.ns.includes(false) && sound && r.gates >= 2;
} else {
  ok = !r.error && ready && sound && r.gates >= 2 && r.out?.zerosPct > 5 && r.mainThread?.meanMs < 1;
}
console.log(ok ? "ИТОГ: OK" : "ИТОГ: ПРОВАЛ");
process.exit(ok ? 0 : 1);
