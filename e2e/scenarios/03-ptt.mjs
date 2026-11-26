// 3. Рация: включили — в эфир не идёт; держим V — идёт; отпустили — эфир держится
// ещё ~200 мс (задержка отпускания по умолчанию), потом тишина. Меряем по уровню у слушателя.
//
// Хвост после отпускания говорит о рации, только если Анна в это время ещё
// говорит. Отпустить в паузе — и у Бориса дозвучит лишь то, что уже было в пути
// (40–90 мс), с задержкой отпускания или без неё. Поэтому слушаем и сам микрофон
// Анны (до рации, шумодава и сети): отпускаем посреди фразы, а попытку, где она
// замолчала в начале задержки, не считаем и повторяем.
import { waitSeats } from "../lib/person.mjs";
import { micMuted } from "../lib/stand.mjs";

const db = (v) => (v > 0 ? `${(20 * Math.log10(v)).toFixed(1)} дБ` : "−∞");
const pct = (x) => `${Math.round(x * 100)}%`;

/** Задержка отпускания по умолчанию (PTT_RELEASE_RANGE.initial в audio/voicePrefs.ts). */
const RELEASE_MS = 200;
/** Громче этого (RMS) — звук есть; тот же порог тишины, что у датчиков. */
const LOUD = 0.003;
/**
 * Что сказано в первые ~40 мс после отпускания, уходит в эфир, даже если рация
 * закрывает его сразу (пока React доберётся до mute). Различает только речь
 * в [40 мс, задержка]: её должно быть больше половины этого окна.
 */
const SAID_FROM_MS = 40;
const SAID_ENOUGH = 0.6;
const ATTEMPTS = 5;

/** Доля замеров громче LOUD. */
const loudShare = (series) => (series.length ? series.filter((s) => s.v > LOUD).length / series.length : 0);

const scenario = {
  id: "ptt",
  title: "Рация: тишина, V — эфир, отпустили — тишина через ~200 мс",
  async run(t) {
    const { code, hostKey } = await t.room("e2e рация");
    const anna = await t.person("Анна", { code, hostKey, micInput: true });
    const boris = await t.person("Борис");
    await anna.join(code);
    await boris.join(code);
    await waitSeats([anna, boris], 2);
    const idA = await anna.identity();
    await t.sleep(3000);
    t.check("до рации Борис слышит Анну", (await boris.hears(idA, 2500)).frames >= 10);

    await anna.setVoiceMode("Рация");
    t.check(
      "кнопка микрофона в режиме рации",
      await t.until(async () => (await anna.page.locator('[data-testid="dock-mic"]').getAttribute("aria-label")) === "Микрофон (рация)"),
    );
    t.check("рация включена: на сервере микрофон заглушён", await t.until(async () => (await micMuted(code, idA)) === true, 5000));
    await t.sleep(2000);
    let h = await boris.hears(idA, 1500);
    t.check("рация включена, клавиша не нажата: у Бориса тишина", h.max < 0.003, `макс ${db(h.max)}`);

    // Держим V: эфир открыт.
    const pressV = async () => {
      await anna.page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null));
      await anna.page.keyboard.down("KeyV");
    };
    await pressV();
    t.check("V зажата: на сервере микрофон открыт", await t.until(async () => (await micMuted(code, idA)) === false, 5000));
    t.check(
      "V зажата: кнопка микрофона горит (в эфире)",
      (await anna.page.locator('[data-testid="dock-mic"]').getAttribute("aria-pressed")) === "true",
    );
    await t.sleep(2500);
    h = await boris.hears(idA, 2000);
    t.check("V зажата: Борис слышит Анну", h.frames >= 10 && h.max > 0.01, `кадров ${h.frames}, макс ${db(h.max)}`);

    // Момент, когда у Бориса на месте Анны снова появится «в режиме рации» (сигнал mute).
    await boris.page.evaluate((id) => {
      window.__pttMuteAt = null;
      const el = document.querySelector(`[data-testid="participant"][data-identity="${id}"]`);
      new MutationObserver(() => {
        if (!window.__pttMuteAt && el.getAttribute("aria-label")?.includes("в режиме рации")) {
          window.__pttMuteAt = window.__e2e.now();
        }
      }).observe(el, { attributes: true, attributeFilter: ["aria-label"] });
    }, idA);

    // Посреди фразы: в микрофон Анны последние 200 мс почти сплошь речь и сейчас тоже.
    const midPhrase = () =>
      anna.page.evaluate((loud) => {
        const n = window.__e2e.now();
        const s = window.__e2e.input(n - 200, n);
        if (s.length < 8) return false;
        return s.filter((x) => x.v > loud).length >= 0.8 * s.length && s.slice(-2).every((x) => x.v > loud);
      }, LOUD);

    let m = null;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      if (attempt > 1) {
        await pressV();
        await t.until(async () => (await micMuted(code, idA)) === false, 5000);
        await t.sleep(1500);
      }
      const inPhrase = await t.until(midPhrase, 6000, 15);
      await boris.page.evaluate(() => {
        window.__pttMuteAt = null;
      });
      await anna.page.keyboard.up("KeyV");
      const released = await anna.keyTime("KeyV", "keyup");
      await t.sleep(2500);
      const said = loudShare(await anna.micInput(released + SAID_FROM_MS, released + RELEASE_MS));
      const last = await boris.lastLoud(idA, released - 500, released + 2400);
      const muteAt = await boris.page.evaluate(() => window.__pttMuteAt);
      m = {
        attempt,
        said,
        tail: last === null ? null : Math.round(last - released),
        signal: muteAt ? Math.round(muteAt - released) : null,
      };
      t.note(
        `попытка ${attempt}: Анна говорила ${pct(said)} задержки отпускания${inPhrase ? "" : " (сплошной речи не дождались)"}, ` +
          `звук у Бориса шёл ещё ${m.tail ?? "—"} мс, значок «в режиме рации» — через ${m.signal ?? "—"} мс`,
      );
      if (said >= SAID_ENOUGH) break;
    }

    t.check(
      "отпустили V посреди фразы: Анна говорила и во время задержки",
      m.said >= SAID_ENOUGH,
      m.said >= SAID_ENOUGH
        ? `речь ${pct(m.said)} окна, попытка ${m.attempt}`
        : `ни в одной из ${ATTEMPTS} попыток (последняя ${pct(m.said)}): на входе не речь — есть ли .dev-stack/speech.wav?`,
    );
    t.check("отпустили V: звук не обрезан сразу (хвост ≥ 120 мс)", m.tail !== null && m.tail >= 120, `${m.tail} мс`);
    t.check("отпустили V: тишина не позже чем через 700 мс", m.tail !== null && m.tail <= 700, `${m.tail} мс`);
    t.check(
      "сигнал «замолчал» дошёл до Бориса через ~200 мс (150–600)",
      m.signal !== null && m.signal >= 150 && m.signal <= 600,
      `${m.signal} мс`,
    );
    h = await boris.hears(idA, 1200);
    t.check("после отпускания у Бориса тишина", h.max < 0.003, `макс ${db(h.max)}`);
    t.check("на сервере микрофон снова заглушён", (await micMuted(code, idA)) === true);
  },
};

export default scenario;
