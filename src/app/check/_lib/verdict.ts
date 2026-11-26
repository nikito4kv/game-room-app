import { SLOW_SPEED_BYTES_PER_S, SLOW_TTFB_MS } from "./constants";
import { formatBytes, speedBytesPerSecond } from "./format";
import type {
  CheckResults,
  FileResult,
  Level,
  SiteResult,
  TurnResult,
  Verdict,
  VoiceResult,
  WebRtcResult,
} from "./types";

// Разбор результатов в «светофор». Чистые функции: всё, что решает цвет и слова,
// проверяется юнит-тестами (verdict.test.ts) без браузера. Три имени нашего сервера
// (сайт, rtc.…, turn.…) оцениваются отдельно: цензор может резать по имени в TLS.

// ───────────────────────── Сайт ─────────────────────────

export type SiteState =
  /** Все файлы пришли целиком и быстро. */
  | "ok"
  /** Пришли целиком, но медленно (долгий ответ или низкая скорость), либо таймаут при живом потоке. */
  | "slow"
  /** Поток встал или оборвался посреди файла: «замерзание» после N КБ. */
  | "frozen"
  /** Ни один байт не пришёл: сайт не открылся вообще. */
  | "down"
  /** Сайт ответил кодом ошибки (404/5xx): это похоже на нашу поломку, а не на сеть. */
  | "http-error"
  /** Нечего оценивать (всё пропущено). */
  | "incomplete";

export type SiteAnalysis = {
  state: SiteState;
  /** Для frozen: сколько байт пришло в самом раннем сорвавшемся файле (≈ порог). null: байт не было. */
  frozenAfterBytes: number | null;
  /** Самый большой файл, который пришёл целиком. */
  largestOkBytes: number | null;
  /** Для http-error: код. */
  httpStatus: number | null;
};

const NONE = { frozenAfterBytes: null, largestOkBytes: null, httpStatus: null } as const;

/** Файл оборвался или встал посреди скачивания: байты шли, но не дошли до конца. */
function isCutOff(f: FileResult): boolean {
  if (f.status === "stalled") return true;
  return (
    f.status === "error" &&
    f.httpStatus !== null &&
    f.httpStatus < 400 &&
    f.receivedBytes > 0 &&
    f.receivedBytes < f.expectedBytes
  );
}

export function analyzeSite(site: SiteResult): SiteAnalysis {
  const files = site.files.filter((f) => f.status !== "skipped");
  if (files.length === 0) return { state: "incomplete", ...NONE };

  const okFiles = files.filter((f) => f.status === "ok");
  const largestOk = okFiles.reduce((m, f) => Math.max(m, f.expectedBytes), 0) || null;
  const failed = files.filter((f) => f.status !== "ok");

  if (failed.length === 0) {
    const slowTtfb = files.some((f) => f.ttfbMs !== null && f.ttfbMs > SLOW_TTFB_MS);
    const biggest = files.reduce((a, b) => (b.expectedBytes > a.expectedBytes ? b : a));
    const speed = speedBytesPerSecond(biggest.receivedBytes, biggest.totalMs);
    const slowSpeed = biggest.expectedBytes >= 300 * 1024 && speed !== null && speed < SLOW_SPEED_BYTES_PER_S;
    return { state: slowTtfb || slowSpeed ? "slow" : "ok", ...NONE, largestOkBytes: largestOk };
  }

  // «Замерзание»: данные шли и встали, либо соединение оборвали на середине файла.
  const cut = failed.filter(isCutOff);
  // Или после маленьких файлов более крупный не дал вообще ни байта: то же самое на
  // том же соединении (HTTP/2 гонит запросы по одному TCP-соединению).
  const silentAfterOk =
    largestOk !== null
      ? failed.filter(
          (f) =>
            f.receivedBytes === 0 &&
            f.expectedBytes > largestOk &&
            (f.status === "timeout" || (f.status === "error" && f.httpStatus === null)),
        )
      : [];
  if (cut.length > 0 || silentAfterOk.length > 0) {
    const withBytes = cut.filter((f) => f.receivedBytes > 0);
    return {
      state: "frozen",
      frozenAfterBytes: withBytes.length > 0 ? Math.min(...withBytes.map((f) => f.receivedBytes)) : null,
      largestOkBytes: largestOk,
      httpStatus: null,
    };
  }

  // Сервер отвечал, но кодом ошибки.
  const httpErrors = failed.filter((f) => f.status === "error" && f.httpStatus !== null && f.httpStatus >= 400);
  if (httpErrors.length === failed.length) {
    return { state: "http-error", ...NONE, largestOkBytes: largestOk, httpStatus: httpErrors[0].httpStatus };
  }

  // Совсем ничего не пришло.
  if (files.every((f) => f.receivedBytes === 0 && f.status !== "ok")) return { state: "down", ...NONE };

  // Остальное: таймаут при живом потоке (медленно) или смесь.
  return { state: "slow", ...NONE, largestOkBytes: largestOk };
}

