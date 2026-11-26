// Сценарии «компьютерный клуб» для офлайн-оценки: свой голос у микрофона,
// сосед в зале (реверберация, на 15/20/25 дБ тише), клавиатура, кулеры и гул.
// Каждая дорожка хранится отдельно — по ним считаются метрики (где ты говоришь,
// где сосед, где только клавиатура).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  SR,
  activeLevelDb,
  framePowers,
  gauss,
  hum,
  keyClick,
  mixInto,
  onePole,
  pinkNoise,
  readWav,
  reverb,
  rng,
  scaleTo,
  trimSilence,
  upsample,
} from "./lib.mjs";

const OWN_PHRASES = [
  "Иду на точку бэ, прикройте меня.",
  "Двое на мид, один с авп.",
  "Подожди, я перезаряжаюсь.",
  "Кидаю дым на вход, заходим вместе.",
  "Слева от ящиков, добивай его!",
  "Ребята, у кого есть лишний ствол?",
  "Я на респауне, бегу к вам.",
  "Не торопитесь, пусть они первые выйдут.",
  "Минус один, остался последний.",
  "Сейчас сделаю сейв и скину бомбу.",
  "Отличный раунд, давайте так же.",
  "Он за дверью, слышу шаги.",
  "Берём эко в этом раунде.",
  "Флешка через три, два, один.",
  "Зачем ты туда полез, там же снайпер?",
  "Всё, я пустой, нужна помощь.",
];

const NEIGHBOR_PHRASES_RU = [
  "Слушай, а ты вчера смотрел матч?",
  "Да ладно, не может быть, серьёзно?",
  "Дай мне ещё полчаса, я закончу катку.",
  "Кто-нибудь заказывал пиццу на третий стол?",
  "Админ, у меня наушники не работают.",
  "Ну ты даёшь, это было вообще не по плану.",
  "Пойдём потом в кино, там новый фильм вышел.",
  "Сколько у тебя рейтинг сейчас?",
];

const NEIGHBOR_PHRASES_EN = [
  "Push the left side, I will cover you.",
  "No way, that was a lucky shot.",
  "Can you hear me? My mic is acting weird.",
  "Let us take a break after this round.",
];

const hash = (s) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  return h.toString(16);
};

/** Синтезирует недостающие фразы (TTS Windows) и возвращает их 48 кГц, без тишины по краям. */
function loadPhrases(cacheDir, voice, phrases) {
  const ttsDir = path.join(cacheDir, "tts");
  fs.mkdirSync(ttsDir, { recursive: true });
  const jobs = phrases.map((text) => ({ voice, text, out: path.join(ttsDir, `${voice}-${hash(text)}.wav`) }));
  if (jobs.some((j) => !fs.existsSync(j.out))) {
    const jobsFile = path.join(ttsDir, `jobs-${voice}.json`);
    fs.writeFileSync(jobsFile, JSON.stringify(jobs), "utf8");
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(import.meta.dirname, "tts.ps1"), jobsFile],
      { stdio: "inherit" },
    );
  }
  return jobs.map((j) => {
    const { sampleRate, data } = readWav(j.out);
    if (SR % sampleRate !== 0) throw new Error(`${j.out}: частота ${sampleRate} не делит 48 кГц`);
    return trimSilence(SR === sampleRate ? data : upsample(data, SR / sampleRate));
  });
}

/** Голос соседа «из зала» — реверберация считается долго, поэтому кэшируем по фразе. */
const farCache = new Map();
function farVoice(phrase, idx) {
  if (!farCache.has(idx)) {
    const data = onePole(reverb(phrase, 0.5, 0.6, 11 + idx), 5000, "low");
    farCache.set(idx, { data, levelDb: activeLevelDb(data) });
  }
  return farCache.get(idx);
}

