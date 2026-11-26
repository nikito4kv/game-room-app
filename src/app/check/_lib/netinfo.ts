import type { NetInfo } from "./types";

// Сведения о браузере и сети, которые попадают в отчёт. IP-адрес и провайдера мы
// НЕ собираем: их человек вписывает сам. Полный User-Agent тоже не берём.

function major(ua: string, re: RegExp): string | null {
  const m = re.exec(ua);
  return m ? m[1] : null;
}

/** «Chrome 141, Windows». Только имя, главная версия и система. */
export function shortUserAgent(ua: string): string {
  let browser: string | null = null;
  let v: string | null;
  if ((v = major(ua, /\bEdg(?:e|A|iOS)?\/(\d+)/))) browser = `Edge ${v}`;
  else if ((v = major(ua, /\bOPR\/(\d+)/))) browser = `Opera ${v}`;
  else if ((v = major(ua, /\bYaBrowser\/(\d+)/))) browser = `Яндекс Браузер ${v}`;
  else if ((v = major(ua, /\bSamsungBrowser\/(\d+)/))) browser = `Samsung Internet ${v}`;
  else if ((v = major(ua, /\b(?:Firefox|FxiOS)\/(\d+)/))) browser = `Firefox ${v}`;
  else if ((v = major(ua, /\b(?:Chrome|CriOS)\/(\d+)/))) browser = `Chrome ${v}`;
  else if (/\bSafari\//.test(ua) && (v = major(ua, /\bVersion\/(\d+)/))) browser = `Safari ${v}`;

  let os: string | null = null;
  let a: string | null;
  if (/\bWindows NT 10\.0/.test(ua)) os = "Windows 10/11";
  else if (/\bWindows NT/.test(ua)) os = "Windows";
  else if ((a = major(ua, /\bAndroid (\d+)/))) os = `Android ${a}`;
  else if (/\b(?:iPhone|iPad|iPod)\b/.test(ua)) os = "iOS";
  else if (/\bMac OS X\b/.test(ua)) os = "macOS";
  else if (/\bCrOS\b/.test(ua)) os = "ChromeOS";
  else if (/\bLinux\b/.test(ua)) os = "Linux";

  const parts = [browser, os].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(", ") : "неизвестный браузер";
}

/** То, что отдаёт navigator.connection (есть не везде: в Safari и Firefox нет). */
export type ConnectionLike = {
  type?: string;
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
};

const CONNECTION_TYPES: Record<string, string> = {
  wifi: "Wi-Fi",
  cellular: "мобильная сеть",
  ethernet: "проводная сеть",
  bluetooth: "bluetooth",
  none: "нет сети",
  other: "другое",
  unknown: "неизвестно",
};

/** «Wi-Fi · 4g · ~10 Мбит/с · RTT ~50 мс» или null, если браузер ничего не сообщил. */
export function describeConnection(c: ConnectionLike | null | undefined): string | null {
  if (!c) return null;
  const parts: string[] = [];
  if (c.type) parts.push(CONNECTION_TYPES[c.type] ?? c.type);
  if (c.effectiveType) parts.push(c.effectiveType);
  if (typeof c.downlink === "number") parts.push(`~${String(c.downlink).replace(".", ",")} Мбит/с`);
  if (typeof c.rtt === "number") parts.push(`RTT ~${c.rtt} мс`);
  if (c.saveData) parts.push("экономия трафика включена");
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Собирает сведения в браузере. Любое поле, которого нет, остаётся пустым. */
export function collectNetInfo(): NetInfo {
  const nav = typeof navigator === "undefined" ? null : navigator;
  let timeZone = "";
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    // старый браузер: часовой пояс останется неизвестным
  }
  const connection = nav ? (nav as Navigator & { connection?: ConnectionLike }).connection : undefined;
  return {
    browser: nav ? shortUserAgent(nav.userAgent) : "неизвестный браузер",
    language: nav?.language ?? "",
    timeZone,
    connection: describeConnection(connection),
    online: nav && typeof nav.onLine === "boolean" ? nav.onLine : null,
  };
}
