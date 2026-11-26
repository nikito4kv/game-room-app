// 7. Живучесть: у всех пропала сеть на 20 с — все вернулись сами; LiveKit
// потерял комнату (deleteRoom) — все вошли заново сами, описание комнаты,
// хост и история чата на месте.
import { waitSeats } from "../lib/person.mjs";
import { lk, participants, roomMeta } from "../lib/stand.mjs";

/** Все снова в комнате: подключены, без экранов ошибок и без полосы «переподключаемся». */
async function allBack(people) {
  for (const p of people) {
    if (!(await p.connected())) return false;
    if ((await p.screenKind()) !== null) return false;
    if ((await p.page.locator('[data-testid="reconnect-banner"]').count()) > 0) return false;
  }
  return true;
}

const scenario = {
  id: "resilience",
  title: "Живучесть: сеть пропала на 20 с, LiveKit потерял комнату",
  timeoutMs: 8 * 60_000,
  async run(t) {
    const TITLE = "e2e живучесть";
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
    await anna.page.locator('[data-testid="chat-input"]').fill("до обрыва");
    await anna.page.locator('[data-testid="chat-input"]').press("Enter");
    await t.until(async () => (await anna.page.locator('[data-testid="chat-message"][data-state="sent"]').count()) === 1);
    await anna.page.locator('[data-testid="dock-chat"]').click();

    // Сеть пропала у всех сразу (клуб) на 20 с.
    for (const p of people) await p.ctx.setOffline(true);
    t.check(
      "без сети у всех полоса «Переподключаемся…»",
      await t.until(async () => {
        for (const p of people) if (!(await p.page.locator('[data-testid="reconnect-banner"]').count())) return false;
        return true;
      }, 30000),
    );
    await boris.shot("offline");
    await t.sleep(20000);
    const back0 = Date.now();
    for (const p of people) await p.ctx.setOffline(false);
    const recovered = await t.until(() => allBack(people), 150000, 500);
    t.note(`после 20 с без сети все вернулись за ${((Date.now() - back0) / 1000).toFixed(1)} с`);
    t.check("сеть вернулась — все снова в комнате сами", recovered);
    await waitSeats(people, 3).then(
      () => t.check("и снова видят друг друга (3 места у каждого)", true),
      () => t.check("и снова видят друг друга (3 места у каждого)", false),
    );
    t.check("хост прежний", (await roomMeta(code))?.hostIdentity === idA);
    await t.sleep(4000);
    let h = await anna.hears(idB, 3500);
    t.check("голос снова идёт (Анна слышит Бориса)", h.frames >= 10, `кадров ${h.frames}`);

    // LiveKit потерял комнату — вход заново через сервер, который её восстановит.
    const sessionsBefore = new Set((await participants(code)).map((p) => p.sid));
    await lk.deleteRoom(code);
    const del0 = Date.now();
    const rejoined = await t.until(
      async () => {
        const now = await participants(code);
        return now.length === 3 && now.every((p) => !sessionsBefore.has(p.sid)) && (await allBack(people));
      },
      120000,
      500,
    );
    t.note(`после deleteRoom все вошли заново за ${((Date.now() - del0) / 1000).toFixed(1)} с`);
    t.check("комната удалена в LiveKit — все вошли заново сами (новые сессии)", rejoined);
    const meta = await roomMeta(code);
    t.check(
      "описание комнаты на месте: название, хост, владелец",
      meta?.title === TITLE && meta?.hostIdentity === idA && meta?.ownerIdentity === idA,
      JSON.stringify(meta),
    );
    await waitSeats(people, 3).then(
      () => t.check("и снова видят друг друга", true),
      () => t.check("и снова видят друг друга", false),
    );
    await t.sleep(4000);
    h = await anna.hears(idB, 3500);
    t.check("голос снова идёт", h.frames >= 10, `кадров ${h.frames}`);
    await vika.page.locator('[data-testid="dock-chat"]').click();
    t.check(
      "история чата пережила потерю комнаты",
      await t.until(async () => (await vika.page.locator('[data-testid="chat-message"]').filter({ hasText: "до обрыва" }).count()) === 1),
    );
  },
};

export default scenario;
