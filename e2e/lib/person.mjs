// «Человек» в тесте: свой контекст браузера = своё устройство (свой localStorage,
// свой gr.device), вход через лобби, датчики звука, токен из ответа /api/token.
import path from "node:path";
import { installInputProbe, installProbes } from "./probes.mjs";
import { participants, sleep } from "./stand.mjs";

export const IN_ROOM = '[data-testid="room"][data-connected="true"]';

/**
 * Шум консоли, который не про сайт: обрывы сети и перезапуск стенда в тестах
 * (livekit-client пишет их как ConnectionError), отказы прав в headless.
 */
const CONSOLE_NOISE =
  /Failed to load resource|net::ERR|ERR_INTERNET_DISCONNECTED|WebSocket|websocket|negotiation timed out|DataChannel|Abort handler|could not establish|publishing rejected|status of 40[0-9]|camera is not allowed|ConnectionError/i;

export class Person {
  /**
   * @param t     контекст сценария (harness)
   * @param name  ник
   * @param opts  code / hostKey — ключ владельца для этой комнаты; prefs — ключи
   *              localStorage до первой загрузки; viewport; micInput — слушать
   *              и сам микрофон, до рации и шумодава (см. micInput()).
   */
  static async create(
    t,
    name,
    { code, hostKey, prefs = {}, viewport = { width: 1440, height: 900 }, micInput = false } = {},
  ) {
    const ctx = await t.browser.newContext({
      viewport,
      locale: "ru-RU",
      permissions: ["microphone", "clipboard-read", "clipboard-write"],
    });
    await ctx.addInitScript(installProbes);
    if (micInput) await ctx.addInitScript(installInputProbe);
    // Звуки интерфейса по умолчанию выключены: они идут в те же колонки, что и
    // голоса, и мешали бы замерам «в колонках тишина».
    const seed = { "gr.sfx.enabled": "0", ...prefs };
    await ctx.addInitScript(
      ([nick, roomCode, key, values]) => {
        try {
          if (!localStorage.getItem("gr.nickname")) localStorage.setItem("gr.nickname", nick);
          if (key && roomCode) localStorage.setItem(`gr.host.${roomCode}`, key);
          for (const [k, v] of Object.entries(values)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
        } catch {
          // хранилище недоступно — сайт сам с этим живёт
        }
      },
      [name, code ?? null, hostKey ?? null, seed],
    );
    const p = new Person(t, name, ctx, await ctx.newPage());
    t.track(p);
    return p;
  }

  constructor(t, name, ctx, page) {
    this.t = t;
    this.name = name;
    this.ctx = ctx;
    this.page = page;
    this.code = null;
    /** Последний удачный ответ POST /api/token (токен, identity, комната). */
    this.joinInfo = null;
    /** Последний отказ POST /api/token: { status, error }. */
    this.lastRefusal = null;
    this.errors = [];
    this.watch(page);
  }

  watch(page) {
    page.on("pageerror", (e) => this.errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") this.errors.push(m.text());
    });
    page.on("response", async (r) => {
      if (!r.url().endsWith("/api/token") || r.request().method() !== "POST") return;
      const body = await r.json().catch(() => null);
      if (r.ok() && body?.token) this.joinInfo = body;
      else this.lastRefusal = { status: r.status(), error: body?.error ?? null };
    });
  }

  /** Ошибки консоли без сетевого шума тестов. */
  realErrors() {
    return this.errors.filter((e) => !CONSOLE_NOISE.test(e));
  }

  async open(code) {
    this.code = code;
    await this.page.goto(`${this.t.base}/room/${code}`, { waitUntil: "domcontentloaded", timeout: 180000 });
    // Форма лобби рисуется только после гидратации — поле ника и есть признак готовности.
    await this.page
      .locator('[data-testid="join-nickname"], [data-testid="state-screen"]')
      .first()
      .waitFor({ timeout: 180000 });
  }

  /** Лобби → ник (и пароль) → «Войти в комнату», без ожидания подключения. */
  async submit({ password } = {}) {
    const page = this.page;
    await page.locator('[data-testid="join-nickname"]').fill(this.name);
    if (password !== undefined) {
      const field = page.locator('[data-testid="join-password"]');
      await field.waitFor({ timeout: 15000 });
      await field.fill(password);
    }
    await page.locator('[data-testid="join-submit"]').click();
  }

  async join(code, { password, timeout = 120000 } = {}) {
    await this.open(code);
    await this.submit({ password });
    await this.waitConnected(timeout);
  }

  async waitConnected(timeout = 120000) {
    await this.page.locator(IN_ROOM).waitFor({ timeout });
  }

  async connected() {
    return (await this.page.locator(IN_ROOM).count()) > 0;
  }

  /** identity этого устройства: "u_" + id из gr.device. */
  async identity() {
    const raw = await this.page.evaluate(() => localStorage.getItem("gr.device"));
    return raw ? `u_${JSON.parse(raw).id}` : null;
  }

  get token() {
    return this.joinInfo?.token ?? null;
  }

  seat(identity) {
    return this.page.locator(`[data-testid="participant"][data-identity="${identity}"]`);
  }

  async seatLabel(identity) {
    return (await this.seat(identity).first().getAttribute("aria-label", { timeout: 2000 }).catch(() => null)) ?? "";
  }

  /** Экран вместо комнаты/лобби: data-kind или null. */
  async screenKind() {
    const el = this.page.locator('[data-testid="state-screen"]');
    return (await el.count()) ? el.first().getAttribute("data-kind") : null;
  }

