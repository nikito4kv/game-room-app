import { formatBytes, formatMs, formatSpeed } from "./format";
import type { FileResult, TurnResult, VoiceResult, WebRtcResult } from "./types";

// Тексты строк результата на экране. Короче и мягче, чем в отчёте: в отчёте нужна
// точность для разбора, на экране человеку важнее понять, что произошло.

export type RowTone = "ok" | "warn" | "bad" | "skip";

export type RowView = {
  tone: RowTone;
  /** Короткая метка справа: «Ок», «Замерзло». */
  badge: string;
  detail: string;
};

export function presentFile(f: FileResult): RowView {
  const got = `${formatBytes(f.receivedBytes)} из ${formatBytes(f.expectedBytes)}`;
  switch (f.status) {
    case "ok": {
      const speed = formatSpeed(f.receivedBytes, f.totalMs);
      const parts = [f.ttfbMs !== null ? `ответ за ${formatMs(f.ttfbMs)}` : null, speed].filter(
        (p): p is string => p !== null,
      );
      return { tone: "ok", badge: "Ок", detail: parts.join(", ") || "скачался" };
    }
    case "stalled": {
      const tail = f.silenceMs !== null ? ` ${formatMs(f.silenceMs)}` : "";
      return {
        tone: "bad",
        badge: "Замерзло",
        detail:
          f.receivedBytes === 0
            ? `сервер ответил, но данные не пошли, тишина${tail}`
            : `получено ${got}, потом тишина${tail}`,
      };
    }
    case "timeout":
      return f.ttfbMs === null
        ? { tone: "bad", badge: "Нет ответа", detail: `за ${formatMs(f.totalMs)} сервер не ответил` }
        : { tone: "warn", badge: "Медленно", detail: `за ${formatMs(f.totalMs)} получено ${got}` };
    case "error":
      if (f.httpStatus !== null && f.httpStatus >= 400) {
        return { tone: "bad", badge: "Ошибка", detail: `сайт ответил кодом ${f.httpStatus}` };
      }
      return {
        tone: "bad",
        badge: "Обрыв",
        detail: f.receivedBytes > 0 ? `соединение закрыто, получено ${got}` : "соединение не удалось",
      };
    case "skipped":
      return { tone: "skip", badge: "Пропущено", detail: "сайт перед этим не отвечал" };
  }
}

export function presentHttps(v: VoiceResult): RowView {
  if (v.status === "skipped" || !v.https) {
    return { tone: "skip", badge: "Не проверено", detail: "адрес сервера голоса в этой сборке не задан" };
  }
  if (v.https.ok) return { tone: "ok", badge: "Ок", detail: `сервер ответил за ${formatMs(v.https.ms ?? 0)}` };
  return v.https.error === "timeout"
    ? { tone: "bad", badge: "Нет ответа", detail: "сервер не ответил за отведённое время" }
    : { tone: "bad", badge: "Ошибка", detail: "соединение не удалось" };
}

export function presentWs(v: VoiceResult): RowView {
  if (v.status === "skipped" || !v.ws) {
    return { tone: "skip", badge: "Не проверено", detail: "адрес сервера голоса в этой сборке не задан" };
  }
  const t = formatMs(v.ws.ms);
  if (v.ws.outcome === "open") return { tone: "ok", badge: "Ок", detail: `рукопожатие прошло за ${t}` };
  if (v.ws.outcome === "timeout") return { tone: "bad", badge: "Нет ответа", detail: `тишина ${t}` };
  // Без токена сервер отвечает отказом. Если по HTTPS он отвечал, это он и есть.
  return v.https?.ok
    ? { tone: "ok", badge: "Ок", detail: `сервер ответил отказом без токена, так и задумано (${t})` }
    : { tone: "bad", badge: "Ошибка", detail: `соединение не удалось (${t})` };
}

export function presentTurn(t: TurnResult): RowView {
  switch (t.status) {
    case "reachable":
      return {
        tone: "ok",
        badge: "Ок",
        detail: `сервер ответил${t.ms !== null ? ` за ${formatMs(t.ms)}` : ""}, отказ без настоящих данных так и задуман`,
      };
    case "unreachable":
      return { tone: "bad", badge: "Нет ответа", detail: "TLS до TURN на порту 443 не дошёл" };
    case "unsupported":
      return {
        tone: "skip",
        badge: "Не проверено",
        detail: "этот браузер не показывает ответы TURN, откройте страницу в Chrome или Edge",
      };
    case "error":
      return { tone: "warn", badge: "Ошибка", detail: "браузер не дал выполнить проверку" };
    case "skipped":
      return { tone: "skip", badge: "Не проверено", detail: "имя TURN в этой сборке не задано" };
  }
}

export function presentHost(w: WebRtcResult): RowView {
  if (w.status === "unsupported") return { tone: "bad", badge: "Нет WebRTC", detail: "браузер не поддерживает WebRTC" };
  if (w.status === "skipped") return { tone: "skip", badge: "Не проверено", detail: "адрес нашего сервера не задан" };
  if (w.status === "error") return { tone: "warn", badge: "Ошибка", detail: "браузер не дал выполнить проверку" };
  return w.host > 0
    ? { tone: "ok", badge: "Ок", detail: `найдено адресов устройства: ${w.host}` }
    : { tone: "warn", badge: "Нет", detail: "браузер не показал адреса устройства (это возможно из-за защиты приватности)" };
}

export function presentSrflx(w: WebRtcResult): RowView {
  if (w.status === "unsupported" || w.status === "skipped" || w.status === "error") {
    return { tone: "skip", badge: "Не проверено", detail: "см. выше" };
  }
  return w.srflx > 0
    ? {
        tone: "ok",
        badge: "Ок",
        detail: `наш сервер ответил по UDP${w.firstSrflxMs !== null ? ` за ${formatMs(w.firstSrflxMs)}` : ""}`,
      }
    : { tone: "warn", badge: "Нет ответа", detail: "UDP до нашего сервера не прошёл, голос пойдёт запасным путём" };
}

export function presentRelay(): RowView {
  return {
    tone: "skip",
    badge: "Не проверяется",
    detail: "для TURN нужны одноразовые данные из настоящей комнаты; проверьте голос вживую",
  };
}