/** Режет запись на фразы по паузам ≥ 250 мс. */
function splitByPauses(x) {
  const pw = framePowers(x);
  const loud = Array.from(pw, (p) => p > 1e-5); // −50 дБFS
  const segs = [];
  let start = -1;
  let quiet = 0;
  for (let k = 0; k < loud.length; k++) {
    if (loud[k]) {
      if (start < 0) start = k;
      quiet = 0;
    } else if (start >= 0 && ++quiet >= 25) {
      segs.push([start, k - quiet + 1]);
      start = -1;
    }
  }
  if (start >= 0) segs.push([start, loud.length]);
  return segs.filter(([a, b]) => b - a >= 50).map(([a, b]) => x.slice(a * 480, b * 480));
}

/**
 * Собирает сценарий. own — «мой голос» (pavel | speech), neighborDb — насколько
 * сосед тише меня (по уровню активной речи). Возвращает дорожки одинаковой длины.
 */
export function buildScenario({ cacheDir, root, own, neighborDb, ownDb = -24, seconds = 120, seed = 1 }) {
  const rand = rng(seed);
  const n = seconds * SR;
  const ownTrack = new Float32Array(n);
  const neighborTrack = new Float32Array(n);
  const keysTrack = new Float32Array(n);

  const ownPhrases =
    own === "speech"
      ? splitByPauses(readWav(path.join(root, ".dev-stack", "speech.wav")).data)
      : loadPhrases(cacheDir, "Pavel", OWN_PHRASES);
  const neighborPhrases = [
    ...loadPhrases(cacheDir, "Irina", NEIGHBOR_PHRASES_RU),
    ...loadPhrases(cacheDir, "Zira", NEIGHBOR_PHRASES_EN),
  ];

  // Свой голос: ≈ ownDb по активной речи (−24 дБFS — гарнитура), фразы ±3 дБ.
  // Первые 6 с молчим — сначала говорит сосед (худший случай для авто-порога на старте).
  const OWN_DB = ownDb;
  for (let t = 6 * SR, i = 0; t < n - 3 * SR; i++) {
    const ph = ownPhrases[i % ownPhrases.length];
    mixInto(ownTrack, scaleTo(ph, OWN_DB + (rand() * 6 - 3)), t);
    t += ph.length + Math.round((1.2 + rand() * 2.8) * SR);
  }

  // Сосед: реверберация зала и лёгкий завал верха (далеко), независимое расписание.
  for (let t = Math.round(0.5 * SR), i = 0; t < n - 3 * SR; i++) {
    const idx = (i * 5 + 3) % neighborPhrases.length;
    const far = farVoice(neighborPhrases[idx], idx);
    mixInto(neighborTrack, scaleTo(far.data, OWN_DB - neighborDb + (rand() * 4 - 2), far.levelDb), t);
    t += neighborPhrases[idx].length + Math.round((0.4 + rand() * 3.5) * SR);
  }

  // Клавиатура: серии нажатий 6–10 в секунду, нажатие + отпускание.
  for (let t = Math.round(1 * SR); t < n - SR; ) {
    const keys = 3 + Math.floor(rand() * 10);
    let k = t;
    for (let j = 0; j < keys; j++) {
      const peak = Math.pow(10, (-30 + rand() * 8) / 20);
      mixInto(keysTrack, keyClick(rand, peak), k);
      mixInto(keysTrack, keyClick(rand, peak * 0.6), k + Math.round((0.05 + rand() * 0.06) * SR));
      k += Math.round((0.1 + rand() * 0.07) * SR);
    }
    t = k + Math.round((1.5 + rand() * 4.5) * SR);
  }

  // Кулеры (розовый шум с завалом верха) и сетевой гул.
  const fan = onePole(pinkNoise(n, rand), 2500, "low");
  const fanTrack = scaleTo(fan, -52, 10 * Math.log10(fan.reduce((s, v) => s + v * v, 0) / n));
  const humTrack = hum(n, Math.pow(10, -60 / 20));

  const mix = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mix[i] = ownTrack[i] + neighborTrack[i] + keysTrack[i] + fanTrack[i] + humTrack[i] + gauss(rand) * 1e-5;
  }
  return { mix, own: ownTrack, neighbor: neighborTrack, keys: keysTrack, noise: fanTrack };
}
