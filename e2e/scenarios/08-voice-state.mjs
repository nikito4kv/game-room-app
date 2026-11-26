// 8. Состояние голоса видно другим: «Звук выкл» (D) и рация — значки на месте
// человека у остальных; держит V — значок рации уходит; вошедший позже видит
// состояние сразу.
import { waitSeats } from "../lib/person.mjs";

const scenario = {
  id: "voice-state",
  title: "Состояние голоса видно другим: D и рация",
  async run(t) {
    const { code, hostKey } = await t.room("e2e состояние голоса");
    const anna = await t.person("Анна", { code, hostKey });
    const boris = await t.person("Борис");
    await anna.join(code);
    await boris.join(code);
    await waitSeats([anna, boris], 2);
    const idA = await anna.identity();
    const label = () => boris.seatLabel(idA);
    t.check("в покое значков нет", !/звук выключен|в режиме рации|микрофон выключен/.test(await label()), await label());

    /** Сколько мс ждали, пока подпись места Анны у Бориса станет нужной. */
    const waitLabel = async (ok, timeout = 5000) => {
      const t0 = Date.now();
      return (await t.until(async () => ok(await label()), timeout, 50)) ? Date.now() - t0 : null;
    };

    await anna.press("KeyD");
    let ms = await waitLabel((l) => l.includes("звук выключен"));
    t.check("Анна нажала D → у Бориса «звук выключен»", ms !== null, `${ms} мс · «${await label()}»`);
    await boris.seat(idA).first().screenshot({ path: `${t.out}/${t.id}-deafened-seat.png` }).catch(() => {});
    await anna.press("KeyD");
    ms = await waitLabel((l) => !l.includes("звук выключен"));
    t.check("сняла D → значок пропал", ms !== null, `${ms} мс`);

    await anna.setVoiceMode("Рация");
    ms = await waitLabel((l) => l.includes("в режиме рации"));
    t.check("включила рацию → у Бориса «в режиме рации», а не «микрофон выключен»", ms !== null && !(await label()).includes("микрофон выключен"), `${ms} мс · «${await label()}»`);
    await anna.page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null));
    await anna.page.keyboard.down("KeyV");
    ms = await waitLabel((l) => !l.includes("в режиме рации"));
    t.check("держит V → значок рации ушёл (в эфире)", ms !== null, `${ms} мс · «${await label()}»`);
    await t.sleep(800);
    await anna.page.keyboard.up("KeyV");
    ms = await waitLabel((l) => l.includes("в режиме рации"));
    t.check("отпустила V → значок рации вернулся", ms !== null, `${ms} мс`);

    // Панель участника говорит то же словами.
    const menu = await boris.openParticipantMenu(idA);
    await t.sleep(300);
    const text = (await menu.innerText()).replace(/\s+/g, " ");
    t.check("в панели участника — «в режиме рации»", text.includes("в режиме рации"), text.slice(0, 80));
    await boris.page.keyboard.press("Escape");

    // Вошедший позже видит состояние сразу.
    await anna.press("KeyD");
    await waitLabel((l) => l.includes("звук выключен"));
    const vika = await t.person("Вика", { viewport: { width: 390, height: 844 } });
    await vika.join(code);
    const seen = await t.until(async () => (await vika.seatLabel(idA)).includes("звук выключен"), 5000, 50);
    t.check("вошедшая позже сразу видит «звук выключен»", seen, await vika.seatLabel(idA));
    await vika.shot("late-joiner-390");
  },
};

export default scenario;
