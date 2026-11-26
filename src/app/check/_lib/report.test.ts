import { describe, expect, it } from "vitest";
import { CHECK_VERSION } from "./constants";
import { EMPTY_MANUAL, buildReport, describeFile } from "./report";
import {
  allGood,
  deadFile,
  deadTurn,
  deadVoice,
  goodSite,
  goodTurn,
  goodWebRtc,
  noUdpWebRtc,
  okFile,
  skippedFile,
  stalledFile,
} from "./testkit";
import type { CheckResults, NetInfo } from "./types";
import { buildVerdict } from "./verdict";

const NET: NetInfo = {
  browser: "Chrome 141, Windows 10/11",
  language: "ru-RU",
  timeZone: "Europe/Moscow",
  connection: "4g · ~10 Мбит/с · RTT ~50 мс",
  online: true,
};
// 2026-10-01 11:35:12 UTC = 14:35:12 в Москве (offset −180).
const AT = new Date(Date.UTC(2026, 9, 1, 11, 35, 12));

function report(results: CheckResults, manual = EMPTY_MANUAL): string {
  return buildReport({
    results,
    verdict: buildVerdict(results),
    net: NET,
    at: AT,
    tzOffsetMinutes: -180,
    pageUrl: "https://game-room.space/check",
    manual,
  });
}

describe("describeFile", () => {
  it("замерзло: «получено 16 КБ из 300 КБ, потом тишина»", () => {
    expect(describeFile(stalledFile(2, 16 * 1024))).toBe("ЗАМЕРЗЛО: получено 16 КБ из 300 КБ, потом тишина 5 с");
  });

  it("замерзло без единого байта данных", () => {
    expect(describeFile(stalledFile(1, 0))).toMatch(/ни одного байта данных/);
  });

  it("ок: время ответа, всего и скорость", () => {
    expect(describeFile(okFile(0, { ttfbMs: 142, totalMs: 190 }))).toBe("ок, ответ за 142 мс, всего 190 мс, 84 КБ/с");
  });

  it("нет ответа, медленно, ошибки, пропуск", () => {
    expect(describeFile(deadFile(1))).toBe("НЕТ ОТВЕТА: за 10 с сервер не ответил");
    expect(describeFile(okFile(3, { status: "timeout", receivedBytes: 480 * 1024, totalMs: 10_000 }))).toBe(
      "МЕДЛЕННО: за 10 с получено 480 КБ из 1 МБ (48 КБ/с)",
    );
    expect(describeFile(okFile(0, { status: "error", receivedBytes: 0, httpStatus: 404 }))).toBe(
      "ОШИБКА: сайт ответил кодом 404",
    );
    expect(describeFile(okFile(2, { status: "error", receivedBytes: 20_000, httpStatus: 200 }))).toBe(
      "ОБРЫВ: сеть закрыла соединение, получено 20 КБ из 300 КБ",
    );
    expect(describeFile(skippedFile(3))).toMatch(/не проверялось/);
  });
});

