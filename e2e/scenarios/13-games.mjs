// 13. Игры (флаг games): Анна бросает кубик — у Бориса грань над местом Анны и
// тост «бросает кубик: N». Борис жмёт «Кто платит?» — у обоих один и тот же
// выбранный (🎯 над ним и тост). Анна спрашивает «Все готовы?» — у Бориса тост с
// кнопкой «Готов», Анна готова сразу; Борис отвечает — у обоих «Все готовы!».
// Второй опрос в те же 20 с сервер не пускает; мусор — BAD_REQUEST.
import { waitSeats } from "../lib/person.mjs";
import { api, withFlags } from "../lib/stand.mjs";

const scenario = {
  id: "games",
  title: "Игры: кубик, «Кто платит?», «Все готовы?»",
  run: (t) => withFlags(t, { games: true }, () => run(t)),
};

async function run(t) {
  const { code, hostKey } = await t.room("e2e игры");
  const anna = await t.person("Анна", { code, hostKey });
  const boris = await t.person("Борис");
  await anna.join(code);
  await boris.join(code);
  await waitSeats([anna, boris], 2);
  const annaId = await anna.identity();
  const borisId = await boris.identity();
  const bubble = (p, identity, sel) => p.seat(identity).locator(sel);
  // «Игры» живут в меню комнаты и открываются окном; после нажатия окно закрывается.
  const popover = (p) => p.page.locator('[data-testid="games-dialog"]');
  const openPicker = async (p) => {
    if (!(await popover(p).isVisible())) {
      await p.page.locator('[data-testid="room-menu"]').click();
      await p.page.locator('[data-testid="menu-games"]').click();
    }
    await popover(p).waitFor({ state: "visible", timeout: 5000 });
  };
  const toastText = (p) => p.page.locator("[data-toast], [role='status'], [role='alert']").allTextContents();

  await openPicker(anna);
  t.check(
    "в меню комнаты есть «Игры», в окне — три игры",
    (await popover(anna).locator('[data-testid^="game-"]').count()) === 3,
  );

  // Кубик.
  await anna.page.locator('[data-testid="game-dice"]').click();
  t.check(
    "у Бориса над Анной грань кубика",
    await t.until(async () => (await bubble(boris, annaId, '[data-reaction^="dice"]').count()) === 1, 5000, 50),
  );
  const face = await bubble(boris, annaId, '[data-reaction^="dice"]')
    .getAttribute("data-reaction")
    .catch(() => null);
  t.check(
    "…и тост «Анна бросает кубик» с тем же числом",
    await t.until(async () => (await boris.page.getByText(`бросает кубик: ${face?.slice(4)}`).count()) > 0, 3000),
    face,
  );

  // «Кто платит?»: у обоих один и тот же выбранный.
  await t.sleep(2200);
  await openPicker(boris);
  await boris.page.locator('[data-testid="game-pick"]').click();
  const picked = async (p) => {
    for (const id of [annaId, borisId]) if ((await bubble(p, id, '[data-reaction="picked"]').count()) === 1) return id;
    return null;
  };
  t.check("у Анны 🎯 над кем-то из двоих", await t.until(async () => (await picked(anna)) !== null, 5000, 50));
  const [pa, pb] = [await picked(anna), await picked(boris)];
  t.check("…и у Бориса над тем же", pa !== null && pa === pb, `${pa} / ${pb}`);
  t.check(
    "тост «Кто платит?» у обоих",
    (await anna.page.getByText("Кто платит?").count()) > 0 && (await boris.page.getByText("Кто платит?").count()) > 0,
  );

  // «Все готовы?»
  await openPicker(anna);
  await anna.page.locator('[data-testid="game-ready"]').click();
  const ready = boris.page.getByRole("button", { name: "Готов", exact: true });
  t.check(
    "у Бориса тост «Все готовы?» с кнопкой «Готов»",
    await t.until(async () => (await ready.count()) === 1, 5000, 50),
  );
  t.check(
    "у Анны кнопки нет — спросившая готова сразу, но ход опроса видит",
    (await anna.page.getByRole("button", { name: "Готов", exact: true }).count()) === 0 &&
      (await anna.page.getByText("Готовы 1 из 2").count()) > 0,
  );
  await boris.shot("ready-check");
  await ready.click();
  t.check(
    "Борис ответил — у обоих «Все готовы!»",
    await t.until(
      async () =>
        (await anna.page.getByText("Все готовы!").count()) > 0 &&
        (await boris.page.getByText("Все готовы!").count()) > 0,
      5000,
      50,
    ),
    (await toastText(anna)).join(" | "),
  );

  // Второй опрос в те же 20 с — отказ.
  const again = await api(t.base, "POST", "/api/game", { code, token: boris.token, action: "ready" });
  t.check("второй «Все готовы?» за 20 с — RATE_LIMITED", again.body?.error?.code === "RATE_LIMITED", again.status);
  const junk = await api(t.base, "POST", "/api/game", { code, token: anna.token, action: "roll" });
  t.check(
    "неизвестное действие — BAD_REQUEST",
    junk.status === 400 && junk.body?.error?.code === "BAD_REQUEST",
    junk.status,
  );
  const fake = await api(t.base, "POST", "/api/game", { code, token: "подделка", action: "dice" });
  t.check("чужой токен — UNAUTHORIZED", fake.body?.error?.code === "UNAUTHORIZED", fake.status);
}

export default scenario;
