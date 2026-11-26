// 5. Демонстрация экрана: старт (фейковый захват 2560×1440) → у зрителя сцена;
// профиль «Игры» → у зрителя в итоге 1920×1080 (время до верхнего слоя — в
// отчёт); «i» со статистикой, F — во весь экран, зум колесом, «Не смотреть»,
// остановка стримером и хостом, «экран — только хост».
import { waitSeats } from "../lib/person.mjs";
import { TrackSource, canPublish } from "../lib/stand.mjs";

/** Сумма декодированных кадров входящего видео на странице. */
const framesDecoded = (p) =>
  p.page.evaluate(async () => {
    let n = 0;
    for (const pc of window.__e2e.pcs) {
      if (pc.connectionState === "closed") continue;
      (await pc.getStats()).forEach((r) => {
        if (r.type === "inbound-rtp" && r.kind === "video") n += r.framesDecoded ?? 0;
      });
    }
    return n;
  });

const scenario = {
  id: "screen",
  title: "Экран: сцена, 1080p у зрителя, i, F, зум, не смотреть, остановка, только хост",
  timeoutMs: 8 * 60_000,
  async run(t) {
    const { code, hostKey } = await t.room("e2e экран");
    const anna = await t.person("Анна", { code, hostKey });
    const boris = await t.person("Борис");
    const vika = await t.person("Вика");
    for (const p of [anna, boris, vika]) await p.join(code);
    await waitSeats([anna, boris, vika], 3);
    const idB = await boris.identity();
    const idV = await vika.identity();
    const shareButton = (p) => p.page.locator('[data-testid="dock-screen"]');
    const stage = (p) => p.page.locator('[data-testid="screen-stage"]');

    // Старт показа у Бориса (профиль по умолчанию — «Игры», 1080p60).
    const started = Date.now();
    await shareButton(boris).click();
    t.check(
      "Борис показывает экран (кнопка нажата)",
      await t.until(async () => (await shareButton(boris).getAttribute("aria-pressed")) === "true", 60000),
    );
    t.check("у Анны появилась сцена", await t.until(async () => (await stage(anna).count()) === 1, 30000));
    t.check("сцена — показ Бориса", (await stage(anna).getAttribute("data-identity")) === idB);
    t.check("у Вики тоже сцена", await t.until(async () => (await stage(vika).count()) === 1, 30000));
    t.check(
      "у самого Бориса — плашка своего показа, а не сцена",
      (await boris.page.locator('[data-testid="self-share"]').count()) > 0 && (await stage(boris).count()) === 0,
    );

    // «i»: что реально приходит; ждём верхний слой 1920×1080.
    await stage(anna).hover();
    await stage(anna).locator('[data-testid="stage-stats"]').click();
    const stats = anna.page.locator('[data-testid="stream-stats"]');
    t.check("«i» открывает статистику потока", await t.until(async () => (await stats.count()) === 1, 10000));
    let resolution = "";
    const top = await t.until(
      async () => {
        resolution = (await stats.getAttribute("data-resolution")) ?? "";
        return resolution === "1920×1080";
      },
      40000,
      500,
    );
    const toTopSec = ((Date.now() - started) / 1000).toFixed(1);
    t.note(`верхний слой у зрителя: ${top ? `1920×1080 через ${toTopSec} с после старта показа` : `не пришёл за 40 с (было ${resolution})`}`);
    t.check("«Игры» → у зрителя 1920×1080 за 40 с", top, resolution);
    await t.sleep(1500);
    const statsText = (await stats.innerText()).replace(/\s+/g, " ");
    t.check("в статистике есть кадры, поток и кодек", !/…/.test(statsText), statsText);
    await anna.shot("stage-stats");
    await anna.page.keyboard.press("Escape");

    // F — во весь экран и обратно.
    await anna.press("KeyF");
    const fullscreenId = () => anna.page.evaluate(() => document.fullscreenElement?.getAttribute("data-testid") ?? null);
    t.check("F → сцена во весь экран", await t.until(async () => (await fullscreenId()) === "screen-stage", 5000));
    await anna.press("KeyF");
    t.check("F ещё раз → обычный режим", await t.until(async () => (await fullscreenId()) === null, 5000));

    // Зум колёсиком к курсору, Esc — сброс.
    const box = await stage(anna).locator("video").boundingBox();
    await anna.page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.3);
    for (let i = 0; i < 5; i++) {
      await anna.page.mouse.wheel(0, -100);
      await t.sleep(60);
    }
    const zoom = Number(await stage(anna).getAttribute("data-zoom"));
    t.check("колесо приближает (data-zoom > 1)", zoom > 1, `×${zoom}`);
    await anna.page.keyboard.press("Escape");
    t.check("Esc сбрасывает зум", await t.until(async () => (await stage(anna).getAttribute("data-zoom")) === "1.00", 3000));

    // «Не смотреть»: сцена уходит, картинка перестаёт приходить; «Смотреть» — вернуть.
    await stage(anna).hover();
    await stage(anna).locator('[data-testid="stage-hide"]').click();
    t.check("«Не смотреть» убирает сцену", await t.until(async () => (await stage(anna).count()) === 0, 10000));
    const hidden = anna.page.locator('[data-testid="hidden-stream"]');
    t.check("вместо сцены — «Борис показывает экран · Смотреть»", (await hidden.count()) > 0);
    await t.sleep(1500);
    const f1 = await framesDecoded(anna);
    await t.sleep(2500);
    const f2 = await framesDecoded(anna);
    t.check("видео больше не приходит", f2 - f1 < 5, `кадров за 2,5 с: ${f2 - f1}`);
    await hidden.first().getByRole("button", { name: "Смотреть" }).click();
    t.check("«Смотреть» возвращает сцену", await t.until(async () => (await stage(anna).count()) === 1, 15000));

    // Остановка стримером.
    await shareButton(boris).click();
    t.check(
      "Борис остановил показ — у Анны и Вики сцена ушла",
      await t.until(async () => (await stage(anna).count()) === 0 && (await stage(vika).count()) === 0, 15000),
    );

    // Остановка хостом.
    await shareButton(boris).click();
    await t.until(async () => (await stage(anna).count()) === 1, 30000);
    const menu = await anna.openParticipantMenu(idB);
    await menu.locator('[data-testid="host-stop-screen"]').click();
    t.check(
      "хост остановил чужой показ — у Бориса кнопка отжата",
      await t.until(async () => (await shareButton(boris).getAttribute("aria-pressed")) === "false", 20000),
    );
    t.check("…и у зрителей сцена ушла", await t.until(async () => (await stage(vika).count()) === 0, 15000));
    t.check(
      "право показывать у Бориса осталось",
      (await canPublish(code, idB))?.includes(TrackSource.SCREEN_SHARE),
      JSON.stringify(await canPublish(code, idB)),
    );

    // «Экран — только хост»: у гостя кнопка неактивна, сервер отобрал право.
    await anna.setRoomPolicy("Кто может показывать экран", "Только хост");
    t.check("«только хост»: у Вики кнопка экрана неактивна", await t.until(async () => await shareButton(vika).isDisabled(), 15000));
    t.check(
      "…с объяснением в подписи",
      (await shareButton(vika).getAttribute("aria-label"))?.startsWith("Показ экрана:"),
      await shareButton(vika).getAttribute("aria-label"),
    );
    t.check(
      "…и сервер забрал право показа",
      !(await canPublish(code, idV))?.includes(TrackSource.SCREEN_SHARE),
      JSON.stringify(await canPublish(code, idV)),
    );
    t.check("у хоста кнопка активна", !(await shareButton(anna).isDisabled()));
    await vika.shot("screen-host-only");
    await anna.setRoomPolicy("Кто может показывать экран", "Все");
    t.check("«Все» вернуло кнопку Вике", await t.until(async () => !(await shareButton(vika).isDisabled()), 15000));
  },
};

export default scenario;
