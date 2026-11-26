import { describe, expect, it } from "vitest";
import { TEST_FILES } from "./constants";
import type { CheckResults } from "./types";
import { analyzeSite, analyzeTurn, buildVerdict } from "./verdict";
import {
  allGood,
  deadFile,
  deadTurn,
  deadVoice,
  goodSite,
  goodTurn,
  goodVoice,
  goodWebRtc,
  noUdpWebRtc,
  okFile,
  skippedFile,
  stalledFile,
} from "./testkit";

function results(over: Partial<CheckResults>): CheckResults {
  return { ...allGood(), ...over };
}

describe("analyzeSite", () => {
  it("все файлы пришли быстро: ok", () => {
    expect(analyzeSite(goodSite()).state).toBe("ok");
  });

  it("долгий ответ сервера: slow", () => {
    const site = goodSite();
    site.files[0] = okFile(0, { ttfbMs: 4_200 });
    expect(analyzeSite(site).state).toBe("slow");
  });

  it("1 МБ скачался, но медленнее 150 КБ/с: slow", () => {
    const site = goodSite();
    site.files[3] = okFile(3, { totalMs: 9_000 });
    expect(analyzeSite(site).state).toBe("slow");
  });

  it("замерзание после 16 КБ на файле 300 КБ: frozen", () => {
    const site = goodSite();
    site.files[2] = stalledFile(2, 16 * 1024);
    site.files[3] = stalledFile(3, 16 * 1024);
    const a = analyzeSite(site);
    expect(a.state).toBe("frozen");
    expect(a.frozenAfterBytes).toBe(16 * 1024);
    expect(a.largestOkBytes).toBe(TEST_FILES[1].bytes);
  });

  it("обрыв соединения посреди файла (код 200, байты были): тоже frozen", () => {
    const site = goodSite();
    site.files[2] = okFile(2, { status: "error", receivedBytes: 20_000, httpStatus: 200 });
    expect(analyzeSite(site).state).toBe("frozen");
  });

  it("после маленьких файлов крупный не дал ни байта: frozen без порога", () => {
    const site = goodSite();
    site.files[1] = deadFile(1);
    site.files[2] = deadFile(2);
    site.files[3] = deadFile(3);
    const a = analyzeSite(site);
    expect(a.state).toBe("frozen");
    expect(a.frozenAfterBytes).toBeNull();
    expect(a.largestOkBytes).toBe(TEST_FILES[0].bytes);
  });

  it("ни одного байта ни на одном файле: down", () => {
    const site = goodSite();
    site.files = [deadFile(0), deadFile(1), skippedFile(2), skippedFile(3)];
    expect(analyzeSite(site).state).toBe("down");
  });

  it("сайт ответил 404 на все файлы: http-error с кодом", () => {
    const site = goodSite();
    site.files = TEST_FILES.map((_, i) =>
      okFile(i, { status: "error", receivedBytes: 0, httpStatus: 404, totalMs: 80 }),
    );
    const a = analyzeSite(site);
    expect(a.state).toBe("http-error");
    expect(a.httpStatus).toBe(404);
  });

  it("всё пропущено: incomplete", () => {
    const site = goodSite();
    site.files = TEST_FILES.map((_, i) => skippedFile(i));
    expect(analyzeSite(site).state).toBe("incomplete");
  });

  it("таймаут при живом потоке на 1 МБ: slow", () => {
    const site = goodSite();
    site.files[3] = okFile(3, { status: "timeout", receivedBytes: 400_000, totalMs: 10_000 });
    expect(analyzeSite(site).state).toBe("slow");
  });
});

describe("analyzeTurn", () => {
  it("нет имени, браузер без поддержки и ошибка дают unknown", () => {
    expect(analyzeTurn(goodTurn({ status: "skipped" }))).toBe("unknown");
    expect(analyzeTurn(goodTurn({ status: "unsupported" }))).toBe("unknown");
    expect(analyzeTurn(goodTurn({ status: "error" }))).toBe("unknown");
  });
});

