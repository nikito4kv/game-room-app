// 14. Статус (флаг statuses): Анна ставит «🕹️ В игре» и пишет «CS2» — у Бориса у
// её ника значок, в подписи места «в игре: CS2», в её панели — тоже. «💤
// Отошёл» сменяет значок, повторное нажатие снимает статус. Мусор — BAD_REQUEST.
import { waitSeats } from "../lib/person.mjs";
import { api, withFlags } from "../lib/stand.mjs";

const scenario = {
  id: "status",
  title: "Статус: «в игре: CS2», «отошёл», снять",
  run: (t) => withFlags(t, { statuses: true }, () => run(t)),
};

async function run(t) {
  const { code, hostKey } = await t.room("e2e статус");
  const anna = await t.person("Анна", { code, hostKey });
  const boris = await t.person("Борис");
  await anna.join(code);
  await boris.join(code);
  await waitSeats([anna, boris], 2);
  const annaId = await anna.identity();
  // «Мой статус» — в меню комнаты; окно остаётся открытым, пока его не закроют.
  const popover = anna.page.locator('[data-testid="status-dialog"]');
  const openPicker = async () => {
    if (!(await popover.isVisible())) {
      await anna.page.locator('[data-testid="room-menu"]').click();
      await anna.page.locator('[data-testid="menu-status"]').click();
    }
    await popover.waitFor({ state: "visible", timeout: 5000 });
  };
  const glyph = (kind) => boris.seat(annaId).locator(kind ? `[data-status="${kind}"]` : "[data-status]");

  await openPicker();
  await anna.page.locator('[data-testid="status-game"]').click();
  await anna.page.locator('[data-testid="status-text"]').fill("CS2");
  t.check(
    "у Бориса у ника Анны значок «в игре»",
    await t.until(async () => (await glyph("game").count()) === 1, 8000, 100),
  );
  t.check(
    "…а в подписи места — «в игре: CS2»",
    await t.until(async () => (await boris.seatLabel(annaId)).includes("в игре: CS2"), 8000, 100),
    await boris.seatLabel(annaId),
  );
  await boris.seat(annaId).first().click();
  t.check(
    "в панели Анны у Бориса — «🕹️ в игре: CS2»",
    await t.until(
      async () =>
        ((await boris.page.locator('[data-testid="participant-status"]').textContent()) ?? "").includes("в игре: CS2"),
      3000,
    ),
  );
  await boris.page.keyboard.press("Escape");
  await boris.shot("status-game");

  await openPicker();
  await anna.page.locator('[data-testid="status-afk"]').click();
  t.check("«Отошёл» сменяет значок", await t.until(async () => (await glyph("afk").count()) === 1, 8000, 100));
  t.check("…и «CS2» из подписи ушло", !(await boris.seatLabel(annaId)).includes("CS2"), await boris.seatLabel(annaId));
  await anna.page.locator('[data-testid="status-afk"]').click();
  t.check("повторное нажатие снимает статус", await t.until(async () => (await glyph().count()) === 0, 8000, 100));

  const junk = await api(t.base, "POST", "/api/status", { code, token: anna.token, kind: "sleep", text: "" });
  t.check(
    "неизвестный статус — BAD_REQUEST",
    junk.status === 400 && junk.body?.error?.code === "BAD_REQUEST",
    junk.status,
  );
}

export default scenario;
