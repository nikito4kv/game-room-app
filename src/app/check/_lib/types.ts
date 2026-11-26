// Типы результатов «Проверки связи». Чистые данные: их же принимают
// buildVerdict и buildReport, поэтому всё проверяется юнит-тестами без браузера.

export type FileStatus =
  /** Файл пришёл целиком. */
  | "ok"
  /** Данные шли, потом наступила тишина: «замерзло». */
  | "stalled"
  /** Не уложились в таймаут (либо нет ответа вообще, либо идёт, но очень медленно). */
  | "timeout"
  /** Сеть оборвала соединение или сервер ответил ошибкой. */
  | "error"
  /** Не проверялось (сайт перед этим не отвечал). */
  | "skipped";

export type FileResult = {
  id: string;
  label: string;
  expectedBytes: number;
  status: FileStatus;
  receivedBytes: number;
  /** До заголовков ответа, мс. null — ответа не было. */
  ttfbMs: number | null;
  /** От запроса до конца или обрыва, мс. */
  totalMs: number;
  /** Код ответа сервера, если он был. */
  httpStatus: number | null;
  /** Сколько мс молчало соединение к моменту обрыва (для stalled). */
  silenceMs: number | null;
};

export type SiteResult = {
  /** Наш домен, откуда качали (location.origin). */
  origin: string;
  files: FileResult[];
};

export type VoiceStatus = "reachable" | "unreachable" | "skipped";

export type HttpsProbe = {
  ok: boolean;
  /** Время до ответа, мс. null — ответа не было. */
  ms: number | null;
  error: "timeout" | "network" | null;
};

export type WsProbe = {
  /**
   * open: рукопожатие прошло.
   * failed: браузер сообщил об ошибке до открытия. Без токена LiveKit отвечает 401, и
   *   по одному событию WebSocket такой отказ не отличить от обрыва сети: смысл ему
   *   придаёт HTTPS-проверка рядом (если сервер по HTTPS ответил, это отказ).
   * timeout: тишина до таймаута.
   */
  outcome: "open" | "failed" | "timeout";
  ms: number;
};

export type VoiceResult = {
  /** Адрес из настроек сайта (wss://…) или null, если не задан. */
  url: string | null;
  host: string | null;
  status: VoiceStatus;
  https: HttpsProbe | null;
  ws: WsProbe | null;
};

export type TurnStatus =
  /** Сервер TURN ответил по TLS (пусть и отказом без настоящих данных): имя и порт доступны. */
  | "reachable"
  /** Ответа нет: TLS до turn-имени не дошёл или сервер молчит. */
  | "unreachable"
  /** Браузер не показывает ответы TURN (нет события icecandidateerror) или нет WebRTC. */
  | "unsupported"
  | "skipped"
  | "error";

export type TurnResult = {
  status: TurnStatus;
  /** Имя сервера TURN (turn.…), с которым пробовали связаться. */
  host: string | null;
  /** Что просили: turns:host:443?transport=tcp. */
  url: string | null;
  /** Код ответа сервера (400/401…), если он был. */
  code: number | null;
  /** Мс до ответа сервера. */
  ms: number | null;
  /** Коды ошибок ≥ 700 (нет связи), для отчёта. */
  failCodes: number[];
};

export type WebRtcStatus =
  /** Получили srflx: UDP до нашего сервера проходит. */
  | "ok"
  /** Только host: ответа STUN нет, UDP до сервера не прошёл. */
  | "no-srflx"
  | "unsupported"
  | "error"
  | "skipped";

export type IceError = { code: number; url: string };

export type WebRtcResult = {
  status: WebRtcStatus;
  /** Какие STUN-серверы просили (наши имена), для отчёта. */
  stunUrls: string[];
  host: number;
  srflx: number;
  relay: number;
  /** Мс от старта до первого кандидата каждого типа. */
  firstHostMs: number | null;
  firstSrflxMs: number | null;
  /** Когда сбор закончился (или вышло время), мс. */
  doneMs: number | null;
  /** Закончился ли сбор сам, а не по нашему таймауту. */
  completed: boolean;
  errors: IceError[];
};

export type NetInfo = {
  /** Кратко: «Chrome 141, Windows». Полный User-Agent не берём. */
  browser: string;
  language: string;
  timeZone: string;
  /** Данные navigator.connection одной строкой или null, если браузер не даёт. */
  connection: string | null;
  online: boolean | null;
};

export type CheckResults = {
  site: SiteResult;
  voice: VoiceResult;
  turn: TurnResult;
  webrtc: WebRtcResult;
};

export type Level = "good" | "warn" | "bad";

export type Verdict = {
  level: Level;
  /** «Всё хорошо» / «Есть проблемы» / «Не работает». */
  title: string;
  /** 2–3 строки «что это значит». */
  lines: string[];
  /** Коротко для таблицы: «сайт=ok голос=ok udp=ok». */
  summary: string;
};

/** То, что человек вписал сам. Пустое остаётся пустой строкой в отчёте. */
export type ManualFields = {
  provider: string;
  connection: "" | "wired" | "wifi" | "mobile";
  vpn: "" | "no" | "yes";
  note: string;
};