describe("buildReport", () => {
  it("хороший результат: версия, время, три имени, сеть и строки для ручного ввода", () => {
    const text = report(allGood());
    expect(text).toContain("ПРОВЕРКА СВЯЗИ Game Room");
    expect(text).toContain(`Версия теста: ${CHECK_VERSION}`);
    expect(text).toContain("Дата и время: 2026-10-01 14:35:12 (UTC+03:00, Europe/Moscow)");
    expect(text).toContain("ИТОГ: ВСЁ ХОРОШО (зелёный)");
    expect(text).toContain("1. САЙТ game-room.space");
    expect(text).toContain("2. СЕРВЕР ГОЛОСА rtc.game-room.space");
    expect(text).toContain("3. TURN turn.game-room.space");
    expect(text).toContain("4. WEBRTC");
    expect(text).toContain("Коротко: сайт=ok rtc=ok turn=ok udp=ok");
    expect(text).toContain("Браузер: Chrome 141, Windows 10/11");
    expect(text).toContain("Часовой пояс: Europe/Moscow");
    expect(text).toContain("Соединение: 4g · ~10 Мбит/с · RTT ~50 мс");
    expect(text).toContain("Провайдер и город: ______ — впишите вручную");
    expect(text).toContain("Способ подключения (проводной интернет / Wi-Fi / мобильный): ______");
    expect(text).toContain("VPN или обход блокировок были включены (да / нет): ______");
  });

  it("замерзание после 16 КБ выглядит как «получено 16 КБ из 300 КБ, потом тишина»", () => {
    const site = goodSite();
    site.files[2] = stalledFile(2, 16 * 1024);
    site.files[3] = stalledFile(3, 16 * 1024);
    const text = report({ ...allGood(), site });
    expect(text).toContain("300 КБ: ЗАМЕРЗЛО: получено 16 КБ из 300 КБ, потом тишина 5 с");
    expect(text).toContain("1 МБ: ЗАМЕРЗЛО: получено 16 КБ из 1 МБ, потом тишина 5 с");
    expect(text).toContain("16 КБ: ок");
    expect(text).toContain("ИТОГ: НЕ РАБОТАЕТ (красный)");
  });

  it("каждое имя в отчёте имеет свой результат: сайт ок, rtc и turn молчат", () => {
    const text = report({ ...allGood(), voice: deadVoice(), turn: deadTurn() });
    expect(text).toMatch(/1\. САЙТ[^\n]*\n(  • [^\n]*\n){4}/);
    expect(text).toContain("HTTPS: НЕТ ОТВЕТА (таймаут)");
    expect(text).toContain("WebSocket (TLS): НЕТ ОТВЕТА (таймаут 8 с)");
    expect(text).toContain("TLS на 443 (turns:turn.game-room.space:443?transport=tcp): НЕТ ОТВЕТА, коды ошибок: 701");
  });

  it("TURN ответил: пишет код и что отказ без данных ожидаем", () => {
    const text = report(allGood());
    expect(text).toContain("сервер ответил за 240 мс, код 401 (отказ без настоящих данных: так и должно быть)");
    expect(text).toContain("WebSocket (TLS): сервер ответил отказом за 230 мс (без токена так и должно быть)");
  });

  it("relay честно помечен «не проверялось», а UDP-итог виден", () => {
    const text = report({ ...allGood(), webrtc: noUdpWebRtc() });
    expect(text).toContain("Кандидатов relay (TURN): не проверялось");
    expect(text).toContain("Кандидатов srflx (ответ STUN нашего сервера): 0 (UDP до нашего сервера не прошёл)");
    expect(text).toContain("Ошибки STUN: код 701 (stun:turn.game-room.space:3478)");
    expect(text).toContain("сбор остановлен по времени");
  });

  it("Firefox: TURN не проверялся, и это написано", () => {
    const text = report({ ...allGood(), turn: goodTurn({ status: "unsupported" }) });
    expect(text).toMatch(/не показывает ответы TURN/);
  });

  it("поля, которые человек заполнил, попадают в отчёт", () => {
    const text = report(allGood(), {
      provider: "  Ростелеком, Казань ",
      connection: "wifi",
      vpn: "no",
      note: "сайт грузился долго",
    });
    expect(text).toContain("Провайдер и город: Ростелеком, Казань");
    expect(text).not.toContain("Провайдер и город: ______");
    expect(text).toContain("Способ подключения (проводной интернет / Wi-Fi / мобильный): Wi-Fi");
    expect(text).toContain("были включены (да / нет): нет");
    expect(text).toContain("Что ещё заметили: сайт грузился долго");
  });

  it("не содержит IP-адресов", () => {
    const text = report({ ...allGood(), webrtc: goodWebRtc(), turn: noUdpTurnWithCodes() });
    expect(text).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    expect(text).not.toMatch(/\.local\b/);
  });

  it("версия теста в отчёте та же, что в константе", () => {
    expect(report(allGood())).toContain(CHECK_VERSION);
  });
});

function noUdpTurnWithCodes() {
  return deadTurn({ failCodes: [701, 701, 702] });
}
