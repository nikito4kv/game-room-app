// 16. Итоги вечера (флаг recap): Анна и Борис говорят (фейковые микрофоны с
// речью), Борис бросает кубик и жмёт 🔥 — у Анны в меню комнаты «Итоги вечера»:
// картинка 1200×630 собралась, в итогах компания из двух и «Эмоции». Вечер короче
// двух минут — на экране «Вы вышли» кнопки итогов нет.
import { waitSeats } from "../lib/person.mjs";
import { withFlags } from "../lib/stand.mjs";

const scenario = {
  id: "recap",
  title: "Итоги вечера: картинка и числа",
  run: (t) => withFlags(t, { recap: true, games: true }, () => run(t)),
};

async function run(t) {
  const { code, hostKey } = await t.room("e2e итоги");
  const anna = await t.person("Анна", { code, hostKey });
  const boris = await t.person("Борис");
  await anna.join(code);
  await boris.join(code);
  await waitSeats([anna, boris], 2);

  await boris.page.locator('[data-testid="dock-reactions"]').click();
  await boris.page.locator('[data-testid="reaction-fire"]').click();
  await boris.page.keyboard.press("Escape");
  await boris.page.locator('[data-testid="room-menu"]').click();
  await boris.page.locator('[data-testid="menu-games"]').click();
  await boris.page.locator('[data-testid="game-dice"]').click();
  // Пусть поговорят: активные говорящие приходят от сервера LiveKit.
  await t.sleep(8000);

  await anna.page.locator('[data-testid="room-menu"]').click();
  await anna.page.locator('[data-testid="menu-recap"]').click();
  const dialog = anna.page.locator('[data-testid="recap-dialog"]');
  t.check("окно «Итоги вечера» открылось", await t.until(async () => dialog.isVisible(), 5000));
  const img = dialog.locator("img");
  t.check(
    "картинка 1200×630 собралась",
    await t.until(async () => (await img.evaluate((el) => el.naturalWidth).catch(() => 0)) === 1200, 10000),
  );
  const cells = (await dialog.locator('[data-testid="recap-cells"]').textContent()) ?? "";
  t.check("в итогах — компания из двух", cells.includes("2человека"), cells);
  t.check("…и эмоции: реакция", cells.includes("1реакция"), cells);
  t.check("кнопка «Скачать картинку» готова", (await dialog.locator('[data-testid="recap-download"]').count()) === 1);
  await anna.shot("recap");
  await anna.page.keyboard.press("Escape");

  await boris.page.locator('[data-testid="dock-leave"]').click();
  await boris.page.locator('[data-testid="state-screen"][data-kind="left"]').waitFor({ timeout: 10000 });
  t.check(
    "вечер короче двух минут — на «Вы вышли» итогов нет",
    (await boris.page.locator('[data-testid="recap-open"]').count()) === 0,
  );
}

export default scenario;
