// 10. Рисунок Румика виден другим (R4): у хоста в браузере уже лежит свой рисунок
// (gr.rumik.v1), он входит — сервер получает уменьшенную копию 286×240 и пишет
// её id в атрибут участника; гость видит у места хоста картинку /api/avatar/<id>,
// вошедшая позже — тоже. Стёр рисунок — атрибут снят. Нарисовал новый, сидя в
// комнате, — он уходит после затишья, а не на каждый штрих. Администрация
// запретила рисунки в комнате — новый не принят: один тост, атрибут снят (другие
// не видят прошлый рисунок), и своё место тоже без рисунка.
import { crc32, deflateSync } from "node:zlib";
import { waitSeats } from "../lib/person.mjs";
import { participant, redis } from "../lib/stand.mjs";

const RUMIK_KEY = "gr.rumik.v1";
const ATTRIBUTE = "avatar.id";

/** PNG руками: подпись, IHDR, IDAT, IEND с настоящими CRC. */
function pngFile(width, height, pixel) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const row = 1 + width * 4;
  const raw = Buffer.alloc(row * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * row + 1 + x * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Рисунок как из рисовалки: 572×480, яркие полосы (обрежет форма Румика). */
const STRIPES = [
  [255, 92, 92, 255],
  [255, 196, 0, 255],
  [56, 200, 120, 255],
  [70, 140, 255, 255],
];
/** Рисунок-полосы как из рисовалки; shift — другой рисунок. */
const stripes = (shift) =>
  `data:image/png;base64,${pngFile(572, 480, (x, y) => STRIPES[(Math.floor((x + y) / 48) + shift) % STRIPES.length]).toString("base64")}`;
const paint = stripes(0);
const store = JSON.stringify({ v: 1, paint, updatedAt: Date.now(), gallery: [] });

/**
 * Сменить свой рисунок «из соседней вкладки»: в этой вкладке хранилище читается
 * из памяти, событие storage приходит только соседним — шлём его сами.
 */
const setPaint = (page, next) =>
  page.evaluate(
    ({ key, next }) => {
      const s = JSON.parse(localStorage.getItem(key));
      const newValue = JSON.stringify({ ...s, paint: next, updatedAt: Date.now() });
      localStorage.setItem(key, newValue);
      // Хранилище берёт новое значение из самого события, как от настоящей соседней вкладки.
      window.dispatchEvent(new StorageEvent("storage", { key, newValue, storageArea: localStorage }));
    },
    { key: RUMIK_KEY, next },
  );

/** id рисунка у участника глазами сервера (Server SDK отдаёт ключи в camelCase). */
async function avatarIdOf(code, identity) {
  const p = await participant(code, identity);
  const a = p?.attributes ?? {};
  return a[ATTRIBUTE] ?? a.avatarId ?? null;
}

const scenario = {
  id: "avatar",
  title: "Рисунок Румика виден другим в комнате",
  async run(t) {
    const { code, hostKey } = await t.room("e2e рисунок");
    const anna = await t.person("Анна", { code, hostKey, prefs: { [RUMIK_KEY]: store } });
    const boris = await t.person("Борис");
    // Сколько раз хозяйка слала рисунок: после ответа сервер пишет атрибут, и
    // клиент успокаивается — по кругу не шлёт.
    const posts = [];
    anna.page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/api/avatar")) posts.push(Date.now());
    });
    await anna.join(code);
    await boris.join(code);
    await waitSeats([anna, boris], 2);
    const idA = await anna.identity();
    const idB = await boris.identity();

    let id = null;
    const t0 = Date.now();
    const got = await t.until(async () => (id = await avatarIdOf(code, idA)) !== null, 20000, 200);
    t.check("сервер записал id рисунка хозяйке в атрибут", got && /^[A-Za-z0-9_-]{16}$/.test(id ?? ""), `${id} за ${Date.now() - t0} мс`);
    t.check("у гостя без рисунка атрибута нет", (await avatarIdOf(code, idB)) === null);

    const res = await fetch(`${t.base}/api/avatar/${id}`);
    const body = Buffer.from(await res.arrayBuffer());
    t.check(
      "GET /api/avatar/<id> — PNG 286×240 с вечным личным кешем",
      res.status === 200 &&
        res.headers.get("content-type") === "image/png" &&
        res.headers.get("cache-control") === "private, max-age=31536000, immutable" &&
        body.readUInt32BE(16) === 286 &&
        body.readUInt32BE(20) === 240,
      `${res.status} · ${body.length} байт · ${body.length > 24 ? `${body.readUInt32BE(16)}×${body.readUInt32BE(20)}` : "—"}`,
    );
    t.note(`вес рисунка на сервере: ${(body.length / 1024).toFixed(1)} КБ`);

    // Стол из Румиков (R3) рисует рисунок картинкой у места. Пока его нет —
    // хватает проверок атрибута и GET выше.
    const seatImage = (p, who, prefix) => p.seat(who).locator(`image[href^="${prefix}"]`);
    const tableReady = await t.until(async () => (await boris.seat(idA).locator("svg image").count()) > 0, 15000, 250);
    if (tableReady) {
      t.check(
        "гость видит у места хозяйки её рисунок с /api/avatar/",
        await t.until(async () => (await seatImage(boris, idA, `/api/avatar/${id}`).count()) > 0, 10000),
      );
      t.check("хозяйка видит свой рисунок сразу из браузера", (await seatImage(anna, idA, "data:image/png").count()) > 0);
      await boris.shot("guest-sees-host-paint");
      const vika = await t.person("Вика", { viewport: { width: 390, height: 844 } });
      await vika.join(code);
      t.check(
        "вошедшая позже сразу видит рисунок хозяйки",
        await t.until(async () => (await seatImage(vika, idA, `/api/avatar/${id}`).count()) > 0, 15000),
      );
      await vika.shot("late-joiner-390");
    } else {
      t.note("стол из Румиков ещё не рисует картинки у мест — проверены атрибут и GET");
      await boris.shot("guest-room");
    }

    await t.sleep(3000);
    t.check("рисунок ушёл на сервер один раз, повторов нет", posts.length === 1, `запросов: ${posts.length}`);

    // Стёрла рисунок — атрибут снят у всех, без затишья.
    const erasedAt = Date.now();
    await setPaint(anna.page, null);
    t.check(
      "стёрла рисунок — атрибут снят",
      await t.until(async () => (await avatarIdOf(code, idA)) === null, 20000, 250),
      `за ${Date.now() - erasedAt} мс`,
    );
    await t.sleep(3000);
    t.check("снятие — ещё один запрос, и всё", posts.length === 2, `запросов: ${posts.length}`);

    // Нарисовала новый, сидя в комнате: уходит после затишья, а не сразу.
    const drawnAt = Date.now();
    await setPaint(anna.page, stripes(1));
    await t.sleep(10000);
    t.check("новый рисунок в комнате не уходит, пока не стихло (10 с)", posts.length === 2, `запросов: ${posts.length}`);
    let idNew = null;
    const gotNew = await t.until(async () => (idNew = await avatarIdOf(code, idA)) !== null, 20000, 250);
    t.check(
      "после затишья новый рисунок ушёл одним запросом",
      gotNew && idNew !== id && posts.length === 3 && posts[2] - drawnAt >= 14000,
      `${idNew} · запросов: ${posts.length} · через ${posts[2] ? posts[2] - drawnAt : "—"} мс`,
    );

    // Администрация запретила Анне рисунки в комнате (как «Сбросить рисунок» в
    // админке, но атрибут не трогаем): следующий рисунок сервер не примет.
    await redis(["SET", `gr:avatarban:${code}:${idA}`, JSON.stringify({ reason: "test", at: new Date().toISOString() }), "EX", "600"]);
    await setPaint(anna.page, stripes(2));
    const toast = anna.page.getByText("Администрация скрыла ваши рисунки в этой комнате");
    t.check("отказ — тост с текстом сервера", await t.until(async () => (await toast.count()) > 0, 30000, 250));
    t.check("тост один, не стопка", (await toast.count()) === 1, `тостов: ${await toast.count()}`);
    await anna.shot("blocked-toast");
    t.check(
      "после отказа атрибут снят: прошлый рисунок другие больше не видят",
      await t.until(async () => (await avatarIdOf(code, idA)) === null, 15000, 250),
    );
    t.check(
      "своё место тоже без рисунка (не рисунок из браузера)",
      await t.until(async () => (await anna.seat(idA).locator("svg image").count()) === 0, 10000, 250),
    );
    await anna.shot("after-refusal");
    if (tableReady) {
      t.check(
        "гость не видит у места хозяйки ни нового, ни прошлого рисунка",
        await t.until(async () => (await boris.seat(idA).locator("svg image").count()) === 0, 10000, 250),
      );
    }
    await t.sleep(5000);
    t.check(
      "отказ: рисунок и png: null — два запроса, по кругу не шлёт",
      posts.length === 5,
      `запросов: ${posts.length}`,
    );
    await redis(["DEL", `gr:avatarban:${code}:${idA}`]);

    const errors = [...anna.realErrors(), ...boris.realErrors()];
    t.check("без ошибок в консоли", errors.length === 0, errors.slice(0, 3).join(" | "));
  },
};

export default scenario;
