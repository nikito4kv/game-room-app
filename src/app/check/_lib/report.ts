import { CHECK_VERSION } from "./constants";
import { formatBytes, formatMoment, formatMs, formatSpeed } from "./format";
import type {
  CheckResults,
  FileResult,
  ManualFields,
  NetInfo,
  TurnResult,
  Verdict,
  VoiceResult,
  WebRtcResult,
} from "./types";

// Текст отчёта, который человек копирует и присылает. Чистая функция: на входе
// результаты, время и сведения о браузере, на выходе строка. Адреса (IP) в отчёт
// не попадают: тип кандидата и счётчики, но не сами адреса.

export const EMPTY_MANUAL: ManualFields = { provider: "", connection: "", vpn: "", note: "" };

const BLANK = "______";

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** Одна строка про файл: «ЗАМЕРЗЛО: получено 16 КБ из 300 КБ, потом тишина 5 с». */
export function describeFile(f: FileResult): string {
  const got = `${formatBytes(f.receivedBytes)} из ${formatBytes(f.expectedBytes)}`;
  switch (f.status) {
    case "ok": {
      const parts = [
        "ок",
        f.ttfbMs !== null ? `ответ за ${formatMs(f.ttfbMs)}` : null,
        `всего ${formatMs(f.totalMs)}`,
        formatSpeed(f.receivedBytes, f.totalMs),
      ];
      return parts.filter((p): p is string => p !== null).join(", ");
    }
    case "stalled": {
      const silence = f.silenceMs !== null ? ` ${formatMs(f.silenceMs)}` : "";
      if (f.receivedBytes === 0) return `ЗАМЕРЗЛО: сервер ответил, но ни одного байта данных не пришло, тишина${silence}`;
      return `ЗАМЕРЗЛО: получено ${got}, потом тишина${silence}`;
    }
    case "timeout": {
      if (f.ttfbMs === null) return `НЕТ ОТВЕТА: за ${formatMs(f.totalMs)} сервер не ответил`;
      const speed = formatSpeed(f.receivedBytes, f.totalMs);
      return `МЕДЛЕННО: за ${formatMs(f.totalMs)} получено ${got}${speed ? ` (${speed})` : ""}`;
    }
    case "error":
      if (f.httpStatus !== null && f.httpStatus >= 400) return `ОШИБКА: сайт ответил кодом ${f.httpStatus}`;
      if (f.receivedBytes > 0) return `ОБРЫВ: сеть закрыла соединение, получено ${got}`;
      return "ОШИБКА: соединение не удалось (сеть закрыла его или нет связи)";
    case "skipped":
      return "не проверялось (сайт перед этим не отвечал)";
  }
}

function describeVoice(v: VoiceResult): string[] {
  if (v.status === "skipped" || !v.url) {
    return ["Адрес сервера голоса в этой сборке сайта не задан: не проверялось."];
  }
  const lines: string[] = [];
  if (v.https) {
    lines.push(
      v.https.ok
        ? `HTTPS: сервер ответил за ${formatMs(v.https.ms ?? 0)}`
        : v.https.error === "timeout"
          ? "HTTPS: НЕТ ОТВЕТА (таймаут)"
          : "HTTPS: ОШИБКА (соединение не удалось)",
    );
  }
  if (v.ws) {
    const t = formatMs(v.ws.ms);
    const name = v.url?.startsWith("wss:") ? "WebSocket (TLS)" : "WebSocket";
    if (v.ws.outcome === "open") lines.push(`${name}: рукопожатие прошло за ${t}`);
    else if (v.ws.outcome === "timeout") lines.push(`${name}: НЕТ ОТВЕТА (таймаут ${t})`);
    else if (v.https?.ok) lines.push(`${name}: сервер ответил отказом за ${t} (без токена так и должно быть)`);
    else lines.push(`${name}: ОШИБКА за ${t}`);
  }
  return lines;
}

function describeTurn(t: TurnResult): string[] {
  switch (t.status) {
    case "skipped":
      return ["Имя TURN в этой сборке не задано и не выводится из адреса голоса: не проверялось."];
    case "unsupported":
      return ["Этот браузер не показывает ответы TURN (так делает Firefox): не проверялось. Для проверки нужен Chrome или Edge."];
    case "error":
      return ["Не удалось выполнить проверку (ошибка браузера)."];
    case "reachable":
      return [
        `TLS на 443 (${t.url}): сервер ответил${t.ms !== null ? ` за ${formatMs(t.ms)}` : ""}${
          t.code !== null ? `, код ${t.code}` : ""
        } (отказ без настоящих данных: так и должно быть)`,
      ];
    case "unreachable": {
      const codes = t.failCodes.length > 0 ? `, коды ошибок: ${[...new Set(t.failCodes)].join(", ")}` : "";
      return [`TLS на 443 (${t.url}): НЕТ ОТВЕТА${codes}`];
    }
  }
}

