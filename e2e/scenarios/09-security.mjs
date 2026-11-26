// 9. Заголовки и CSP. На прод-сборке (`next start`): CSP и Permissions-Policy на
// всех маршрутах, нет X-Powered-By, в CSP разрешён адрес LiveKit. В комнате с
// показом экрана — ни одного нарушения CSP, модуль шумодава (AudioWorklet) и wasm
// RNNoise загрузились, шумодав работает. На дев-сервере CSP нет — проверяется
// только загрузка шумодава.
import { waitSeats } from "../lib/person.mjs";

const scenario = {
  id: "csp",
  title: "Заголовки и CSP: нарушений нет, шумодав грузится",
  async run(t) {
    const { code, hostKey } = await t.room("e2e заголовки");
    const prod = !!(await fetch(`${t.base}/`)).headers.get("content-security-policy");
    if (!prod) t.note("CSP нет — похоже, это дев-сервер (заголовки только в production); проверяю загрузку шумодава");
    const routes = ["/", "/rooms", `/room/${code}`, "/no-such-page", `/api/rooms/${code}`, "/audio/voice-processor.js"];
    const missing = [];
    const powered = [];
    for (const route of routes) {
      const h = (await fetch(t.base + route)).headers;
      if (h.get("x-powered-by")) powered.push(route);
      if (prod && !(h.get("content-security-policy") && h.get("permissions-policy"))) missing.push(route);
    }
    t.check("нет X-Powered-By ни на одном маршруте", powered.length === 0, powered.join(", "));
    if (prod) t.check("CSP и Permissions-Policy на всех маршрутах", missing.length === 0, missing.join(", "));

    // Двое в комнате, у одного показ экрана, у другого сцена.
    const anna = await t.person("Анна", { code, hostKey });
    const boris = await t.person("Борис");
    const audioFiles = [];
    for (const p of [anna, boris]) {
      const cdp = await p.ctx.newCDPSession(p.page);
      await cdp.send("Network.enable");
      // Запросы ворклета Playwright на page не показывает — смотрим через CDP.
      cdp.on("Network.responseReceived", (e) => {
        if (e.response.url.includes("/audio/")) audioFiles.push(`${p.name} ${e.response.status} ${e.response.url.replace(t.base, "")}`);
      });
    }
    await anna.join(code);
    await boris.join(code);
    await waitSeats([anna, boris], 2);
    if (prod) {
      const csp = (await fetch(`${t.base}/room/${code}`)).headers.get("content-security-policy") ?? "";
      const lkOrigin = new URL(anna.joinInfo.serverUrl).origin;
      const connect = /connect-src ([^;]+)/.exec(csp)?.[1] ?? "";
      t.check("в CSP connect-src разрешён адрес LiveKit", connect.split(" ").includes(lkOrigin), `${lkOrigin} в «${connect}»`);
    }
    await boris.page.locator('[data-testid="dock-screen"]').click();
    t.check("показ экрана идёт под CSP", await t.until(async () => (await anna.page.locator('[data-testid="screen-stage"]').count()) === 1, 30000));
    await t.sleep(3000);

    for (const p of [anna, boris]) {
      const { csp, worklets } = await p.page.evaluate(() => ({ csp: window.__e2e.csp, worklets: window.__e2e.worklets }));
      t.check(`${p.name}: нарушений CSP нет`, csp.length === 0, csp.slice(0, 3).join(" | "));
      t.check(
        `${p.name}: модуль шумодава загружен (AudioWorklet.addModule)`,
        worklets.some((w) => w.startsWith("OK ") && w.includes("/audio/")) && !worklets.some((w) => w.startsWith("FAIL")),
        worklets.join(" | "),
      );
    }
    t.check(
      "wasm RNNoise отдан сервером (200)",
      audioFiles.some((f) => / 200 \/audio\/rnnoise(_simd)?\.wasm/.test(f) || / 304 \/audio\/rnnoise/.test(f)),
      [...new Set(audioFiles)].join(" | "),
    );
    const dialog = await anna.openSettings("Голос");
    t.check(
      "в настройках: шумодав работает",
      await t.until(async () => (await dialog.getByText("Убирает гул кулеров, клавиатуру и фон").count()) > 0, 10000),
    );
    await anna.closeSettings();
  },
};

export default scenario;