// ───────────────────────── Голос, TURN, UDP ─────────────────────────

export type VoiceState = "ok" | "slow" | "down" | "unknown";

export function analyzeVoice(voice: VoiceResult): VoiceState {
  if (voice.status === "skipped") return "unknown";
  if (voice.status === "unreachable") return "down";
  const slow = voice.https?.ok === true && voice.https.ms !== null && voice.https.ms > SLOW_TTFB_MS;
  return slow ? "slow" : "ok";
}

export type TurnState = "ok" | "down" | "unknown";

/** «unknown»: проверить нечем (нет имени, браузер не показывает ответы TURN, сбой). */
export function analyzeTurn(turn: TurnResult): TurnState {
  if (turn.status === "reachable") return "ok";
  if (turn.status === "unreachable") return "down";
  return "unknown";
}

export type RtcState = "udp-ok" | "udp-fail" | "unsupported" | "error" | "unknown";

export function analyzeWebRtc(w: WebRtcResult): RtcState {
  switch (w.status) {
    case "ok":
      return "udp-ok";
    case "no-srflx":
      return "udp-fail";
    case "unsupported":
      return "unsupported";
    case "error":
      return "error";
    default:
      return "unknown";
  }
}

// ───────────────────────── Итог ─────────────────────────

const TITLES: Record<Level, string> = {
  good: "Всё хорошо",
  warn: "Есть проблемы",
  bad: "Не работает",
};

export function levelTitle(level: Level): string {
  return TITLES[level];
}

function summaryOf(site: SiteState, voice: VoiceState, turn: TurnState, rtc: RtcState): string {
  const word = (s: string) => (s === "down" ? "нет" : s === "unknown" ? "не проверено" : s);
  const udp = rtc === "udp-ok" ? "ok" : rtc === "udp-fail" ? "нет" : rtc === "unknown" ? "не проверено" : rtc;
  return `сайт=${word(site)} rtc=${word(voice)} turn=${word(turn)} udp=${udp}`;
}

const LIVE_CHECK =
  "Эта страница не проверяет голос вживую. Если получится, зайдите с другом в комнату и поговорите пару минут.";

/**
 * Итог простыми словами. Правила (по убыванию серьёзности):
 *  1. сайт «замерзает» (данные встают после нескольких КБ): не работает;
 *  2. сайт не открылся вообще: не работает (отдельная строка итога);
 *  3. сайт открылся, а rtc молчит: не работает (отдельная строка итога);
 *  4. сайт и rtc отвечают, а turn нет: плохо, если и UDP не проходит; иначе предупреждение;
 *  5. сайт отвечает ошибкой: наша поломка, проверку надо повторить позже;
 *  6. всё доходит, но медленно, или UDP не проходит, или браузер без WebRTC: есть проблемы;
 *  7. иначе всё хорошо (с оговоркой, что живой голос эта страница не проверяет).
 */
