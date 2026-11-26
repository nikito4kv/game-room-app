// 12. Соундборд и звук входа (флаги soundboard, soundboard_upload): Анна входит
// со своим звуком входа — у Бориса над её местом значок звука, а в атрибутах её
// участника лежит sound.enter. Кнопка «Звуки» в доке открывает панель с
// подписанными кнопками (отдельно от реакций). Анна жмёт «Ба-дум-тсс» — у Бориса
// значок над местом Анны, звук в колонках и фраза для скринридера. Борис
// выключает «Слышать звуки других» — значок есть, в колонках тишина. Свой звук:
// Анна добавляет файл — у Бориса он появляется на панели, играет у обоих, Анна
// его убирает. Очередь режет клиент (тост), флуд — сервер.
// Флаги по умолчанию выключены: сценарий включает их (withFlags) и возвращает как было.
import { waitSeats } from "../lib/person.mjs";
import { api, participant, withFlags } from "../lib/stand.mjs";

const db = (v) => (v > 0 ? `${(20 * Math.log10(v)).toFixed(1)} дБ` : "−∞");

/** WAV 8 кГц, моно, 16 бит: 0,4 с тона 440 Гц — звук, который Chrome точно прочтёт. */
function bonkWav() {
  const rate = 8000;
  const n = Math.floor(rate * 0.4);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0, "latin1");
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8, "latin1");
  buf.write("fmt ", 12, "latin1");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "latin1");
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 16000), 44 + i * 2);
  return buf;
}

const scenario = {
  id: "soundboard",
  title: "Соундборд: панель «Звуки», звук входа, «звуки других», свой звук и флуд",
  run: (t) => withFlags(t, { soundboard: true, soundboard_upload: true }, () => run(t)),
};

