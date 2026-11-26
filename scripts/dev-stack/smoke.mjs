// Дымовой e2e на локальном стенде: два «человека» в headless Chrome заходят в одну
// комнату через лобби (ник → «Войти в комнату») и слышат друг друга. Меряет
// громкость собеседника отдельно по левому и правому каналу — ловит «одно ухо» и
// тихий голос. Протокол v2: первый входит с ключом владельца и становится хостом.
//
//   node scripts/dev-stack/smoke.mjs [http://localhost:3000]
//
// Нужны: запущенный стенд (npm run stack), дев-сервер сайта, системный Chrome.
// Голос — .dev-stack/speech.wav (речь 48 кГц; любой wav подойдёт).
import path from "node:path";
import fs from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.argv[2] ?? "http://localhost:3000"; // не 127.0.0.1: Next dev отдаёт свои скрипты только своему origin
const ROOT = path.resolve(import.meta.dirname, "../..");
const WAV = path.join(ROOT, ".dev-stack", "speech.wav");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Встраивается в страницу до её скриптов: ловит входящие аудиодорожки и меряет
// L/R так, как их услышали бы динамики (апмикс моно → оба канала).
function installMeter() {
  // LiveKit держит одно соединение с заранее созданными приёмниками, поэтому
  // событие «track» ненадёжно — раз в секунду просто обходим приёмники.
  const pcs = [];
  const Orig = window.RTCPeerConnection;
  window.RTCPeerConnection = function (...a) {
    const pc = new Orig(...a);
    pcs.push(pc);
    return pc;
  };
  window.RTCPeerConnection.prototype = Orig.prototype;
  Object.setPrototypeOf(window.RTCPeerConnection, Orig);
  const meters = new Map();
  setInterval(() => {
    const tracks = pcs.flatMap((pc) =>
      pc.connectionState === "closed" ? [] : pc.getReceivers().map((r) => r.track),
    );
    for (const t of tracks) {
      if (!t || t.kind !== "audio" || meters.has(t.id) || t.readyState !== "live" || t.muted) continue;
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(new MediaStream([t]));
      const up = ctx.createGain();
      up.channelCount = 2;
      up.channelCountMode = "explicit";
      up.channelInterpretation = "speakers";
      const split = ctx.createChannelSplitter(2);
      const l = ctx.createAnalyser();
      const r = ctx.createAnalyser();
      src.connect(up).connect(split);
      split.connect(l, 0);
      split.connect(r, 1);
      const acc = { L: 0, R: 0, n: 0 };
      const buf = new Float32Array(l.fftSize);
      const rms = (a) => {
        a.getFloatTimeDomainData(buf);
        let s = 0;
        for (const v of buf) s += v * v;
        return Math.sqrt(s / buf.length);
      };
      setInterval(() => {
        const L = rms(l), R = rms(r);
        if (L > 0.003 || R > 0.003) {
          acc.L += L;
          acc.R += R;
          acc.n++;
        }
      }, 50);
      meters.set(t.id, acc);
    }
  }, 1000);
  window.__levels = () =>
    [...meters.values()]
      .filter((a) => a.n > 0)
      .map((a) => ({
        L: +(a.L / a.n).toFixed(4),
        R: +(a.R / a.n).toFixed(4),
        frames: a.n,
      }));
}

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    ...(fs.existsSync(WAV) ? [`--use-file-for-fake-audio-capture=${WAV}`] : []),
    "--autoplay-policy=no-user-gesture-required",
  ],
});

async function person(nick, code, hostKey) {
  const ctx = await browser.newContext({ permissions: ["microphone"] });
  await ctx.addInitScript(installMeter);
  await ctx.addInitScript(
    ([n, c, k]) => {
      localStorage.setItem("gr.nickname", n);
      if (k) localStorage.setItem(`gr.host.${c}`, k);
    },
    [nick, code, hostKey],
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${BASE}/room/${code}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  // Лобби: ник подставлен из gr.nickname, вход — кнопкой (это и жест для звука).
  const nickField = page.locator('[data-testid="join-nickname"]');
  await nickField.waitFor({ timeout: 180000 });
  await nickField.fill(nick);
  await page.locator('[data-testid="join-submit"]').click();
  return { ctx, page, errors };
}

// Создание комнаты по протоколу v2: без ника, хостом станет вошедший с ключом владельца.
const res = await fetch(`${BASE}/api/rooms`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ title: "Дымовой тест" }),
});
if (!res.ok) throw new Error(`создание комнаты: HTTP ${res.status} ${await res.text()}`);
const { code, hostKey } = await res.json();
console.log(`комната ${code}`);

// Признак «в комнате и на связи».
const IN_ROOM = '[data-testid="room"][data-connected="true"]';
const a = await person("Анна", code, hostKey);
await a.page.waitForSelector(IN_ROOM, { timeout: 90000 });
await sleep(1500);
const b = await person("Борис", code);
await b.page.waitForSelector(IN_ROOM, { timeout: 90000 });
await sleep(9000);

const la = await a.page.evaluate(() => window.__levels());
const lb = await b.page.evaluate(() => window.__levels());
const ok = (l) => l.length > 0 && l.every((x) => x.frames > 20 && x.R > 0.5 * x.L && x.L > 0.5 * x.R);
console.log("Анна слышит:", JSON.stringify(la));
console.log("Борис слышит:", JSON.stringify(lb));
for (const [who, p] of [["Анна", a], ["Борис", b]]) {
  if (p.errors.length) console.log(`ошибки у ${who}:`, p.errors.slice(0, 5));
}
await browser.close();
const pass = ok(la) && ok(lb);
console.log(pass ? "ИТОГ: OK — оба слышат друг друга в оба уха" : "ИТОГ: ПРОВАЛ");
process.exit(pass ? 0 : 1);