export function buildVerdict(input: CheckResults): Verdict {
  const a = analyzeSite(input.site);
  const voice = analyzeVoice(input.voice);
  const turn = analyzeTurn(input.turn);
  const rtc = analyzeWebRtc(input.webrtc);
  const summary = summaryOf(a.state, voice, turn, rtc);
  const make = (level: Level, lines: string[]): Verdict => ({
    level,
    title: TITLES[level],
    lines: lines.slice(0, 3),
    summary,
  });
  const rtcName = input.voice.host ?? "rtc";
  const turnName = input.turn.host ?? "turn";
  const siteName = hostOf(input.site.origin);

  // 1. Сайт замерзает.
  if (a.state === "frozen") {
    const first =
      a.frozenAfterBytes !== null && a.frozenAfterBytes >= 1024
        ? `Сайт открывается не до конца: скачивание замирает примерно после ${formatBytes(a.frozenAfterBytes)}.`
        : a.largestOkBytes !== null
          ? `Сайт открывается не до конца: файл ${formatBytes(a.largestOkBytes)} скачался, а более крупные не приходят.`
          : "Сайт открывается не до конца: данные перестают идти почти сразу.";
    const lines = [first, "Так обычно выглядит ограничение, которое провайдер ставит на связь с серверами за рубежом."];
    if (voice === "down" || turn === "down") {
      lines.push("Голосовой сервер или TURN тоже не отвечают: из этой сети комната, скорее всего, не заработает.");
    } else {
      lines.push("Голос и показ экрана передают много данных, поэтому из этой сети они, скорее всего, не заработают.");
    }
    return make("bad", lines);
  }

  // 2. Сайт не открылся вообще.
  if (a.state === "down") {
    if (voice === "down" && turn !== "ok") {
      return make("bad", [
        `Сайт ${siteName} не открылся вообще: ни один тестовый файл не скачался. Голосовой сервер тоже молчит.`,
        "Либо у вас сейчас нет интернета, либо провайдер блокирует адрес нашего сервера.",
        "Если включён VPN, выключите его и проверьте ещё раз. Результат всё равно пришлите.",
      ]);
    }
    return make("bad", [
      `Сайт ${siteName} не открылся вообще: ни один тестовый файл не скачался, хотя голосовой сервер или TURN отвечают.`,
      "Похоже, мешает что-то на пути именно к имени сайта: провайдер, антивирус или расширение браузера.",
    ]);
  }

  // 3. Сайт открылся, а голосовой сервер (rtc) молчит.
  if (voice === "down" && (a.state === "ok" || a.state === "slow")) {
    return make("bad", [
      `Сайт открылся, но голосовой сервер ${rtcName} не отвечает.`,
      "Скорее всего, ваш провайдер ограничивает связь с серверами за рубежом или с этим именем сервера. Без него комната не заработает.",
      turn === "down"
        ? `Запасной канал TURN (${turnName}) тоже не отвечает.`
        : turn === "ok"
          ? `TURN (${turnName}) отвечает, но в комнату заходят через ${rtcName}, поэтому без него голоса не будет.`
          : "Запасной канал TURN проверить не удалось.",
    ]);
  }

  // 4. Сайт и rtc отвечают, а TURN нет.
  if (turn === "down" && (a.state === "ok" || a.state === "slow") && voice !== "down") {
    if (rtc === "udp-fail") {
      return make("bad", [
        `Сайт и ${rtcName} отвечают, но TURN (${turnName}) молчит и прямой UDP до сервера не проходит.`,
        "Остаётся один запасной путь по TCP. Он может не помочь: голос из этой сети, скорее всего, не заработает.",
        LIVE_CHECK,
      ]);
    }
    return make("warn", [
      `Сайт и ${rtcName} отвечают, но запасной канал TURN (${turnName}) не отвечает.`,
      "Прямой UDP-канал работает, поэтому голос, скорее всего, заработает. Но в сетях, где UDP закрыт, запасного пути не будет.",
      LIVE_CHECK,
    ]);
  }

  // 5. Ошибка самого сайта.
  if (a.state === "http-error") {
    const code = a.httpStatus !== null ? ` (код ${a.httpStatus})` : "";
    return make("warn", [
      `Наш сайт ответил ошибкой${code}. Похоже на нашу поломку, а не на вашу сеть.`,
      "Пожалуйста, пришлите отчёт как есть и повторите проверку позже.",
    ]);
  }
  if (a.state === "incomplete") {
    return make("warn", [
      "Проверку сайта не удалось выполнить.",
      "Нажмите «Проверить ещё раз». Если повторится, пришлите отчёт как есть.",
    ]);
  }

  // 6. Всё доходит, но с оговорками.
  const issues: string[] = [];
  if (a.state === "slow") issues.push("Сайт отвечает медленно: тестовые файлы скачиваются дольше обычного.");
  if (voice === "slow") issues.push(`Голосовой сервер ${rtcName} отвечает долго.`);
  if (voice === "unknown") issues.push("Адрес сервера голоса в этой сборке сайта не задан, поэтому голос не проверялся.");
  if (rtc === "udp-fail") {
    issues.push(
      turn === "ok"
        ? "Прямой UDP-канал до нашего сервера не прошёл. Голос пойдёт через TURN по TLS (443): возможны задержки и рывки."
        : "Прямой UDP-канал до нашего сервера не прошёл, а запасной путь через TURN проверить не удалось: голос может не заработать.",
    );
  } else if (rtc === "unsupported") {
    issues.push("Этот браузер не умеет WebRTC, голос в нём не заработает. Попробуйте Chrome или Edge.");
  } else if (rtc === "error") {
    issues.push("Проверку WebRTC не удалось выполнить в этом браузере.");
  } else if (rtc === "unknown") {
    issues.push("Проверка WebRTC не выполнялась.");
  }
  if (issues.length > 0) return make("warn", [...issues.slice(0, 2), LIVE_CHECK]);

  // 7. Всё хорошо.
  const lines = [
    turn === "ok"
      ? "Сайт скачался целиком, сервер голоса и TURN отвечают, UDP-канал до нашего сервера проходит."
      : "Сайт скачался целиком, сервер голоса отвечает, UDP-канал до нашего сервера проходит.",
  ];
  if (turn === "unknown") lines.push("Запасной канал TURN этот браузер проверить не может: для полной проверки откройте страницу в Chrome или Edge.");
  lines.push(LIVE_CHECK);
  return make("good", lines);
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
