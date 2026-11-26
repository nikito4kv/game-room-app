// Константы «Проверки связи» (/check). Менять размеры и имена файлов можно только
// вместе с scripts/gen-check-files.mjs: тест constants.test.ts
// следит, чтобы они совпадали.

/** Версия теста. Уходит в отчёт: по ней видно, какими правилами меряли. */
export const CHECK_VERSION = "1.0 (2026-10-01)";

const KB = 1024;

export type TestFile = {
  id: string;
  /** Подпись в интерфейсе и отчёте. */
  label: string;
  /** Имя в public/check/. */
  name: string;
  bytes: number;
};

/** Тестовые файлы: от меньшего к большему. Метод «16 КБ» ловится на 64 КБ и дальше. */
export const TEST_FILES: readonly TestFile[] = [
  { id: "16k", label: "16 КБ", name: "test-16kb.bin", bytes: 16 * KB },
  { id: "64k", label: "64 КБ", name: "test-64kb.bin", bytes: 64 * KB },
  { id: "300k", label: "300 КБ", name: "test-300kb.bin", bytes: 300 * KB },
  { id: "1m", label: "1 МБ", name: "test-1mb.bin", bytes: 1024 * KB },
];

/** Сколько ждать один файл целиком. */
export const FILE_TIMEOUT_MS = 10_000;
/** Тишина, после которой считаем, что скачивание «замерзло» (не ждём все 10 с). */
export const FILE_STALL_MS = 5_000;
/** Сколько ждать ответ сервера голоса (HTTPS и WebSocket). */
export const VOICE_TIMEOUT_MS = 8_000;
/** Сколько собирать ICE-кандидатов. */
export const ICE_TIMEOUT_MS = 6_000;
/** Порты STUN на нашем сервере: стандартный TURN/UDP и запасной 443. */
export const STUN_PORTS: readonly number[] = [3478, 443];
/** TURN по TLS: Caddy принимает его на 443 по имени turn.… (deploy/Caddyfile). */
export const TURN_TLS_PORT = 443;
/**
 * Заведомо «неправильные» данные для TURN. Нам нужно не получить канал, а увидеть,
 * что сервер ответил (он отвечает отказом 400/401), значит имя, TLS и порт доступны.
 * Это не секрет и не обход защиты: настоящих данных у страницы нет.
 */
export const TURN_PROBE_USER = "gameroom-check";
export const TURN_PROBE_PASSWORD = "gameroom-check";

/** Пороги «медленно». */
export const SLOW_TTFB_MS = 3_000;
export const SLOW_SPEED_BYTES_PER_S = 150 * KB;

/** Путь тестовых файлов на нашем домене. */
export const TEST_FILES_PATH = "/check/";
