// Имена наших серверов. Ничего не хардкодим: адрес голоса берём из NEXT_PUBLIC_LIVEKIT_URL
// (его же использует клиент комнаты), домен TURN из NEXT_PUBLIC_TURN_DOMAIN. Пока эту
// переменную не прокинули в сборку, домен TURN выводим из адреса голоса по правилу
// deploy/.env.example: rtc.<домен> и turn.<домен> стоят рядом на одном сервере.

export type ParsedVoiceUrl = {
  /** wss://host[:port], без пути. */
  url: string;
  host: string;
  hostname: string;
  /** https://host[:port] */
  httpOrigin: string;
  /** wss://host[:port]/rtc: тот самый путь, по которому клиент LiveKit открывает сигналинг. */
  wsUrl: string;
};

/** Разбирает адрес из NEXT_PUBLIC_LIVEKIT_URL. null: пусто, не адрес или не ws/wss/http/https. */
export function parseVoiceUrl(raw: string | null | undefined): ParsedVoiceUrl | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const secure = u.protocol === "wss:" || u.protocol === "https:";
  if (!secure && u.protocol !== "ws:" && u.protocol !== "http:") return null;
  const ws = secure ? "wss:" : "ws:";
  const http = secure ? "https:" : "http:";
  return {
    url: `${ws}//${u.host}`,
    host: u.host,
    hostname: u.hostname,
    httpOrigin: `${http}//${u.host}`,
    wsUrl: `${ws}//${u.host}/rtc`,
  };
}

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

/**
 * Имя сервера TURN. Явная настройка главнее; иначе из «rtc.example.com» выводим
 * «turn.example.com». null: имени нет (адрес голоса не задан или не в виде rtc.…).
 * Адреса-числа (127.0.0.1, ::1) не трогаем: у них нет отдельного имени для TURN.
 */
export function resolveTurnHost(voiceHostname: string | null | undefined, configured?: string | null): string | null {
  const explicit = configured?.trim().toLowerCase();
  if (explicit && HOSTNAME_RE.test(explicit)) return explicit;
  const rtc = voiceHostname?.trim().toLowerCase();
  if (rtc && rtc.startsWith("rtc.") && rtc.length > 4 && HOSTNAME_RE.test(rtc)) return `turn.${rtc.slice(4)}`;
  return null;
}
