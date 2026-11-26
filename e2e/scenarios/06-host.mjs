// 6. Права хоста: принудительный мьют, «выключить микрофоны всем», передача прав
// и возврат владельцем, владельца нельзя выгнать, кик с отсчётом и отказом при
// повторном входе, бан и разбан, замок для новых людей.
import { waitSeats } from "../lib/person.mjs";
import { TrackSource, api, canPublish, micMuted, roomMeta } from "../lib/stand.mjs";

const scenario = {
  id: "host",
  title: "Хост: мьют, всем, передача прав, владелец, кик, бан, замок",
  timeoutMs: 8 * 60_000,
  async run(t) {
    const { code, hostKey } = await t.room("e2e хост");
    const anna = await t.person("Анна", { code, hostKey });
    const boris = await t.person("Борис");
    const vika = await t.person("Вика");
    const gleb = await t.person("Глеб");
    for (const p of [anna, boris, vika, gleb]) await p.join(code);
    await waitSeats([anna, boris, vika, gleb], 4);
    const [idA, idB, idV, idG] = await Promise.all([anna, boris, vika, gleb].map((p) => p.identity()));
    await t.until(async () => (await roomMeta(code))?.hostIdentity === idA);

    // Принудительный мьют.
    let menu = await anna.openParticipantMenu(idB);
    await menu.locator('[data-testid="host-mute"]').click();
    t.check(
      "мьют: сервер забрал у Бориса микрофон",
      await t.until(async () => !(await canPublish(code, idB))?.includes(TrackSource.MICROPHONE)),
    );
    t.check(
      "мьют: у Бориса плашка «Хост выключил ваш микрофон»",
      await t.until(async () => (await boris.page.getByText("Хост выключил ваш микрофон").count()) > 0),
    );
    t.check("мьют: у Бориса кнопка микрофона неактивна", await boris.page.locator('[data-testid="dock-mic"]').isDisabled());
    t.check(
      "мьют: у Вики на месте Бориса «заглушён хостом»",
      await t.until(async () => (await vika.seatLabel(idB)).includes("заглушён хостом")),
      await vika.seatLabel(idB),
    );
    await boris.press("KeyM");
    await t.sleep(800);
    t.check("мьют: M у Бориса не открывает микрофон", (await micMuted(code, idB)) !== false);
    await menu.locator('[data-testid="host-mute"]').click();
    t.check(
      "«Вернуть микрофон»: право вернулось",
      await t.until(async () => (await canPublish(code, idB))?.includes(TrackSource.MICROPHONE)),
    );
    await anna.page.keyboard.press("Escape");
    t.check(
      "…плашка у Бориса ушла",
      await t.until(async () => (await boris.page.getByText("Хост выключил ваш микрофон").count()) === 0),
    );
    // Микрофон включает сам человек — хост только возвращает право.
    if ((await micMuted(code, idB)) !== false) await boris.press("KeyM");
    t.check("…и Борис снова в эфире", await t.until(async () => (await micMuted(code, idB)) === false, 8000));

    // «Выключить микрофоны всем»: всем, кроме хоста; включить можно самому.
    const dialog = await anna.openRoomSettings();
    await dialog.locator('[data-testid="mute-all"]').click();
    t.check(
      "«выключить всем»: Борис, Вика и Глеб заглушены",
      await t.until(async () => {
        const m = await Promise.all([idB, idV, idG].map((id) => micMuted(code, id)));
        return m.every((x) => x === true);
      }),
    );
    t.check("…а хост — нет", (await micMuted(code, idA)) === false);
    // Раньше клиент через ~0,4 с сам снимал заглушение — ждём дольше.
    await t.sleep(1500);
    const stillMuted = await Promise.all([idB, idV, idG].map((id) => micMuted(code, id)));
    t.check("…и через 1,5 с не включились сами", stillMuted.every((x) => x === true), JSON.stringify(stillMuted));
    t.check(
      "…у Вики тост «Хост выключил всем микрофоны»",
      (await vika.page.getByText("Хост выключил всем микрофоны").count()) > 0,
    );
    await anna.page.keyboard.press("Escape");
    await vika.press("KeyM");
    t.check("…Вика включила себе микрофон сама", await t.until(async () => (await micMuted(code, idV)) === false, 8000));

    // Передача прав и возврат владельцем; владельца нельзя выгнать.
    menu = await anna.openParticipantMenu(idB);
    await menu.locator('[data-testid="host-transfer"]').click();
    await menu.getByRole("button", { name: "Передать", exact: true }).click();
    t.check("права хоста у Бориса", await t.until(async () => (await roomMeta(code))?.hostIdentity === idB));
    await boris.page.locator('[data-testid="room-menu"]').click();
    t.check(
      "у Бориса в меню комнаты появились настройки хоста",
      await t.until(async () => (await boris.page.locator('[data-testid="menu-room-settings"]').count()) === 1),
    );
    await boris.page.keyboard.press("Escape");
    menu = await boris.openParticipantMenu(idA);
    t.check(
      "у владельца в меню нового хоста нет «Выгнать» и «Забанить»",
      (await menu.locator('[data-testid="host-kick"], [data-testid="host-ban"]').count()) === 0 &&
        (await menu.getByText("Это создатель комнаты").count()) === 1,
    );
    await boris.page.keyboard.press("Escape");
    for (const action of ["kick", "ban", "mute"]) {
      const r = await api(t.base, "POST", "/api/moderate", { code, token: boris.token, action, target: idA });
      t.check(`сервер: ${action} владельца → TARGET_IS_OWNER`, r.body?.error?.code === "TARGET_IS_OWNER", `${r.status} ${r.body?.error?.code}`);
    }
    await anna.page.locator('[data-testid="room-menu"]').click();
    await anna.page.locator('[data-testid="menu-reclaim"]').click();
    t.check("владелец вернул права", await t.until(async () => (await roomMeta(code))?.hostIdentity === idA));

    // Кик: экран с отсчётом, повторный вход отклонён.
    menu = await anna.openParticipantMenu(idG);
    await menu.locator('[data-testid="host-kick"]').click();
    await menu.getByRole("button", { name: "Выгнать", exact: true }).click();
    t.check("кик: у Глеба экран «Вас выгнали»", await t.until(async () => (await gleb.screenKind()) === "kicked", 15000));
    const kickedText = await gleb.page.locator('[data-testid="state-screen"]').textContent();
    t.check("…с отсчётом до возврата", /через \d:\d\d/.test(kickedText ?? ""), kickedText);
    await gleb.shot("kicked");
    await gleb.page.reload({ waitUntil: "domcontentloaded" });
    await gleb.page.locator('[data-testid="join-submit"]').click({ timeout: 120000 });
    t.check("повторный вход отклонён — снова экран с отсчётом", await t.until(async () => (await gleb.screenKind()) === "kicked", 15000));
    t.check(
      "сервер: KICKED с retryAfterSec ≤ 300",
      gleb.lastRefusal?.error?.code === "KICKED" && gleb.lastRefusal.error.retryAfterSec <= 300,
      JSON.stringify(gleb.lastRefusal),
    );
    t.check("Глеба нет в комнате", await t.until(async () => (await anna.seat(idG).count()) === 0));

    // Бан и разбан.
    menu = await anna.openParticipantMenu(idV);
    await menu.locator('[data-testid="host-ban"]').click();
    await menu.getByRole("button", { name: "Забанить", exact: true }).click();
    t.check("бан: у Вики экран «Вас забанили»", await t.until(async () => (await vika.screenKind()) === "banned", 15000));
    await vika.page.reload({ waitUntil: "domcontentloaded" });
    await vika.page.locator('[data-testid="join-submit"]').click({ timeout: 120000 });
    t.check("забаненную не пускает", await t.until(async () => (await vika.screenKind()) === "banned", 15000));
    const settings = await anna.openRoomSettings();
    const banList = settings.locator('[data-testid="ban-list"]');
    t.check("Вика в списке банов", await t.until(async () => (await banList.textContent())?.includes("Вика"), 10000));
    await banList.locator('[data-testid="unban"]').first().click();
    t.check("разбан убрал её из списка", await t.until(async () => (await banList.count()) === 0, 10000));
    await anna.page.keyboard.press("Escape");
    await vika.page.reload({ waitUntil: "domcontentloaded" });
    await vika.page.locator('[data-testid="join-submit"]').click({ timeout: 120000 });
    await vika.waitConnected(60000).then(
      () => t.check("после разбана Вика вошла", true),
      () => t.check("после разбана Вика вошла", false, String(vika.lastRefusal?.error?.code)),
    );

    // Замок: новый человек не входит, свой может вернуться.
    await anna.page.locator('[data-testid="room-menu"]').click();
    await anna.page.locator('[data-testid="menu-lock"]').click();
    await anna.page.keyboard.press("Escape");
    t.check("замок включён", await t.until(async () => (await roomMeta(code))?.locked === true));
    const dima = await t.person("Дима");
    await dima.open(code);
    t.check("лобби новичка предупреждает «Вход закрыт»", await t.until(async () => (await dima.page.getByText("Вход закрыт").count()) > 0));
    await dima.submit();
    t.check("новичка не пускает — экран «Вход закрыт»", await t.until(async () => (await dima.screenKind()) === "locked", 15000));
    t.check("сервер: ROOM_LOCKED", dima.lastRefusal?.error?.code === "ROOM_LOCKED", JSON.stringify(dima.lastRefusal));
    await boris.page.reload({ waitUntil: "domcontentloaded" });
    await boris.page.locator('[data-testid="join-submit"]').click({ timeout: 120000 });
    await boris.waitConnected(60000).then(
      () => t.check("свой (был в комнате) при замке возвращается", true),
      () =>
        t.check(
          "свой (был в комнате) при замке возвращается",
          false,
          // «Своих» сервер узнаёт из вебхука participant_joined: без вебхуков на порт
          // сайта (APP_PORTS стенда) здесь будет ROOM_LOCKED.
          `${JSON.stringify(boris.lastRefusal)} — сайт получает вебхуки LiveKit?`,
        ),
    );
    await anna.page.locator('[data-testid="room-menu"]').click();
    await anna.page.locator('[data-testid="menu-lock"]').click();
    await anna.page.keyboard.press("Escape");
    t.check("замок снят", await t.until(async () => (await roomMeta(code))?.locked === false));
    await dima.page.locator('[data-testid="screen-primary"]').click();
    await dima.waitConnected(60000).then(
      () => t.check("после снятия замка новичок вошёл («Попробовать снова»)", true),
      () => t.check("после снятия замка новичок вошёл («Попробовать снова»)", false, JSON.stringify(dima.lastRefusal)),
    );
  },
};

export default scenario;
