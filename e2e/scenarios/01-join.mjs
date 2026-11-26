// 1. Вход: лобби (ник, «кто уже внутри»), вход, неверный пароль с остатком
// попыток, несуществующий код, вторая вкладка с того же устройства.
import { missingRoomCode, roomMeta } from "../lib/stand.mjs";
import { IN_ROOM } from "../lib/person.mjs";

const scenario = {
  id: "join",
  title: "Вход: лобби, пароль, нет комнаты, вторая вкладка",
  async run(t) {
    const TITLE = "e2e вход";
    const { code, hostKey } = await t.room(TITLE);
    const anna = await t.person("Анна", { code, hostKey });
    const boris = await t.person("Борис");
    const vika = await t.person("Вика");

    // Владелец входит первым и становится хостом.
    await anna.open(code);
    t.check(
      "лобби владельца: «Ваша комната» и название",
      (await anna.page.getByText("Ваша комната").count()) > 0 && (await anna.page.getByText(TITLE).count()) > 0,
    );
    await anna.submit();
    await anna.waitConnected();
    const idA = await anna.identity();
    t.check("владелец вошёл, identity по устройству", idA?.startsWith("u_"), idA);
    t.check(
      "владелец с ключом стал хостом",
      await t.until(async () => (await roomMeta(code))?.hostIdentity === idA),
    );
    t.check("своё место подписано «это вы»", (await anna.seatLabel(idA)).includes("это вы"), await anna.seatLabel(idA));

    // Гость: лобби показывает, кто внутри; ник; вход.
    await boris.open(code);
    const who = boris.page.locator('[data-testid="lobby-who"]');
    t.check(
      "лобби гостя: кто уже в комнате",
      await t.until(async () => (await who.textContent())?.includes("Анна уже тут")),
      await who.textContent().catch(() => ""),
    );
    await boris.submit();
    await boris.waitConnected();
    const idB = await boris.identity();
    t.check(
      "ник сохранён и виден другим",
      await t.until(async () => (await anna.seatLabel(idB)).startsWith("Борис")),
      await anna.seatLabel(idB),
    );
    t.check("гость видит хоста с короной в подписи", (await boris.seatLabel(idA)).includes("хост"), await boris.seatLabel(idA));
    await vika.open(code);
    t.check(
      "третьему лобби называет обоих, хост первым",
      await t.until(async () => (await vika.page.locator('[data-testid="lobby-who"]').textContent()) === "Анна и Борис уже тут"),
      await vika.page.locator('[data-testid="lobby-who"]').textContent().catch(() => ""),
    );

    // Неверный пароль: подсказка у поля и остаток попыток в ответе сервера.
    const PASSWORD = "клуб-2026";
    const locked = await t.room("e2e пароль", { password: PASSWORD });
    await vika.open(locked.code);
    t.check(
      "у комнаты с паролем лобби показывает только число людей",
      (await vika.page.locator('[data-testid="lobby-who"]').textContent().catch(() => "")) === "Пока внутри никого",
    );
    t.check("поле пароля на месте", (await vika.page.locator('[data-testid="join-password"]').count()) === 1);
    await vika.submit({ password: "неверный" });
    t.check(
      "неверный пароль → WRONG_PASSWORD с attemptsLeft",
      await t.until(() => vika.lastRefusal?.error?.code === "WRONG_PASSWORD"),
      JSON.stringify(vika.lastRefusal),
    );
    const left1 = vika.lastRefusal?.error?.attemptsLeft;
    t.check("attemptsLeft — число", Number.isInteger(left1), left1);
    // Остаток лобби называет, только когда попыток ≤ 5; при большом — просто «Неверный пароль».
    const hint = vika.page.getByText(left1 > 5 ? "Неверный пароль" : `Неверный пароль. Осталось попыток: ${left1}`, { exact: true });
    t.check("подсказка у поля: «Неверный пароль» (остаток — при ≤ 5)", await t.until(async () => (await hint.count()) > 0));
    vika.lastRefusal = null;
    await vika.submit({ password: "снова-неверный" });
    await t.until(() => vika.lastRefusal?.error?.code === "WRONG_PASSWORD");
    const left2 = vika.lastRefusal?.error?.attemptsLeft;
    t.check("вторая ошибка — попыток на одну меньше", left2 === left1 - 1, `${left1} → ${left2}`);
    await vika.submit({ password: PASSWORD });
    await vika.waitConnected().then(
      () => t.check("верный пароль пускает", true),
      () => t.check("верный пароль пускает", false),
    );
    await vika.shot("password-room");

    // Несуществующий код → экран «не найдена».
    const missing = await missingRoomCode(t.base);
    await vika.open(missing);
    t.check(
      `несуществующий код ${missing} → экран «Комнаты нет»`,
      await t.until(async () => (await vika.screenKind()) === "notFound"),
      await vika.screenKind(),
    );
    t.check(
      "на экране понятный текст и действие",
      (await vika.page.getByText(`Комнаты ${missing} нет`).count()) > 0 &&
        (await vika.page.locator('[data-testid="screen-primary"]').count()) > 0,
    );

    // Вторая вкладка с того же устройства → первая на экране «Вернуться сюда».
    const tab2 = await boris.ctx.newPage();
    boris.watch(tab2);
    await tab2.goto(`${t.base}/room/${code}`, { waitUntil: "domcontentloaded" });
    await tab2.locator('[data-testid="join-submit"]').click({ timeout: 120000 });
    await tab2.locator(IN_ROOM).waitFor({ timeout: 120000 });
    t.check(
      "вторая вкладка вошла, первая показывает «Вы открыли комнату в другой вкладке»",
      await t.until(async () => (await boris.screenKind()) === "duplicate", 20000),
      await boris.screenKind(),
    );
    const primary = boris.page.locator('[data-testid="screen-primary"]');
    t.check("кнопка «Вернуться сюда»", (await primary.textContent())?.includes("Вернуться сюда"), await primary.textContent());
    await boris.shot("duplicate");
    await primary.click();
    await boris.waitConnected(60000).then(
      () => t.check("«Вернуться сюда» вернуло первую вкладку в комнату", true),
      () => t.check("«Вернуться сюда» вернуло первую вкладку в комнату", false),
    );
    const tab2Kind = async () => {
      const el = tab2.locator('[data-testid="state-screen"]');
      return (await el.count()) ? el.getAttribute("data-kind") : null;
    };
    t.check("вторая вкладка теперь на экране «другая вкладка»", await t.until(async () => (await tab2Kind()) === "duplicate", 20000));
    t.check(
      "у остальных Борис по-прежнему один",
      await t.until(async () => (await anna.seat(idB).count()) === 1),
      await anna.seat(idB).count(),
    );
    await tab2.close();
  },
};

export default scenario;
