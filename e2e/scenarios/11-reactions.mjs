// 11. Реакции (👍 🔥 😂 GG): хост жмёт 🔥 в доке — у себя видит сразу, у гостя
// реакция всплывает в месте хоста и через ≈2 с уходит. Скринридеру гостя её
// объявляет live-область, очередь — одной склеенной фразой. По реакциям ходят
// стрелками, Esc возвращает фокус на кнопку. Короткая очередь проходит, флуд
// режет клиент (тост) и сервер (RATE_LIMITED в обход клиента).
import { waitSeats } from "../lib/person.mjs";
import { api } from "../lib/stand.mjs";

const scenario = {
  id: "reactions",
  title: "Реакции: 🔥 хоста у гостя, очередь и флуд",
  async run(t) {
    const { code, hostKey } = await t.room("e2e реакции");
    const anna = await t.person("Анна", { code, hostKey });
    const boris = await t.person("Борис");
    await anna.join(code);
    await boris.join(code);
    await waitSeats([anna, boris], 2);
    const annaId = await anna.identity();
    const borisId = await boris.identity();
    const bubble = (p, identity, kind) =>
      p.seat(identity).locator(kind ? `[data-reaction="${kind}"]` : "[data-reaction]");
    const button = (p) => p.page.locator('[data-testid="dock-reactions"]');
    const pick = (p, kind) => p.page.locator(`[data-testid="reaction-${kind}"]`);
    const live = (p) => p.page.locator('[data-testid="reactions-live"]');
    const focused = (p) => p.page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName);
    // Поповер мог закрыться сам (на деве — горячая перезагрузка): открыть, если закрыт.
    const openPicker = async (p) => {
      const pop = p.page.locator('[data-testid="reactions-popover"]');
      if (!(await pop.isVisible())) await button(p).click();
      await pop.waitFor({ state: "visible", timeout: 5000 });
    };

    t.check("в доке есть «Реакции»", (await button(anna).count()) === 1 && (await button(boris).count()) === 1);
    await button(anna).click();
    const popover = anna.page.locator('[data-testid="reactions-popover"]');
    t.check(
      "поповер: четыре реакции",
      // Только панель реакций: с флагами soundboard/games/statuses в поповере есть и другие.
      await t.until(
        async () =>
          (await popover.isVisible()) &&
          (await popover.locator('[role="toolbar"][aria-label="Отправить реакцию"] button').count()) === 4,
        5000,
      ),
    );

    // 🔥 хоста: у себя — сразу, у гостя — в месте хоста.
    await pick(anna, "fire").click();
    const clickedAt = Date.now();
    t.check("своя реакция видна сразу, без эха сервера", await t.until(async () => (await bubble(anna, annaId, "fire").count()) === 1, 1000, 50));
    t.check(
      "у Бориса 🔥 всплыла в месте Анны",
      await t.until(async () => (await bubble(boris, annaId, "fire").count()) === 1, 5000, 50),
    );
    t.note(`🔥 дошла до Бориса за ${Date.now() - clickedAt} мс`);
    t.check(
      "скринридер Бориса слышит «Анна: огонь»",
      await t.until(async () => (await live(boris).textContent())?.includes("Анна: огонь"), 3000, 50),
      await live(boris).textContent(),
    );
    await boris.shot("fire-at-host");
    t.check("…а в месте Бориса реакции нет", (await bubble(boris, borisId).count()) === 0);
    t.check(
      "через ≈2 с реакция ушла",
      await t.until(async () => (await bubble(boris, annaId).count()) === 0, 5000, 100),
      `${Date.now() - clickedAt} мс после клика`,
    );

    // Ответ гостя: GG — Анна видит в месте Бориса.
    await openPicker(boris);
    await pick(boris, "gg").click();
    t.check("GG Бориса — у Анны в месте Бориса", await t.until(async () => (await bubble(anna, borisId, "gg").count()) === 1, 5000, 50));
    await boris.page.keyboard.press("Escape");
    t.check("Esc закрывает поповер", await t.until(async () => !(await boris.page.locator('[data-testid="reactions-popover"]').isVisible()), 2000));
    t.check("…и фокус вернулся на «Реакции»", await t.until(async () => (await focused(boris)) === "dock-reactions", 2000), await focused(boris));

    // Клавиатура: Enter открывает, стрелки и Home/End ходят по реакциям по кругу.
    await button(boris).focus();
    await boris.page.keyboard.press("Enter");
    const seen = [];
    if (await t.until(async () => (await focused(boris)) === "reaction-like", 3000)) {
      for (const key of ["ArrowRight", "ArrowRight", "End", "ArrowRight", "ArrowLeft", "Home"]) {
        await boris.page.keyboard.press(key);
        seen.push(await focused(boris));
      }
    }
    t.check(
      "стрелки: → 🔥 → 😂, End — GG, → по кругу 👍, ← GG, Home 👍",
      seen.join(",") === "reaction-fire,reaction-lol,reaction-gg,reaction-like,reaction-gg,reaction-like",
      seen.join(","),
    );
    t.check(
      "в порядке Tab — одна реакция (панель инструментов)",
      (await boris.page
        .locator('[data-testid="reactions-popover"] [role="toolbar"][aria-label="Отправить реакцию"] button[tabindex="0"]')
        .count()) === 1,
    );
    await boris.page.keyboard.press("Escape");
    t.check(
      "Esc с клавиатуры — фокус снова на «Реакции»",
      await t.until(async () => (await focused(boris)) === "dock-reactions", 2000),
      await focused(boris),
    );

    // Короткая очередь проходит, шестая за 5 с — «Слишком часто» без запроса.
    await t.sleep(5200);
    let posts = 0;
    const count = (req) => {
      if (req.url().endsWith("/api/reaction") && req.method() === "POST") posts++;
    };
    await openPicker(anna);
    anna.page.on("request", count);
    // Поповер после выбора не закрывается — очередь жмётся подряд.
    for (let i = 0; i < 5; i++) await pick(anna, "lol").click({ timeout: 3000 });
    t.check("очередь из пяти 😂 у Бориса", await t.until(async () => (await bubble(boris, annaId, "lol").count()) === 1, 5000, 50));
    t.check(
      "скринридеру очередь — одной склеенной фразой, не пятью",
      await t.until(async () => /Анна: смешно \d+ раза?/.test((await live(boris).textContent()) ?? ""), 4000, 100),
      await live(boris).textContent(),
    );
    await pick(anna, "like").click({ timeout: 3000 });
    t.check(
      "шестая подряд — тост «Слишком часто», на сервер не ушла",
      await t.until(async () => (await anna.page.getByText(/^Слишком часто/).count()) > 0, 2000),
      `запросов: ${posts}`,
    );
    t.check("…запросов ровно пять", posts === 5, posts);
    anna.page.off("request", count);

    // В обход клиента: сервер режет флуд и мусор.
    const results = [];
    for (let i = 0; i < 14; i++) {
      results.push(await api(t.base, "POST", "/api/reaction", { code, token: boris.token, kind: "fire" }));
    }
    const limited = results.filter((r) => r.status === 429 && r.body?.error?.code === "RATE_LIMITED");
    t.check("флуд в обход клиента — RATE_LIMITED", limited.length > 0, `429: ${limited.length} из ${results.length}`);
    const junk = await api(t.base, "POST", "/api/reaction", { code, token: anna.token, kind: "heart" });
    t.check("неизвестная реакция — BAD_REQUEST", junk.status === 400 && junk.body?.error?.code === "BAD_REQUEST", junk.status);
    const fake = await api(t.base, "POST", "/api/reaction", { code, token: "подделка", kind: "fire" });
    t.check("чужой токен — UNAUTHORIZED", fake.body?.error?.code === "UNAUTHORIZED", fake.status);
  },
};

export default scenario;
