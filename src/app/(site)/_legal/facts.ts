// Числа из кода, которые названы в текстах /privacy и /terms. Сроки хранения тут
// продублированы вручную, потому что roomSecret.ts тянет за собой Redis и не должен
// попадать в страницу; расхождение ловит facts.test.ts.
import {
  CHAT_HISTORY_LIMIT,
  CHAT_MAX_LENGTH,
  KICK_BLOCK_SEC,
  MAX_PARTICIPANTS,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  TITLE_MAX_LENGTH,
} from "@/lib/api/contract";

export const LEGAL_FACTS = {
  /** Предохранитель: состояние комнаты не живёт дольше (ROOM_STATE_TTL_SECONDS). */
  roomStateMaxHours: 48,
  /** Сколько состояние живёт после закрытия комнаты (ROOM_FINISHED_GRACE_SECONDS). */
  roomClosedGraceMinutes: 15,
  /** Самое длинное окно счётчика частоты запросов: passwordFailLimit, 10 минут. */
  rateLimitMaxMinutes: 10,
  /** Самое короткое окно: chatLimit и voiceLimit, 10 секунд. */
  rateLimitMinSeconds: 10,
  /** Кик закрывает вход на столько минут (KICK_BLOCK_SEC). */
  kickMinutes: KICK_BLOCK_SEC / 60,
  chatHistoryLimit: CHAT_HISTORY_LIMIT,
  chatMaxLength: CHAT_MAX_LENGTH,
  maxParticipants: MAX_PARTICIPANTS,
  nameMin: NAME_MIN_LENGTH,
  nameMax: NAME_MAX_LENGTH,
  titleMax: TITLE_MAX_LENGTH,
  /** Возраст, с которого можно пользоваться комнатами. */
  minAge: 13,
  /** Возраст, с которого можно покупать платные тарифы. */
  paidMinAge: 18,
} as const;

/**
 * Редакция политики и условий от 5 октября 2026 (А7: жалобы, заявки-диалоги,
 * события посещений, журнал администрации). Оферта осталась в общей редакции
 * LEGAL_REVISION (src/lib/legalEntity.ts).
 */
export const REVISION_2026_10_06 = { label: "5 октября 2026", iso: "2026-10-05" } as const;

/** Числа новых разделов политики и правил (А2–А7); совпадение с кодом сервера проверяет facts.test.ts. */
export const PLATFORM_FACTS = {
  /** Сколько дней храним сетевой адрес в сигналах и блокировках. */
  ipDays: 30,
  /** Сколько храним заявку-диалог, если раньше не попросили удалить. */
  leadMonths: 12,
  /** Сколько дней хранится жалоба (REPORT_TTL_SEC). */
  reportDays: 180,
  /** Сколько последних сообщений чата кладём в жалобу. */
  reportChatSnapshot: 30,
  /** Комментарий к жалобе, символов. */
  reportNoteMax: 500,
  /** Сколько дней сервер хранит рисунок Румика после последнего входа с ним (AVATAR_TTL_DAYS). */
  avatarDays: 30,
  /** Сколько прошлых рисунков браузер помнит в «Моих Румиках» (GALLERY_LIMIT). */
  rumikGallery: 8,
} as const;

/**
 * Редакция политики от 6 октября 2026: рисунок Румика на сервере (R4). Условия
 * и правила остались в редакции REVISION_2026_10_06.
 */
export const PRIVACY_REVISION = { label: "6 октября 2026", iso: "2026-10-06" } as const;
