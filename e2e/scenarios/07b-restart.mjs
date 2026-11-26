// 7b. Перезапуск LiveKit: стенд гасится целиком и поднимается заново (так же,
// как его запускают отдельным процессом). Люди должны вернуться сами, комната —
// восстановиться с прежним описанием, хостом и историей чата. Стенд остаётся
// запущенным. Если стенд запущен не отдельным процессом (нет .dev-stack/stack.pid),
// сценарий пропускается.
import { waitSeats } from "../lib/person.mjs";
import { participants, restartStack, roomMeta, stackPid, webhookPorts } from "../lib/stand.mjs";

const scenario = {
  id: "restart",
  title: "Живучесть: перезапуск LiveKit (весь стенд)",
  timeoutMs: 8 * 60_000,
  async run(t) {
    if (!stackPid()) t.skip("стенд запущен не отдельным процессом — нет живого PID в .dev-stack/stack.pid");
    const TITLE = "e2e перезапуск";
    const { code, hostKey } = await t.room(TITLE);
    const anna = await t.person("Анна", { code, hostKey });
    const boris = await t.person("Борис");
    const vika = await t.person("Вика");
    const people = [anna, boris, vika];
    for (const p of people) await p.join(code);
    await waitSeats(people, 3);
    const idA = await anna.identity();
    const idB = await boris.identity();
    await anna.page.locator('[data-testid="dock-chat"]').click();
    await anna.page.locator('[data-testid="chat-input"]').fill("до перезапуска");
    await anna.page.locator('[data-testid="chat-input"]').press("Enter");
    await t.until(async () => (await anna.page.locator('[data-testid="chat-message"][data-state="sent"]').count()) === 1);
    await anna.page.locator('[data-testid="dock-chat"]').click();

    const { pid, downMs } = await restartStack({ webhookPorts: webhookPorts(t.base) });
    t.note(`стенд перезапущен: недоступен ${(downMs / 1000).toFixed(1)} с, новый PID ${pid}`);
    const up0 = Date.now();

    // Кто как возвращался: экраны по дороге («Связь потеряна» — тупик, который чинит человек).
    const seen = new Map(people.map((p) => [p.name, new Set()]));
    const backAt = new Map();
    const allBack = await t.until(
      async () => {
        for (const p of people) {
          const kind = await p.screenKind();
          if (kind) seen.get(p.name).add(kind);
          if (!backAt.has(p.name) && (await p.connected()) && !kind) backAt.set(p.name, Date.now() - up0);
        }
        const live = await participants(code);
        return backAt.size === people.length && live.length === people.length;
      },
      240000,
      500,
    );
    const times = people.map((p) => `${p.name} ${backAt.has(p.name) ? `${(backAt.get(p.name) / 1000).toFixed(1)} с` : "—"}`);
    t.note(`после подъёма стенда вернулись: ${times.join(", ")}`);
    const screens = [...seen].filter(([, s]) => s.size).map(([n, s]) => `${n}: ${[...s].join(", ")}`);
    if (screens.length) t.note(`экраны по дороге: ${screens.join("; ")}`);
    t.check("все вернулись в комнату сами", allBack, times.join(", "));
    t.check("никто не застрял на экране ошибки", screens.length === 0, screens.join("; "));
    const meta = await roomMeta(code);
    t.check(
      "комната восстановлена: название, хост и владелец прежние",
      meta?.title === TITLE && meta?.hostIdentity === idA && meta?.ownerIdentity === idA,
      JSON.stringify(meta),
    );
    await waitSeats(people, 3).then(
      () => t.check("все видят друг друга", true),
      () => t.check("все видят друг друга", false),
    );
    await t.sleep(4000);
    const h = await anna.hears(idB, 3500);
    t.check("голос идёт (Анна слышит Бориса)", h.frames >= 10, `кадров ${h.frames}`);
    await vika.page.locator('[data-testid="dock-chat"]').click();
    t.check(
      "история чата на месте",
      await t.until(async () => (await vika.page.locator('[data-testid="chat-message"]').filter({ hasText: "до перезапуска" }).count()) === 1),
    );
    t.check("стенд работает (новый PID в stack.pid)", stackPid() === pid, `PID ${stackPid()}`);
  },
};

export default scenario;