describe("buildVerdict: светофор", () => {
  it("всё хорошо: зелёный, 2–3 строки, оговорка про живой голос", () => {
    const v = buildVerdict(allGood());
    expect(v.level).toBe("good");
    expect(v.title).toBe("Всё хорошо");
    expect(v.lines.length).toBeGreaterThanOrEqual(2);
    expect(v.lines.length).toBeLessThanOrEqual(3);
    expect(v.lines.join(" ")).toMatch(/не проверяет голос вживую/);
    expect(v.summary).toBe("сайт=ok rtc=ok turn=ok udp=ok");
  });

  it("замерзание сайта после 16 КБ: красный, называет порог и провайдера", () => {
    const site = goodSite();
    site.files[2] = stalledFile(2, 16 * 1024);
    site.files[3] = stalledFile(3, 16 * 1024);
    const v = buildVerdict(results({ site }));
    expect(v.level).toBe("bad");
    expect(v.title).toBe("Не работает");
    expect(v.lines[0]).toMatch(/замирает примерно после 16 КБ/);
    expect(v.lines.join(" ")).toMatch(/провайдер/);
    expect(v.summary).toMatch(/^сайт=frozen /);
  });

  it("сайт открылся, а голосовой сервер не отвечает: красный, про провайдера и серверы за рубежом", () => {
    const v = buildVerdict(results({ voice: deadVoice() }));
    expect(v.level).toBe("bad");
    expect(v.lines[0]).toBe("Сайт открылся, но голосовой сервер rtc.game-room.space не отвечает.");
    expect(v.lines[1]).toMatch(/провайдер ограничивает связь с серверами за рубежом/);
    expect(v.lines.length).toBeLessThanOrEqual(3);
  });

  it("«сайт не открылся вообще» и «сайт открылся, а rtc не отвечает» это разные строки итога", () => {
    const down = goodSite();
    down.files = [deadFile(0), deadFile(1), skippedFile(2), skippedFile(3)];
    const siteDown = buildVerdict(results({ site: down, voice: deadVoice(), turn: deadTurn() }));
    const rtcDown = buildVerdict(results({ voice: deadVoice() }));
    expect(siteDown.lines[0]).toMatch(/не открылся вообще/);
    expect(rtcDown.lines[0]).not.toMatch(/не открылся вообще/);
    expect(siteDown.lines[0]).not.toBe(rtcDown.lines[0]);
    expect(siteDown.summary).toMatch(/^сайт=нет rtc=нет turn=нет /);
  });

  it("сайт не открылся, но rtc и turn отвечают: красный, другая причина", () => {
    const site = goodSite();
    site.files = [deadFile(0), deadFile(1), skippedFile(2), skippedFile(3)];
    const v = buildVerdict(results({ site }));
    expect(v.level).toBe("bad");
    expect(v.lines[0]).toMatch(/не открылся вообще/);
    expect(v.lines[1]).toMatch(/именно к имени сайта/);
  });

  it("rtc молчит и turn молчит: в третьей строке сказано про TURN", () => {
    const v = buildVerdict(results({ voice: deadVoice(), turn: deadTurn() }));
    expect(v.lines[2]).toMatch(/TURN \(turn\.game-room\.space\) тоже не отвечает/);
  });

  it("rtc молчит, а turn отвечает: объясняем, что в комнату заходят через rtc", () => {
    const v = buildVerdict(results({ voice: deadVoice() }));
    expect(v.lines[2]).toMatch(/в комнату заходят через rtc\.game-room\.space/);
  });

  it("turn молчит при рабочих сайте, rtc и UDP: жёлтый", () => {
    const v = buildVerdict(results({ turn: deadTurn() }));
    expect(v.level).toBe("warn");
    expect(v.lines[0]).toMatch(/запасной канал TURN \(turn\.game-room\.space\) не отвечает/);
  });

  it("turn молчит и UDP не проходит: красный", () => {
    const v = buildVerdict(results({ turn: deadTurn(), webrtc: noUdpWebRtc() }));
    expect(v.level).toBe("bad");
    expect(v.lines[0]).toMatch(/прямой UDP до сервера не проходит/);
  });

  it("UDP не проходит, а TURN отвечает: жёлтый, голос пойдёт через TURN", () => {
    const v = buildVerdict(results({ webrtc: noUdpWebRtc() }));
    expect(v.level).toBe("warn");
    expect(v.lines[0]).toMatch(/через TURN по TLS/);
  });

  it("UDP не проходит, а TURN проверить нечем: жёлтый, без обещаний", () => {
    const v = buildVerdict(results({ webrtc: noUdpWebRtc(), turn: goodTurn({ status: "unsupported" }) }));
    expect(v.level).toBe("warn");
    expect(v.lines[0]).toMatch(/проверить не удалось/);
  });

  it("сайт ответил ошибкой 404: жёлтый, «наша поломка»", () => {
    const site = goodSite();
    site.files = TEST_FILES.map((_, i) => okFile(i, { status: "error", receivedBytes: 0, httpStatus: 404 }));
    const v = buildVerdict(results({ site }));
    expect(v.level).toBe("warn");
    expect(v.lines[0]).toMatch(/код 404/);
    expect(v.lines[0]).toMatch(/наш[уе]? поломк/);
  });

  it("медленный сайт: жёлтый", () => {
    const site = goodSite();
    site.files[3] = okFile(3, { totalMs: 9_000 });
    expect(buildVerdict(results({ site })).level).toBe("warn");
  });

  it("браузер без WebRTC: жёлтый, советует Chrome или Edge", () => {
    const v = buildVerdict(results({ webrtc: goodWebRtc({ status: "unsupported" }) }));
    expect(v.level).toBe("warn");
    expect(v.lines.join(" ")).toMatch(/Chrome или Edge/);
  });

  it("адрес голоса не задан: жёлтый, голос не проверялся", () => {
    const v = buildVerdict(
      results({
        voice: goodVoice({ status: "skipped", url: null, host: null, https: null, ws: null }),
        turn: goodTurn({ status: "skipped", host: null, url: null, code: null, ms: null }),
        webrtc: goodWebRtc({ status: "skipped" }),
      }),
    );
    expect(v.level).toBe("warn");
    expect(v.lines.join(" ")).toMatch(/голос не проверялся/);
  });

  it("TURN этим браузером не проверить, остальное хорошо: зелёный с пометкой", () => {
    const v = buildVerdict(results({ turn: goodTurn({ status: "unsupported" }) }));
    expect(v.level).toBe("good");
    expect(v.lines.join(" ")).toMatch(/Chrome или Edge/);
    expect(v.lines.length).toBeLessThanOrEqual(3);
  });

  it("любой итог укладывается в 2–3 строки и называет заголовок по уровню", () => {
    const frozen = goodSite();
    frozen.files[2] = stalledFile(2);
    const down = goodSite();
    down.files = [deadFile(0), deadFile(1), skippedFile(2), skippedFile(3)];
    const cases: CheckResults[] = [
      allGood(),
      results({ site: frozen }),
      results({ site: down, voice: deadVoice(), turn: deadTurn(), webrtc: noUdpWebRtc() }),
      results({ voice: deadVoice() }),
      results({ turn: deadTurn() }),
      results({ webrtc: noUdpWebRtc() }),
    ];
    for (const c of cases) {
      const v = buildVerdict(c);
      expect(v.lines.length).toBeGreaterThanOrEqual(2);
      expect(v.lines.length).toBeLessThanOrEqual(3);
      expect(v.title).toBe({ good: "Всё хорошо", warn: "Есть проблемы", bad: "Не работает" }[v.level]);
    }
  });
});