async function run(t) {
  const { code, hostKey } = await t.room("e2e соундборд");
  // Звуки событий у Бориса включены: звук входа Анны играет вместо обычного «вошёл».
  const boris = await t.person("Борис", { prefs: { "gr.sfx.enabled": "1" } });
  const anna = await t.person("Анна", { code, hostKey, prefs: { "gr.board.enter": "tada" } });
  await boris.join(code);
  await anna.join(code);
  const annaId = await anna.identity();
  const bubble = (p, identity) => p.seat(identity).locator('[data-reaction="sound"]');

  // Звук входа: в атрибутах токена и значком над вошедшей.
  t.check(
    "у Бориса над Анной всплыл значок звука — её звук входа",
    await t.until(async () => (await bubble(boris, annaId).count()) === 1, 8000, 50),
  );
  // livekit-server-sdk отдаёт ключи атрибутов в camelCase (DECISIONS п.12).
  const attrs = (await participant(code, annaId))?.attributes ?? {};
  t.check(
    "звук входа лежит в атрибутах Анны (sound.enter)",
    (attrs["sound.enter"] ?? attrs.soundEnter) === "tada",
    attrs,
  );
  await waitSeats([anna, boris], 2);

  // Микрофоны выключены: в колонках Бориса должен быть только звук соундборда.
  for (const p of [anna, boris]) await p.page.locator('[data-testid="dock-mic"]').click();
  await t.sleep(1500);
  const quiet = await boris.speakers(800);
  t.check("при выключенных микрофонах в колонках Бориса тихо", quiet.max < 0.003, `max ${db(quiet.max)}`);

  const panel = (p) => p.page.locator('[data-testid="sounds-popover"]');
  const openPanel = async (p) => {
    if (!(await panel(p).isVisible())) await p.page.locator('[data-testid="dock-sounds"]').click();
    await panel(p).waitFor({ state: "visible", timeout: 5000 });
  };
  t.check(
    "в доке «Звуки» отдельно от «Реакции»",
    (await anna.page.locator('[data-testid="dock-sounds"]').count()) === 1 &&
      (await anna.page.locator('[data-testid="dock-reactions"]').count()) === 1,
  );
  await openPanel(anna);
  t.check(
    "панель: восемь подписанных звуков",
    await t.until(async () => (await panel(anna).locator('ul[aria-label="Звуки"] > li').count()) === 8, 5000),
  );
  t.check(
    "кнопка подписана названием, а не значком",
    ((await panel(anna).locator('[data-testid="sound-rimshot"]').textContent()) ?? "").includes("Ба-дум-тсс"),
  );

  await panel(anna).locator('[data-testid="sound-rimshot"]').click();
  const clickedAt = Date.now();
  t.check(
    "у Анны значок над своим местом сразу",
    await t.until(async () => (await bubble(anna, annaId).count()) === 1, 1000, 50),
  );
  t.check(
    "у Бориса значок над местом Анны",
    await t.until(async () => (await bubble(boris, annaId).count()) === 1, 5000, 50),
  );
  t.note(`звук дошёл до Бориса за ${Date.now() - clickedAt} мс`);
  await t.sleep(900);
  const loud = await boris.speakers(1000);
  t.check("…и звучит в его колонках", loud.max > 0.02, `max ${db(loud.max)}`);
  const live = boris.page.locator('[data-testid="reactions-live"]');
  t.check(
    "скринридер Бориса: «Анна: Ба-дум-тсс»",
    await t.until(async () => (await live.textContent())?.includes("Анна: Ба-дум-тсс"), 3000, 50),
    await live.textContent(),
  );
  await boris.shot("rimshot-at-anna");

  // Борис выключил звуки других: значок есть, звука нет.
  await t.sleep(2500);
  await openPanel(boris);
  await boris.page.locator('[data-testid="sound-others"]').click();
  await boris.page.keyboard.press("Escape");
  await panel(anna).locator('[data-testid="sound-horn"]').click();
  t.check(
    "звуки других выключены — значок над Анной всё равно виден",
    await t.until(async () => (await bubble(boris, annaId).count()) === 1, 5000, 50),
  );
  await t.sleep(700);
  const muted = await boris.speakers(800);
  t.check("…а в колонках Бориса тихо", muted.max < 0.003, `max ${db(muted.max)}`);
  await openPanel(boris);
  await boris.page.locator('[data-testid="sound-others"]').click();
  await boris.page.keyboard.press("Escape");

  // Свой звук: Анна добавляет файл — он появляется у Бориса.
  await anna.page
    .locator('[data-testid="sound-file"]')
    .setInputFiles({ name: "бонк_гонг.wav", mimeType: "audio/wav", buffer: bonkWav() });
  const pending = anna.page.locator('[data-testid="sound-pending"]');
  t.check(
    "после выбора файла — название на кнопке из имени файла",
    await t.until(async () => pending.isVisible(), 5000),
  );
  t.check(
    "…«бонк гонг» (подчёркивания убраны)",
    (await anna.page.locator('[data-testid="sound-name"]').inputValue()) === "бонк гонг",
  );
  await anna.page.locator('[data-testid="sound-name"]').fill("Бонк");
  await anna.page.locator('[data-testid="sound-add-confirm"]').click();
  const bonkButton = (p) => p.page.getByRole("button", { name: "Бонк", exact: true });
  t.check(
    "у Анны свой звук на панели",
    await t.until(async () => (await panel(anna).locator('ul[aria-label="Звуки"] > li').count()) === 9, 8000),
  );
  await openPanel(boris);
  t.check(
    "у Бориса он появился сам (сервер оповестил комнату)",
    await t.until(async () => (await bonkButton(boris).count()) === 1, 8000),
  );
  t.check(
    "убрать его может добавившая, а Борис — нет",
    (await panel(anna).locator('[data-testid^="sound-remove-"]').count()) === 1 &&
      (await panel(boris).locator('[data-testid^="sound-remove-"]').count()) === 0,
  );
  // Свой звук играет у всех (файл скачивается с сервера и декодируется).
  await bonkButton(boris).click();
  t.check(
    "Борис нажал чужой звук — значок у Анны",
    await t.until(
      async () => {
        const id = await boris.identity();
        return (await bubble(anna, id).count()) === 1;
      },
      8000,
      100,
    ),
  );
  await boris.page.keyboard.press("Escape");
  // Убрать: пропадает у обоих.
  await panel(anna).locator('[data-testid^="sound-remove-"]').click();
  t.check(
    "Анна убрала свой звук — у Бориса его больше нет",
    await t.until(
      async () => {
        await openPanel(boris);
        return (await bonkButton(boris).count()) === 0;
      },
      8000,
      300,
    ),
  );

  // Не аудио и слишком большое сервер отвергает.
  const junk = await api(t.base, "POST", "/api/sounds", {
    code,
    token: anna.token,
    name: "Мусор",
    data: Buffer.from("<html><script>alert(1)</script></html>".padEnd(64, " ")).toString("base64"),
  });
  t.check("не аудио — SOUND_INVALID", junk.status === 400 && junk.body?.error?.code === "SOUND_INVALID", junk.status);
  const fake = await api(t.base, "POST", "/api/sounds", { code, token: "подделка", name: "x", data: "AAAA" });
  t.check("чужой токен — UNAUTHORIZED", fake.body?.error?.code === "UNAUTHORIZED", fake.status);

  // Окно лимита пустое — три звука подряд проходят, четвёртый — тост, без запроса.
  await t.sleep(10_500);
  let posts = 0;
  const count = (req) => {
    if (req.url().endsWith("/api/sound") && req.method() === "POST") posts++;
  };
  anna.page.on("request", count);
  await openPanel(anna);
  for (const id of ["correct", "wrong", "applause", "tada"]) {
    await panel(anna).locator(`[data-testid="sound-${id}"]`).click({ timeout: 3000 });
  }
  t.check(
    "четвёртый звук за 10 с — тост «Слишком часто», на сервер не ушёл",
    await t.until(async () => (await anna.page.getByText(/^Слишком часто/).count()) > 0, 2000),
    `запросов: ${posts}`,
  );
  t.check("…запросов ровно три", posts === 3, posts);
  anna.page.off("request", count);

  // В обход клиента: свой лимит и мусор.
  const results = [];
  for (let i = 0; i < 8; i++) {
    results.push(await api(t.base, "POST", "/api/sound", { code, token: boris.token, sound: "crickets" }));
  }
  const limited = results.filter((r) => r.status === 429 && r.body?.error?.code === "RATE_LIMITED");
  t.check("флуд в обход клиента — RATE_LIMITED", limited.length > 0, `429: ${limited.length} из ${results.length}`);
  const bad = await api(t.base, "POST", "/api/sound", { code, token: anna.token, sound: "AIR HORN" });
  t.check(
    "имя неверного вида — BAD_REQUEST",
    bad.status === 400 && bad.body?.error?.code === "BAD_REQUEST",
    bad.status,
  );
}

export default scenario;
