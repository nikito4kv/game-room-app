// 4. Чат: отправка и приём, непрочитанные, история у вошедшего позже, ссылка
// кликабельна и безопасна, разметка не исполняется, хост запретил чат — поле
// неактивно и сервер отказывает.
import { waitSeats } from "../lib/person.mjs";
import { api } from "../lib/stand.mjs";

const scenario = {
  id: "chat",
  title: "Чат: приём, история, ссылки, запрет хостом",
  async run(t) {
    const { code, hostKey } = await t.room("e2e чат");
    const anna = await t.person("Анна", { code, hostKey });
    const boris = await t.person("Борис");
    const vika = await t.person("Вика");
    await anna.join(code);
    await boris.join(code);
    await waitSeats([anna, boris], 2);
    const input = (p) => p.page.locator('[data-testid="chat-input"]');
    const messages = (p) => p.page.locator('[data-testid="chat-message"]');

    // Отправка и приём.
    await anna.page.locator('[data-testid="dock-chat"]').click();
    await input(anna).fill("привет! вот лобби: https://example.com/lobby?x=1.");
    await input(anna).press("Enter");
    t.check(
      "у автора сообщение подтверждено сервером",
      await t.until(async () => (await anna.page.locator('[data-testid="chat-message"][data-state="sent"]').count()) === 1),
    );
    const chatButton = boris.page.locator('[data-testid="dock-chat"]');
    t.check(
      "у Бориса бейдж непрочитанных на кнопке чата",
      await t.until(async () => (await chatButton.getAttribute("aria-label")) === "Чат, непрочитанных: 1"),
      await chatButton.getAttribute("aria-label"),
    );
    t.check("…и «(1)» в заголовке вкладки", (await boris.page.title()).startsWith("(1) "), await boris.page.title());
    await chatButton.click();
    t.check(
      "Борис получил сообщение",
      await t.until(async () => (await messages(boris).filter({ hasText: "привет!" }).count()) === 1),
    );
    const link = messages(boris).locator("a").first();
    const attrs = {
      href: await link.getAttribute("href"),
      target: await link.getAttribute("target"),
      rel: await link.getAttribute("rel"),
    };
    t.check(
      "ссылка кликабельна, точка в конце не попала в адрес, target=_blank, rel=noopener noreferrer",
      attrs.href === "https://example.com/lobby?x=1" && attrs.target === "_blank" && attrs.rel === "noopener noreferrer",
      JSON.stringify(attrs),
    );
    t.check("открыл чат — непрочитанные сброшены", !(await boris.page.title()).startsWith("("), await boris.page.title());

    // Разметка и javascript:-ссылки — просто текст.
    const evil = `<img src=x onerror="window.__xss=1"> javascript:alert(1) <b>жирно</b>`;
    await input(boris).fill(evil);
    await input(boris).press("Enter");
    const evilMsg = messages(anna).filter({ hasText: "javascript:alert(1)" });
    await t.until(async () => (await evilMsg.count()) === 1);
    const safety = await anna.page.evaluate(() => {
      const panel = document.querySelector('[data-testid="chat-panel"]');
      return {
        img: panel?.querySelectorAll("img").length ?? -1,
        bold: panel?.querySelectorAll('[data-testid="chat-message"] b').length ?? -1,
        jsLinks: [...(panel?.querySelectorAll("a") ?? [])].filter((a) => !/^https?:/i.test(a.getAttribute("href") ?? "")).length,
        xss: "__xss" in window,
      };
    });
    t.check(
      "HTML и javascript: в сообщении не исполняются и не становятся ссылкой",
      safety.img === 0 && safety.bold === 0 && safety.jsLinks === 0 && !safety.xss,
      JSON.stringify(safety),
    );
    t.check("…а видны как текст", (await evilMsg.textContent())?.includes("<img src=x"), await evilMsg.textContent());

    // Вошедший позже видит историю.
    await vika.join(code);
    await vika.page.locator('[data-testid="dock-chat"]').click();
    t.check(
      "Вика (вошла позже) видит историю чата",
      await t.until(async () => (await messages(vika).count()) >= 2, 15000),
      `сообщений: ${await messages(vika).count()}`,
    );

    // Хост выключил чат: поле неактивно, сервер отказывает.
    await anna.setRoomPolicy("Кто может писать в чат", "Выключен");
    t.check("чат выключен: у Бориса поле неактивно", await t.until(async () => await input(boris).isDisabled()));
    t.check(
      "…и подсказка почему",
      (await boris.page.locator('[data-testid="chat-blocked"]').textContent().catch(() => ""))?.includes("выключил чат"),
      await boris.page.locator('[data-testid="chat-blocked"]').textContent().catch(() => ""),
    );
    let r = await api(t.base, "POST", "/api/chat", { code, token: boris.token, text: "в обход" });
    t.check("сервер отказывает: CHAT_DISABLED", r.status === 403 && r.body?.error?.code === "CHAT_DISABLED", `${r.status} ${r.body?.error?.code}`);
    await boris.shot("chat-off");

    // «Только хост»: гостю нельзя, хосту можно.
    await anna.setRoomPolicy("Кто может писать в чат", "Только хост");
    r = await api(t.base, "POST", "/api/chat", { code, token: boris.token, text: "в обход" });
    t.check("«только хост»: гостю CHAT_HOST_ONLY", r.body?.error?.code === "CHAT_HOST_ONLY", `${r.status} ${r.body?.error?.code}`);
    r = await api(t.base, "POST", "/api/chat", { code, token: anna.token, text: "хосту можно" });
    t.check("«только хост»: хосту можно", r.status === 200 && !!r.body?.message?.id, r.status);
    t.check(
      "…и сообщение хоста дошло до Бориса",
      await t.until(async () => (await messages(boris).filter({ hasText: "хосту можно" }).count()) === 1),
    );

    // Вернули «Все» — Борис снова пишет.
    await anna.setRoomPolicy("Кто может писать в чат", "Все");
    t.check("«Все»: поле у Бориса снова активно", await t.until(async () => !(await input(boris).isDisabled())));
    await input(boris).fill("снова можно");
    await input(boris).press("Enter");
    t.check(
      "сообщение Бориса дошло до Вики",
      await t.until(async () => (await messages(vika).filter({ hasText: "снова можно" }).count()) === 1),
    );
  },
};

export default scenario;
