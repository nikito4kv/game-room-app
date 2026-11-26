// Каркас сценария: браузер с фейковыми медиа, проверки, ожидания, уборка.
import { chromium } from "playwright-core";
import { Person } from "./person.mjs";
import { speechWav } from "./speech.mjs";
import { createRoom, sleep } from "./stand.mjs";

/**
 * Системный Chrome без окна. Фейковые микрофон (речь из speech.wav, моно; нет
 * файла — синтезируется, см. speech.mjs) и захват экрана: «весь экран»
 * выбирается сам, размер экрана — 2560×1440, чтобы профили показа было из чего
 * ужимать.
 */
export function launchBrowser({ headed = false } = {}) {
  const speech = speechWav();
  return chromium.launch({
    channel: "chrome",
    headless: !headed,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      ...(speech ? [`--use-file-for-fake-audio-capture=${speech}`] : []),
      "--autoplay-policy=no-user-gesture-required",
      "--auto-select-desktop-capture-source=Entire screen",
      "--screen-info={2560x1440}",
    ],
  });
}

/** Ждать, пока fn() вернёт истину (ошибки внутри — «ещё нет»). true — дождались. */
export async function until(fn, timeout = 15000, step = 250) {
  const end = Date.now() + timeout;
  for (;;) {
    try {
      if (await fn()) return true;
    } catch {
      // ещё не готово
    }
    if (Date.now() > end) return false;
    await sleep(step);
  }
}

/** Сценарий нельзя выполнить в этом окружении (не провал): t.skip(причина). */
export class SkipError extends Error {}

/**
 * Контекст сценария: всё, что сценарию нужно, и учёт результатов. Каждый
 * сценарий создаёт себе комнату сам и не зависит от соседей.
 */
export function createContext({ id, base, browser, out }) {
  const results = [];
  const notes = [];
  const people = [];
  const t = {
    id,
    base,
    browser,
    out,
    results,
    notes,
    people,
    sleep,
    until,
    track: (p) => people.push(p),
    person: (name, opts) => Person.create(t, name, opts),
    room: (title, opts = {}) => createRoom(base, { title, ...opts }),
    /** Проверка: пишет строку и запоминает итог. Возвращает ok. */
    check(label, ok, extra) {
      const pass = !!ok;
      const tail = extra === undefined || extra === "" ? "" : ` — ${extra}`;
      results.push({ label, ok: pass, extra: extra === undefined ? "" : String(extra) });
      console.log(`  ${pass ? "OK  " : "FAIL"} ${label}${tail}`);
      return pass;
    },
    /** Замер или наблюдение без вердикта — попадает в отчёт. */
    note(text) {
      notes.push(text);
      console.log(`  ·    ${text}`);
    },
    skip(reason) {
      throw new SkipError(reason);
    },
  };
  return t;
}
