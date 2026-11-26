// 2. Голос: четверо слышат друг друга в оба уха на нормальном уровне; кольцо
// «говорит» загорается и гаснет; M — у слушателя тишина; D — свой микрофон
// заглушён, сам не слышит, у других значок «звук выключен».
import { waitSeats } from "../lib/person.mjs";
import { micMuted } from "../lib/stand.mjs";

const db = (v) => (v > 0 ? `${(20 * Math.log10(v)).toFixed(1)} дБ` : "−∞");
/** Слышно ровно в оба уха (моно разложено на оба канала) и на нормальной громкости. */
const healthy = (h) =>
  h.frames >= 40 && h.L >= 0.01 && h.L <= 0.5 && h.R >= 0.01 && Math.abs(h.L - h.R) / Math.max(h.L, h.R) < 0.2;
const silent = (h) => h.max < 0.003;

const scenario = {
  id: "voice",
  title: "Голос: все слышат всех, кольцо, M, D",
  async run(t) {
    const { code, hostKey } = await t.room("e2e голос");
    const people = [
      await t.person("Анна", { code, hostKey }),
      await t.person("Борис"),
      await t.person("Вика"),
      await t.person("Глеб"),
    ];
    for (const p of people) await p.join(code);
    await waitSeats(people, 4);
    const ids = await Promise.all(people.map((p) => p.identity()));
    const [anna, boris] = people;
    const [idA] = ids;
    await t.sleep(9000);

    // Все слышат всех: по каждой чужой дорожке отдельно, левое и правое ухо.
    const table = [];
    let allGood = true;
    for (const [i, listener] of people.entries()) {
      const heard = await listener.hearing(8000);
      for (const [j, speaker] of people.entries()) {
        if (i === j) continue;
        const h = heard.find((x) => x.identity === ids[j] && x.source === 2) ?? { L: 0, R: 0, frames: 0 };
        const good = healthy(h);
        allGood &&= good;
        table.push(`${listener.name}←${speaker.name} L ${db(h.L)} R ${db(h.R)} кадров ${h.frames}${good ? "" : " ✗"}`);
      }
    }
    t.check("все слышат всех в оба уха на нормальном уровне (12 пар)", allGood, allGood ? "" : table.join("; "));
    t.note(`уровни (среднее по кадрам с голосом): ${table.slice(0, 3).join("; ")} …`);
    const out = await boris.speakers(8000);
    t.check(
      "в колонках у Бориса звук в обоих каналах поровну",
      out.frames >= 40 && out.L > 0.005 && out.R > 0.005 && Math.abs(out.L - out.R) / Math.max(out.L, out.R) < 0.2,
      `L ${db(out.L)} R ${db(out.R)} кадров ${out.frames}`,
    );

    // Кольцо «говорит» у Анны глазами Бориса: в речи есть паузы — и горит, и гаснет.
    const ring = await boris.page.evaluate(
      async ({ id, ms }) => {
        const el = document.querySelector(`[data-testid="participant"][data-identity="${id}"]`);
        if (!el) return null;
        const seen = new Set([el.getAttribute("data-speaking")]);
        let flips = 0;
        const mo = new MutationObserver(() => {
          seen.add(el.getAttribute("data-speaking"));
          flips++;
        });
        mo.observe(el, { attributes: true, attributeFilter: ["data-speaking"] });
        await new Promise((r) => setTimeout(r, ms));
        mo.disconnect();
        return { seen: [...seen], flips };
      },
      { id: idA, ms: 8000 },
    );
    t.check(
      "кольцо «говорит» (data-speaking) включается и выключается",
      ring?.seen.includes("true") && ring?.seen.includes("false") && ring.flips >= 2,
      JSON.stringify(ring),
    );

    // M: Анна выключила микрофон — у Бориса от неё тишина.
    await anna.press("KeyM");
    t.check("M: на сервере микрофон Анны заглушён", await t.until(async () => (await micMuted(code, idA)) === true, 5000));
    await t.sleep(2000);
    const pressed = await anna.keyTime("KeyM");
    const last = await boris.lastLoud(idA, pressed - 1000, await boris.now());
    t.note(`M: звук Анны у Бориса затих через ${last === null ? "—" : Math.round(last - pressed)} мс после нажатия`);
    let h = await boris.hears(idA, 1000);
    t.check("M: Борис слышит от Анны тишину", silent(h), `макс ${db(h.max)}`);
    t.check(
      "M: у Бориса на месте Анны «микрофон выключен»",
      await t.until(async () => (await boris.seatLabel(idA)).includes("микрофон выключен"), 5000),
      await boris.seatLabel(idA),
    );
    t.check(
      "M: кнопка микрофона у Анны отжата",
      (await anna.page.locator('[data-testid="dock-mic"]').getAttribute("aria-pressed")) === "false",
    );
    await anna.press("KeyM");
    t.check("M ещё раз: микрофон снова в эфире", await t.until(async () => (await micMuted(code, idA)) === false, 5000));
    await t.sleep(3000);
    h = await boris.hears(idA, 3000);
    t.check("M ещё раз: Борис снова слышит Анну", h.frames >= 10 && h.max > 0.01, `кадров ${h.frames}, макс ${db(h.max)}`);

    // D: «Звук выкл» — свой микрофон заглушён, сам не слышит, у других значок.
    await anna.press("KeyD");
    t.check(
      "D: кнопка «Звук» нажата",
      await t.until(async () => (await anna.page.locator('[data-testid="dock-deafen"]').getAttribute("aria-pressed")) === "true"),
    );
    t.check("D: микрофон Анны заглушён на сервере", await t.until(async () => (await micMuted(code, idA)) === true, 5000));
    await t.sleep(1500);
    h = await boris.hears(idA, 1200);
    t.check("D: Борис от Анны слышит тишину", silent(h), `макс ${db(h.max)}`);
    const deaf = await anna.speakers(1200);
    t.check("D: у самой Анны в колонках тишина", deaf.max < 0.003, `макс ${db(deaf.max)}`);
    t.check(
      "D: у Бориса на месте Анны «звук выключен»",
      await t.until(async () => (await boris.seatLabel(idA)).includes("звук выключен"), 5000),
      await boris.seatLabel(idA),
    );
    await boris.shot("anna-deafened");
    await anna.press("KeyD");
    t.check("D ещё раз: микрофон вернулся", await t.until(async () => (await micMuted(code, idA)) === false, 5000));
    t.check(
      "D ещё раз: значок у Бориса пропал",
      await t.until(async () => !(await boris.seatLabel(idA)).includes("звук выключен"), 5000),
      await boris.seatLabel(idA),
    );
    await t.sleep(3000);
    const back = await anna.speakers(2500);
    t.check("D ещё раз: Анна снова слышит комнату", back.frames >= 10, `кадров ${back.frames}, макс ${db(back.max)}`);
  },
};

export default scenario;