  /** Горячая клавиша комнаты: фокус уводим с полей, иначе клавиша уйдёт в поле. */
  async press(code) {
    await this.page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await this.page.keyboard.press(code);
  }

  async openParticipantMenu(identity) {
    await this.seat(identity).first().click();
    const menu = this.page.locator('[data-testid="participant-menu"]');
    await menu.waitFor({ timeout: 10000 });
    return menu;
  }

  async openRoomSettings() {
    await this.page.locator('[data-testid="room-menu"]').click();
    await this.page.locator('[data-testid="menu-room-settings"]').click();
    const dialog = this.page.locator('[data-testid="room-settings-dialog"]');
    await dialog.waitFor({ timeout: 15000 });
    return dialog;
  }

  /** Настройки комнаты: выбрать вариант в группе и «Сохранить». */
  async setRoomPolicy(group, option) {
    const dialog = await this.openRoomSettings();
    await dialog.getByRole("radiogroup", { name: group }).getByRole("radio", { name: option, exact: true }).click();
    await dialog.locator('[data-testid="room-settings-save"]').click();
    await dialog.waitFor({ state: "hidden", timeout: 15000 });
  }

  async openSettings(tab) {
    await this.page.locator('[data-testid="dock-settings"]').click();
    const dialog = this.page.locator('[data-testid="settings-dialog"]');
    await dialog.waitFor({ timeout: 15000 });
    if (tab) await dialog.getByRole("tab", { name: tab }).click();
    return dialog;
  }

  async closeSettings() {
    await this.page.keyboard.press("Escape");
    await this.page
      .locator('[data-testid="settings-dialog"]')
      .waitFor({ state: "hidden", timeout: 5000 })
      .catch(() => {});
  }

  /** Режим голоса через настройки: «Открытый микрофон» или «Рация». */
  async setVoiceMode(label) {
    const dialog = await this.openSettings("Клавиши");
    await dialog.getByRole("radio", { name: label }).click();
    await this.closeSettings();
  }

  /**
   * Кого и как слышит этот человек за последние ms: по identity чужих дорожек.
   * Каждому — { identity, name, source, L, R, frames, max }.
   */
  async hearing(ms) {
    const raw = await this.page.evaluate((w) => window.__e2e.heard(w), ms);
    const people = await participants(this.code);
    return raw.map((h) => {
      const [psid, tsid] = h.owner.split("|");
      const p = people.find((x) => x.sid === psid);
      const track = p?.tracks.find((x) => x.sid === tsid);
      return { ...h, identity: p?.identity ?? null, name: p?.name ?? null, source: track?.source ?? null };
    });
  }

  /** Как этот человек слышит identity (только микрофон) за последние ms. */
  async hears(identity, ms) {
    const all = await this.hearing(ms);
    const mine = all.filter((h) => h.identity === identity && h.source === 2);
    if (!mine.length) return { identity, L: 0, R: 0, frames: 0, samples: 0, max: 0, known: false };
    return mine.reduce((a, b) => (b.samples > a.samples ? b : a));
  }

  /**
   * Когда у этого слушателя последний раз был слышен микрофон identity в окне
   * [from, to] (время страниц, мс). null — ни разу. Нужен для «сколько мс после
   * нажатия звук ещё шёл».
   */
  async lastLoud(identity, from, to, threshold = 0.003) {
    const p = (await participants(this.code)).find((x) => x.identity === identity);
    const mic = p?.tracks.find((x) => x.source === 2);
    if (!p || !mic) return null;
    const series = await this.page.evaluate(([owner, a, b]) => window.__e2e.series(owner, a, b), [
      `${p.sid}|${mic.sid}`,
      from,
      to,
    ]);
    const loud = series.filter((s) => s.v > threshold);
    return loud.length ? loud[loud.length - 1].t : null;
  }

  /**
   * Громкость того, что этот человек говорит в микрофон, за окно [from, to]
   * (время страниц): [{ t, v }] раз в 20 мс. Только для созданных с micInput.
   */
  async micInput(from, to) {
    return this.page.evaluate(([a, b]) => window.__e2e.input?.(a, b) ?? [], [from, to]);
  }

  /** Время последнего нажатия (keydown) или отпускания (keyup) клавиши на этой странице. */
  async keyTime(code, type = "keydown") {
    return this.page.evaluate(
      ([c, ty]) => [...window.__e2e.keys].reverse().find((k) => k.code === c && k.type === ty)?.t ?? null,
      [code, type],
    );
  }

  /** Что уходит в колонки за последние ms. */
  async speakers(ms) {
    const [s] = await this.page.evaluate((w) => window.__e2e.speakers(w), ms);
    return s ?? { L: 0, R: 0, frames: 0, samples: 0, max: 0 };
  }

  async now() {
    return this.page.evaluate(() => window.__e2e.now());
  }

  async shot(name) {
    const file = path.join(this.t.out, `${this.t.id}-${name}.png`);
    await this.page.screenshot({ path: file }).catch(() => {});
    return file;
  }

  async close() {
    await this.ctx.close().catch(() => {});
  }
}

/** Подождать, пока у всех появятся все места (n мест у каждого). */
export async function waitSeats(people, n, timeout = 60000) {
  for (const p of people) {
    await p.page.waitForFunction(
      (count) => document.querySelectorAll('[data-testid="participant"]').length === count,
      n,
      { timeout },
    );
  }
  await sleep(300);
}
