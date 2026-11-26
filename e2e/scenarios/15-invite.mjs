// 15. Приглашение (флаги invite_share, calendar, pwa): в панели «Пригласить» —
// Telegram и VK со ссылкой на комнату в адресе «поделиться», Discord копирует
// готовое сообщение, QR-код раскрывается по кнопке и описан для скринридера;
// «Собираемся в…» отдаёт .ics с этим временем и ссылку Google Календаря. С флагом
// pwa манифест годится для установки, и его иконки отдаются.
import fs from "node:fs";
import { api, withFlags } from "../lib/stand.mjs";

const scenario = {
  id: "invite",
  title: "Приглашение: Telegram, VK, Discord, QR-код, календарь, PWA",
  run: (t) => withFlags(t, { invite_share: true, calendar: true, pwa: true }, () => run(t)),
};

async function run(t) {
  const { code, hostKey } = await t.room("e2e приглашение");
  const anna = await t.person("Анна", { code, hostKey });
  await anna.join(code);
  const page = anna.page;
  await page.locator('[data-testid="invite"]').click();
  const share = page.locator('[data-testid="invite-share"]');
  t.check("в панели «Пригласить» есть «Позвать»", await t.until(async () => (await share.count()) === 1, 5000));

  const link = encodeURIComponent(`${t.base}/room/${code}`);
  const tg = (await page.locator('[data-testid="invite-telegram"]').getAttribute("href")) ?? "";
  const vk = (await page.locator('[data-testid="invite-vk"]').getAttribute("href")) ?? "";
  t.check(
    "Telegram: t.me/share со ссылкой на комнату",
    tg.startsWith("https://t.me/share/url?") && tg.includes(link),
    tg,
  );
  t.check(
    "VK: vk.com/share.php со ссылкой на комнату",
    vk.startsWith("https://vk.com/share.php?") && vk.includes(link),
    vk,
  );

  await page.locator('[data-testid="invite-discord"]').click();
  const clip = await t.until(
    async () => (await page.evaluate(() => navigator.clipboard.readText())).includes(`/room/${code}`),
    3000,
  );
  const text = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  t.check(
    "Discord: в буфере готовое приглашение со ссылкой",
    clip && text.startsWith("Заходи в комнату «e2e приглашение»"),
    text,
  );

  await page.locator('[data-testid="invite-qr-toggle"]').click();
  const qr = page.getByRole("img", { name: `QR-код ссылки на комнату ${code}` });
  t.check("QR-код раскрылся и подписан для скринридера", await t.until(async () => (await qr.count()) === 1, 3000));
  await anna.shot("invite-qr");

  // Время и календарь — не в «Пригласить», а отдельно: «Назначить встречу» в меню комнаты.
  t.check(
    "в панели «Пригласить» нет блока со временем",
    (await page.locator('[data-testid="invite-calendar"]').count()) === 0,
  );
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="room-menu"]').click();
  await page.locator('[data-testid="menu-meeting"]').click();
  await page.locator('[data-testid="meeting-dialog"]').waitFor({ state: "visible", timeout: 5000 });

  // «Назначить встречу»: завтра в 21:30 → .ics с этим временем (UTC) и Google Календарь.
  const when = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(21, 30, 0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    return {
      local: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T21:30`,
      utc: d
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, ""),
    };
  });
  await page.locator('[data-testid="invite-calendar-time"]').fill(when.local);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 5000 }).catch(() => null),
    page.locator('[data-testid="invite-ics"]').click(),
  ]);
  const ics = download ? fs.readFileSync(await download.path(), "utf8") : "";
  t.check(
    "файл .ics: встреча на выбранное время со ссылкой на комнату",
    ics.includes(`DTSTART:${when.utc}`) && ics.replace(/\r\n /g, "").includes(`/room/${code}`),
    download?.suggestedFilename(),
  );
  const google = (await page.locator('[data-testid="invite-google"]').getAttribute("href")) ?? "";
  t.check("Google Календарь — то же время", google.includes(`dates=${when.utc}`), google.slice(0, 120));

  // PWA: манифест с иконками, иконки отдаются.
  const manifest = await api(t.base, "GET", "/manifest.webmanifest");
  const icons = manifest.body?.icons ?? [];
  t.check(
    "манифест годится для установки",
    manifest.body?.display === "standalone" && icons.length >= 2,
    manifest.body,
  );
  const sizes = await Promise.all(icons.map((i) => fetch(t.base + i.src).then((r) => r.ok)));
  t.check("иконки манифеста отдаются", sizes.every(Boolean), icons.map((i) => i.src).join(", "));
}

export default scenario;
