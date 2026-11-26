// Снимает скриншоты для README на локальном стенде (npm run stack + npm run dev).
// Живые «люди» с вымышленными никами заходят в комнату через лобби, как настоящие;
// микрофоны фейковые (речь из .dev-stack/speech.wav). Результат — docs/screenshots/.
//
//   node scripts/screenshots.mjs [http://localhost:3000]
import fs from "node:fs";
import path from "node:path";
import { ROOT, REDIS_REST } from "../e2e/lib/env.mjs";
import { createContext, launchBrowser } from "../e2e/lib/harness.mjs";
import { waitSeats } from "../e2e/lib/person.mjs";
import { redis, sleep } from "../e2e/lib/stand.mjs";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const host = new URL(REDIS_REST.url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") throw new Error("Только локальный стенд: Redis не локальный");

const outDir = path.join(ROOT, "docs", "screenshots");
fs.mkdirSync(outDir, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });

// Флаги продукта включаем на время съёмки (кэш настроек на сервере — 10 с).
const before = (await redis(["GET", "gr:cfg"])).result ?? null;
const cfg = before ? JSON.parse(before) : { flags: {}, rev: 0 };
const on = Object.fromEntries(["recap", "games", "soundboard"].map((n) => [n, { mode: "on" }]));
await redis(["SET", "gr:cfg", JSON.stringify({ ...cfg, flags: { ...cfg.flags, ...on } })]);
await sleep(11_000);

const browser = await launchBrowser();
const t = createContext({ id: "screenshots", base, browser, out: outDir });
try {
  // 1. Главная.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ru-RU" });
    const page = await ctx.newPage();
    await page.goto(base + "/", { waitUntil: "networkidle", timeout: 180000 });
    await sleep(1500);
    await shot(page, "01-landing");
    await ctx.close();
  }

  const { code, hostKey } = await t.room("Вечерняя катка");
  const misha = await t.person("Миша", { code, hostKey });
  const sonya = await t.person("Соня", { code });
  const kira = await t.person("Кира", { code });
  const gosha = await t.person("Гоша", { code });
  const vlad = await t.person("Влад", { code });

  // 2. Лобби: ник введён, микрофон проверяется до входа.
  await sonya.open(code);
  await sonya.page.locator('[data-testid="join-nickname"]').fill("Соня");
  await sleep(2500);
  await shot(sonya.page, "02-lobby");

  // 3. Комната.
  await sonya.submit();
  await sonya.waitConnected();
  for (const p of [misha, kira, gosha, vlad]) await p.join(code);
  await waitSeats([misha, sonya, kira, gosha, vlad], 5);

  // Чат.
  const say = async (p, text) => {
    const input = p.page.locator('[data-testid="chat-input"]');
    if (!(await input.count())) await p.page.locator('[data-testid="dock-chat"]').click();
    await input.fill(text);
    await input.press("Enter");
    await sleep(500);
  };
  for (const p of [misha, kira, gosha, vlad]) await p.page.locator('[data-testid="dock-chat"]').click();
  await say(misha, "го ещё одну, пока Гоша не ушёл");
  await say(kira, "я за, только звук подкручу");
  await say(gosha, "секунду, чай");
  await say(vlad, "у меня пинг 180, клуб опять тупит");
  await sonya.page.locator('[data-testid="dock-chat"]').click();
  await say(sonya, "кто в пати — жмите принять");
  await sleep(6000); // фейковые микрофоны говорят: кольца у говорящих
  await sonya.page.mouse.move(700, 300);
  await sleep(600);
  await shot(sonya.page, "03-room-chat");

  // 4. Игры и реакции — чтобы в итогах были цифры.
  await sonya.page.locator('[data-testid="dock-chat"]').click(); // закрыть чат
  await kira.page.locator('[data-testid="dock-reactions"]').click();
  await kira.page.locator('[data-testid="reaction-fire"]').click();
  await kira.page.keyboard.press("Escape");
  await misha.page.locator('[data-testid="room-menu"]').click();
  await misha.page.locator('[data-testid="menu-games"]').click();
  await misha.page.locator('[data-testid="game-dice"]').click();
  await sleep(1200);

  // 4. Настройки звука.
  await sonya.page.locator('[data-testid="dock-settings"]').click();
  await sleep(1500);
  await shot(sonya.page, "04-settings");

  // 5. Итоги вечера.
  await sonya.page.keyboard.press("Escape");
  await sonya.page.locator('[data-testid="room-menu"]').click();
  await sonya.page.locator('[data-testid="menu-recap"]').click();
  const dialog = sonya.page.locator('[data-testid="recap-dialog"]');
  await dialog.locator("img").waitFor({ timeout: 15000 });
  await sleep(1500);
  await shot(sonya.page, "05-recap");
} finally {
  await redis(before === null ? ["DEL", "gr:cfg"] : ["SET", "gr:cfg", before]);
  for (const p of t.people) await p.ctx.close().catch(() => {});
  await browser.close();
}
console.log("готово:", outDir);