function describeWebRtc(w: WebRtcResult): string[] {
  switch (w.status) {
    case "unsupported":
      return ["Браузер не поддерживает WebRTC: не проверялось."];
    case "skipped":
      return ["Адрес нашего сервера не задан: не проверялось."];
    case "error":
      return ["Не удалось выполнить проверку (ошибка браузера)."];
    default:
      break;
  }
  const lines: string[] = [];
  const firstAt = (ms: number | null) => (ms !== null ? `, первый через ${formatMs(ms)}` : "");
  lines.push(`Кандидатов host (ваше устройство): ${w.host}${w.host > 0 ? firstAt(w.firstHostMs) : ""}`);
  lines.push(
    `Кандидатов srflx (ответ STUN нашего сервера): ${w.srflx}${
      w.srflx > 0 ? firstAt(w.firstSrflxMs) : " (UDP до нашего сервера не прошёл)"
    }`,
  );
  lines.push("Кандидатов relay (TURN): не проверялось (для TURN нужны одноразовые данные из комнаты)");
  const tail = w.completed ? "сбор закончился сам" : "сбор остановлен по времени";
  lines.push(`Сбор: ${w.doneMs !== null ? formatMs(w.doneMs) : "?"}, ${tail}`);
  if (w.errors.length > 0) {
    const uniq = [...new Set(w.errors.map((e) => `код ${e.code} (${e.url})`))];
    lines.push(`Ошибки STUN: ${uniq.join("; ")}`);
  }
  return lines;
}

const CONNECTION_LABEL: Record<ManualFields["connection"], string> = {
  "": BLANK,
  wired: "проводной интернет",
  wifi: "Wi-Fi",
  mobile: "мобильный",
};

const LEVEL_UPPER: Record<Verdict["level"], string> = {
  good: "ВСЁ ХОРОШО (зелёный)",
  warn: "ЕСТЬ ПРОБЛЕМЫ (жёлтый)",
  bad: "НЕ РАБОТАЕТ (красный)",
};

export type ReportInput = {
  results: CheckResults;
  verdict: Verdict;
  net: NetInfo;
  /** Когда проверка закончилась. */
  at: Date;
  /** Date.getTimezoneOffset() на момент проверки. */
  tzOffsetMinutes: number;
  /** Адрес страницы, где шла проверка. */
  pageUrl: string;
  manual?: ManualFields;
};

/** Собирает текст отчёта целиком. */
export function buildReport(input: ReportInput): string {
  const { results, verdict, net } = input;
  const manual = input.manual ?? EMPTY_MANUAL;
  const out: string[] = [];
  const add = (s = "") => out.push(s);
  const bullet = (s: string) => out.push(`  • ${s}`);

  add("ПРОВЕРКА СВЯЗИ Game Room");
  add(`Версия теста: ${CHECK_VERSION}`);
  add(`Дата и время: ${formatMoment(input.at, input.tzOffsetMinutes, net.timeZone)}`);
  add(`Страница: ${input.pageUrl}`);
  add();
  add(`ИТОГ: ${LEVEL_UPPER[verdict.level]}`);
  for (const line of verdict.lines) add(line);
  add(`Коротко: ${verdict.summary}`);
  add();

  add(`1. САЙТ ${hostOf(results.site.origin)} (скачивание тестовых файлов)`);
  for (const f of results.site.files) bullet(`${f.label}: ${describeFile(f)}`);
  add();

  add(`2. СЕРВЕР ГОЛОСА ${results.voice.host ?? "(адрес не задан)"} (HTTPS и WebSocket)`);
  for (const l of describeVoice(results.voice)) bullet(l);
  add();

  add(`3. TURN ${results.turn.host ?? "(имя не задано)"} (запасной канал, TLS на 443)`);
  for (const l of describeTurn(results.turn)) bullet(l);
  add();

  add(
    `4. WEBRTC, UDP до нашего сервера (STUN${results.webrtc.stunUrls.length > 0 ? `: ${results.webrtc.stunUrls.join(", ")}` : ""})`,
  );
  for (const l of describeWebRtc(results.webrtc)) bullet(l);
  add();

  add("5. СЕТЬ (по данным браузера, IP-адрес не собирается)");
  bullet(`Браузер: ${net.browser}`);
  bullet(`Язык: ${net.language || "неизвестно"}`);
  bullet(`Часовой пояс: ${net.timeZone || "неизвестно"}`);
  bullet(`Соединение: ${net.connection ?? "браузер не сообщает"}`);
  bullet(`Браузер считает, что интернет есть: ${net.online === null ? "неизвестно" : net.online ? "да" : "нет"}`);
  add();

  add("ЗАПОЛНИТЕ ВРУЧНУЮ");
  add(`Провайдер и город: ${manual.provider.trim() || `${BLANK} — впишите вручную`}`);
  add(`Способ подключения (проводной интернет / Wi-Fi / мобильный): ${CONNECTION_LABEL[manual.connection]}`);
  add(`VPN или обход блокировок были включены (да / нет): ${manual.vpn === "yes" ? "да" : manual.vpn === "no" ? "нет" : BLANK}`);
  add(`Что ещё заметили: ${manual.note.trim() || BLANK}`);

  return out.join("\n");
}
