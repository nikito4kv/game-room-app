// Общий контракт API Game Room — протокол версии 2 («quality-pass»).
//
// Этот файл — главный документ для клиента: здесь все типы запросов и ответов,
// коды ошибок, форма metadata комнаты и участника и формат чата. Он БЕЗ
// серверных импортов: его импортируют и маршруты /api/*, и клиент.
//
// ── Кто есть кто ──────────────────────────────────────────────────────────────
// • Устройство — пара { id, secret } в localStorage браузера (createDeviceIdentity
//   в ./deviceIdentity.ts). Одна на браузер, общая для всех комнат.
// • Личность участника (identity в LiveKit) = "u_" + device.id. Не ник! Ник — это
//   name в токене, его можно менять между входами.
// • Место в комнате закрепляется за устройством при первом входе (TOFU): сервер
//   хранит sha256(secret). Другое устройство с тем же id получит SEAT_TAKEN.
// • Владелец — тот, кто предъявил hostKey (выдаётся создателю в POST /api/rooms).
//   Владелец всегда может вернуть себе права хоста, его нельзя кикнуть, забанить
//   или заглушить. Владелец ≠ хост: хост — тот, у кого сейчас права (корона).
//
// ── Версия и ошибки ───────────────────────────────────────────────────────────
// Клиент шлёт v: PROTOCOL_VERSION в POST /api/token; клиент другой версии (вкладка,
// открытая до обновления сайта) получает CLIENT_OUTDATED и просит обновить
// страницу. Любой ответ с ошибкой — ApiErrorBody (см. ниже).
//
// ── Подключение и обрывы ──────────────────────────────────────────────────────
// • Вход с того же устройства, пока прежнее подключение ещё «висит» (обрыв сети,
//   перезагрузка, вторая вкладка), сервер пускает: LiveKit сам выбьет прежнее
//   подключение с DisconnectReason.DUPLICATE_IDENTITY. «Ник занят» после обрыва
//   больше не бывает.
// • Если LiveKit перезапускался и потерял комнату, POST /api/token пересоздаёт её
//   из Redis с тем же описанием и настройками. Переподключаться после окончательного
//   обрыва нужно именно через новый POST /api/token.
// • Состояние комнаты живёт 48 ч с последней активности, а после закрытия комнаты
//   (все вышли) — ещё 15 минут: вернувшиеся в эти минуты попадут в ту же комнату.
//
// ── Права ────────────────────────────────────────────────────────────────────
// Что участнику можно, решает сервер и прошивает в права LiveKit. Источник правды
// для кнопок интерфейса — participant.permissions (canPublishSources и т.д.):
// LiveKit сам не даст опубликовать запрещённое и сам снимет уже идущий трек при
// отзыве права. metadata участника и комнаты — для подписей и состояния кнопок.
// Клиент НЕ может слать свои data-пакеты (canPublishData: false): чат идёт
// только через POST /api/chat, рассылку делает сервер.

import type { RoomBadge } from "./platform";

/** Версия протокола. Клиент шлёт её в POST /api/token; при расхождении — CLIENT_OUTDATED. */
export const PROTOCOL_VERSION = 2;

// ── Лимиты ────────────────────────────────────────────────────────────────────

/** Ник после чистки (checkNickname в ./nickname.ts): от 2 до 24 символов (кодовых точек). */
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 24;
/** Название комнаты: 1–40 символов. */
export const TITLE_MAX_LENGTH = 40;
/** Пароль комнаты: 4–128 символов (пробелы по краям обрезаются). */
export const PASSWORD_MIN_LENGTH = 4;
export const PASSWORD_MAX_LENGTH = 128;
/** Максимум участников одновременно. */
export const MAX_PARTICIPANTS = 10;
/** На сколько секунд кик закрывает вход в комнату. */
export const KICK_BLOCK_SEC = 300;
/** Пауза после ухода хоста, после которой место хоста можно занять (claim). */
export const HOST_HANDOVER_DELAY_SEC = 30;

// ── Устройство и личность ─────────────────────────────────────────────────────

/**
 * Устройство из localStorage. id — 16 случайных байт в base64url (22 символа),
 * secret — 32 байта (43 символа). Создаёт createDeviceIdentity() из
 * ./deviceIdentity.ts. secret никому не показывать: это ключ от места в комнатах.
 */
export type DeviceIdentity = { id: string; secret: string };

/** Префикс identity участников: identity = "u_" + device.id. */
export const IDENTITY_PREFIX = "u_";

// ── Настройки комнаты ─────────────────────────────────────────────────────────

/** Кто может показывать экран: все / только хост / хост и те, кому он разрешил. */
export type ScreenPolicy = "all" | "host" | "approved";
/** Кто может писать в чат: все / только хост / никто. */
export type ChatPolicy = "all" | "host" | "off";

export type RoomSettings = { screen: ScreenPolicy; chat: ChatPolicy };

export const DEFAULT_ROOM_SETTINGS: RoomSettings = { screen: "all", chat: "all" };

export const SCREEN_POLICIES: readonly ScreenPolicy[] = ["all", "host", "approved"];
export const CHAT_POLICIES: readonly ChatPolicy[] = ["all", "host", "off"];

// ── Публичное описание комнаты: room.metadata в LiveKit ───────────────────────

/**
 * То, что лежит в room.metadata (JSON). Пишет только сервер, клиент читает через
 * parseRoomPublicMeta(room.metadata) и обновляется по RoomEvent.RoomMetadataChanged.
 * Секретов здесь нет: хэши пароля и ключа, баны и места — только в Redis.
 */
export type RoomPublicMeta = {
  /** Версия схемы metadata. */
  v: 2;
  title: string;
  /** Показывать ли комнату в витрине /rooms. */
  isPublic: boolean;
  /** Время создания, мс с эпохи. */
  createdAt: number;
  /** identity текущего хоста; null — хоста нет (место свободно). */
  hostIdentity: string | null;
  /** Ник хоста на момент получения прав (для витрины и подписей). */
  hostName: string | null;
  /** identity владельца (предъявил hostKey); null — владелец ещё не входил. */
  ownerIdentity: string | null;
  /** Замок: новых участников не пускают; кто уже был в комнате — может вернуться. */
  locked: boolean;
  /** Задан ли пароль (сам пароль никогда не раскрывается). */
  hasPassword: boolean;
  settings: RoomSettings;
  /**
   * Бейдж клуба: комната создана по ключу клуба/сообщества (POST /api/rooms с key).
   * Поля нет — обычная комната.
   */
  badge?: RoomBadge;
};

// ── metadata участника ────────────────────────────────────────────────────────

/**
 * Почему сервер удалил участника. "locked" — вошёл в запертую комнату в обход сервера.
 * admin_* — действия администрации сервиса (не хоста): admin_kick — выгнали на время
 * (retryAfterSec), admin_ban — навсегда из этой комнаты, admin_close — комнату
 * закрыли целиком (после этого она удаляется в LiveKit: клиент может увидеть и
 * DisconnectReason.ROOM_DELETED без removed).
 */
export type RemovalReason = "kick" | "ban" | "locked" | "admin_kick" | "admin_ban" | "admin_close";
const REMOVAL_REASONS: readonly RemovalReason[] = [
  "kick",
  "ban",
  "locked",
  "admin_kick",
  "admin_ban",
  "admin_close",
];

/**
 * participant.metadata (JSON), пишет только сервер. Читать parseParticipantPublicMeta.
 * Флаги отражают решения хоста; реальные запреты — в participant.permissions.
 */
export type ParticipantPublicMeta = {
  /** Хост заглушил принудительно: нельзя микрофон и звук демонстрации. */
  forceMuted: boolean;
  /** Хост запретил писать в чат. */
  chatMuted: boolean;
  /** В режиме screen: "approved" хост разрешил показывать экран. */
  screenAllowed: boolean;
  /**
   * Ставится прямо перед отключением участника сервером (кик/бан). Клиент видит
   * смену своей metadata, затем Disconnected с DisconnectReason.PARTICIPANT_REMOVED.
   */
  removed?: { reason: RemovalReason; retryAfterSec?: number };
};

// ── Ошибки ────────────────────────────────────────────────────────────────────

/**
 * Машинные коды отказов. HTTP-статус — в скобках. message в ответе — готовый
 * текст на русском для человека; клиент может показать его как есть.
 */
export type ApiErrorCode =
  /** (400) Кривой запрос: не JSON, нет обязательного поля, неизвестное действие. */
  | "BAD_REQUEST"
  /** (426) Клиент старой версии — нужно обновить страницу. */
  | "CLIENT_OUTDATED"
  /** (400) Ник не прошёл проверку (пустой, короче 2, длиннее 24 символов). */
  | "INVALID_NAME"
  /** (400) Название комнаты пустое или длиннее 40 символов. */
  | "INVALID_TITLE"
  /** (400) Пароль короче 4 или длиннее 128 символов (при создании и смене). */
  | "INVALID_PASSWORD"
  /** (404) Комнаты с таким кодом нет. */
  | "ROOM_NOT_FOUND"
  /** (401) Нужен пароль — показать поле ввода. Попытки не тратит. */
  | "PASSWORD_REQUIRED"
  /** (401) Неверный пароль; attemptsLeft — сколько попыток осталось у комнаты. */
  | "WRONG_PASSWORD"
  /** (429) Исчерпаны попытки пароля в комнате; retryAfterSec — когда можно снова. */
  | "TOO_MANY_ATTEMPTS"
  /** (429) Слишком часто; retryAfterSec — через сколько повторить. */
  | "RATE_LIMITED"
  /** (409) Место (identity) в этой комнате закреплено за другим устройством. */
  | "SEAT_TAKEN"
  /** (409) Ник занят другим присутствующим; suggestion — свободный вариант. */
  | "NAME_TAKEN"
  /** (409) В комнате уже MAX_PARTICIPANTS человек. */
  | "ROOM_FULL"
  /** (403) Комната заперта для новых участников. */
  | "ROOM_LOCKED"
  /** (403) Вас забанили в этой комнате. */
  | "BANNED"
  /** (403) Вас кикнули; retryAfterSec — через сколько можно вернуться. */
  | "KICKED"
  /** (401) Токен не прошёл проверку подписи или выдан для другой комнаты. */
  | "UNAUTHORIZED"
  /** (403) Вызывающий сейчас не в комнате. */
  | "NOT_IN_ROOM"
  /** (403) Действие доступно только хосту. */
  | "NOT_HOST"
  /** (403) Действие доступно только владельцу (reclaim без прав владельца). */
  | "NOT_OWNER"
  /** (404) Участник, к которому применяют действие, не найден. */
  | "TARGET_NOT_FOUND"
  /** (403) Владельца нельзя кикнуть, забанить, заглушить или лишить чата. */
  | "TARGET_IS_OWNER"
  /** (400) Действие нельзя применить к себе. */
  | "TARGET_IS_SELF"
  /** (409) Хост в комнате — занимать его место нельзя. */
  | "HOST_PRESENT"
  /** (409) Хост ушёл недавно; retryAfterSec — когда повторить claim. */
  | "HOST_HANDOVER_PENDING"
  /** (403) Чат выключен хостом (или администрацией — тогда свой текст). */
  | "CHAT_DISABLED"
  /** (403) Писать в чат сейчас может только хост. */
  | "CHAT_HOST_ONLY"
  /** (403) Хост запретил этому участнику писать в чат. */
  | "CHAT_MUTED"
  /** (400) Пустое сообщение (после очистки). */
  | "MESSAGE_EMPTY"
  /** (400) Сообщение длиннее CHAT_MAX_LENGTH. */
  | "MESSAGE_TOO_LONG"
  /** (403) Адрес или устройство заблокированы администрацией. */
  | "BLOCKED"
  /** (403) Комнату закрыла администрация; message — объяснение. */
  | "ROOM_CLOSED"
  /** (503) Режим обслуживания: вход или создание комнат временно закрыты; message — текст. */
  | "MAINTENANCE"
  /** (400) Ключ клуба / код неверный, отозван, истёк или исчерпан; message — что именно. */
  | "INVALID_KEY"
  /** (503) Функция временно выключена администрацией (жалобы, заявки…). */
  | "FEATURE_DISABLED"
  /** (404) Заявки нет или ссылка на неё неверная. */
  | "LEAD_NOT_FOUND"
  /** (409) Та же заявка уже отправлена несколько минут назад (двойной клик, повтор). */
  | "LEAD_DUPLICATE"
  /** (400) Рисунок не подошёл: не PNG, не тот размер, анимация или слишком большой. */
  | "AVATAR_INVALID"
  /** (403) Этот рисунок скрыла администрация — тот же загрузить нельзя. */
  | "AVATAR_BLOCKED"
  /** (404) Рисунка нет: не было, истёк срок или скрыт администрацией. */
  | "AVATAR_NOT_FOUND"
  /** (429) Место под новые рисунки на сегодня кончилось (общий суточный бюджет сайта). */
  | "AVATAR_LIMIT"
  /** (400) Звук не подошёл: не аудиофайл, слишком большой или без названия. */
  | "SOUND_INVALID"
  /** (409) В комнате уже максимум своих звуков — уберите лишний. */
  | "SOUND_LIMIT"
  /** (404) Звука нет: не было, убрали или комната закончилась. */
  | "SOUND_NOT_FOUND"
  /** (503) Redis или LiveKit недоступны — повторить чуть позже. */
  | "SERVICE_UNAVAILABLE"
  /** (500) Непредвиденная ошибка сервера. */
  | "SERVER_ERROR";

/** Коды, у которых есть retryAfterSec. */
export type RetryableErrorCode =
  | "TOO_MANY_ATTEMPTS"
  | "RATE_LIMITED"
  | "KICKED"
  | "HOST_HANDOVER_PENDING";

/** Одна ошибка: код, текст и (для некоторых кодов) подробности. */
export type ApiError =
  /** attemptsLeft: null — сервер сейчас не знает остаток (счётчик недоступен). */
  | { code: "WRONG_PASSWORD"; message: string; attemptsLeft: number | null }
  | { code: "NAME_TAKEN"; message: string; suggestion: string }
  | { code: RetryableErrorCode; message: string; retryAfterSec: number }
  | {
      code: Exclude<ApiErrorCode, "WRONG_PASSWORD" | "NAME_TAKEN" | RetryableErrorCode>;
      message: string;
    };

/** Тело любого ответа с ошибкой (HTTP 4xx/5xx). */
export type ApiErrorBody = { error: ApiError };

// ── POST /api/rooms — создать комнату ────────────────────────────────────────

export type CreateRoomRequest = {
  title: string;
  /** Пароль 4–128 символов; пусто или нет поля — без пароля. */
  password?: string;
  /** Показывать в витрине. По умолчанию false. */
  isPublic?: boolean;
  /**
   * Ключ клуба / код (GR-XXXX-XXXX-XXXX). Верный — комната получает бейдж и
   * лимит людей ключа; неверный — INVALID_KEY, комната не создаётся.
   */
  key?: string;
  /** Случайный id браузера (gr:vid) для аналитики; без связи с человеком. */
  vid?: string;
};

/**
 * hostKey выдаётся ОДИН раз — сохранить в localStorage по коду комнаты и слать
 * в POST /api/token. Хоста в новой комнате нет, пока создатель не войдёт с ключом.
 */
export type CreateRoomResponse = { code: string; hostKey: string };

// ── GET /api/rooms — витрина публичных комнат ────────────────────────────────
// Только публичные комнаты, в которых кто-то есть; сначала многолюдные.

export type PublicRoomSummary = {
  code: string;
  title: string;
  /** Ник текущего хоста ("" — хоста сейчас нет). */
  hostName: string;
  numParticipants: number;
  maxParticipants: number;
  createdAt: number;
  locked: boolean;
  hasPassword: boolean;
  /** Бейдж клуба, если комната создана по ключу. */
  badge?: RoomBadge;
};

export type PublicRoomsResponse = { rooms: PublicRoomSummary[] };

// ── GET /api/rooms/КОД — превью комнаты до входа (лобби) ─────────────────────
// Ошибки: ROOM_NOT_FOUND, RATE_LIMITED, SERVICE_UNAVAILABLE.
// Состав берётся из LiveKit с коротким таймаутом: если LiveKit не ответил вовремя,
// превью всё равно приходит — без списка имён и со счётчиком «сколько известно».

/** Участник в превью. */
export type PreviewParticipant = { name: string; isHost: boolean };

export type PreviewResponse = {
  code: string;
  title: string;
  hasPassword: boolean;
  locked: boolean;
  isPublic: boolean;
  /** Сколько человек сейчас в комнате (0 — никого или LiveKit не ответил вовсе). */
  participantCount: number;
  maxParticipants: number;
  /** Бейдж клуба, если комната создана по ключу. */
  badge?: RoomBadge;
  /**
   * Кто в комнате: хост первым, остальные — по времени входа. Поля НЕТ, если у
   * комнаты пароль (имена до ввода пароля не показываем — только количество) или
   * LiveKit не успел ответить.
   */
  participants?: PreviewParticipant[];
};

// ── POST /api/token — войти в комнату ────────────────────────────────────────

export type TokenRequest = {
  v: typeof PROTOCOL_VERSION;
  code: string;
  /** Ник; сервер чистит его (см. checkNickname в ./nickname.ts) и вернёт итоговый в name. */
  name: string;
  device: DeviceIdentity;
  password?: string;
  /** Ключ владельца, если он есть у этого браузера. */
  hostKey?: string;
  /** Версия правил сервиса, с которой согласился человек (RULES_VERSION из platform.ts). */
  rulesVersion?: string;
  /** Случайный id браузера (gr:vid) для аналитики возвращаемости; без связи с человеком. */
  vid?: string;
  /**
   * Свой звук входа из соундборда (раздел «Соундборд»). Сервер кладёт его в
   * атрибут ENTER_SOUND_ATTRIBUTE, только если флаг soundboard включён для
   * комнаты; неизвестный звук молча отбрасывает — вход от него не зависит.
   */
  enterSound?: SoundId;
};

/**
 * Порядок проверок на сервере: лимит частоты → комната существует → пароль →
 * место (SEAT_TAKEN) → бан → кик → замок → заполненность → ник. Владелец с верным
 * hostKey проходит без пароля, бана, кика и замка. Если LiveKit потерял комнату
 * (перезапуск), сервер пересоздаёт её из Redis перед выдачей токена.
 */
export type TokenResponse = {
  /** JWT для LiveKit. Его же слать как token в /api/moderate и /api/chat. */
  token: string;
  serverUrl: string;
  /** identity этого участника ("u_" + device.id). */
  identity: string;
  /** Итоговый ник после нормализации. */
  name: string;
  isHost: boolean;
  isOwner: boolean;
  room: RoomPublicMeta;
};

// ── POST /api/moderate — действия хоста ──────────────────────────────────────

/** Частичное изменение настроек комнаты (действие "settings"). */
export type RoomSettingsPatch = {
  screen?: ScreenPolicy;
  chat?: ChatPolicy;
  locked?: boolean;
  isPublic?: boolean;
  /** Новый пароль (4–128 символов) или null / "" — снять пароль. */
  password?: string | null;
};

/**
 * Действие и его параметры. target — identity участника. Все действия, кроме
 * reclaim и claim, требуют, чтобы вызывающий был хостом и находился в комнате.
 */
export type ModerationCommand =
  /** Выкинуть и закрыть вход на KICK_BLOCK_SEC. Можно и к недавно вышедшему. */
  | { action: "kick"; target: string }
  /** Бан до конца жизни комнаты (по identity, то есть по устройству). */
  | { action: "ban"; target: string }
  | { action: "unban"; target: string }
  /** Список банов — ответ { ok: true, bans }. */
  | { action: "bans" }
  /** Принудительный мьют: нельзя ни микрофон, ни звук демонстрации. */
  | { action: "mute"; target: string }
  | { action: "unmute"; target: string }
  /** Мягко выключить микрофоны всем, кроме себя и владельца; включить можно самому. */
  | { action: "muteAll" }
  /** Остановить чужую демонстрацию (право показывать при этом не отбирается). */
  | { action: "stopScreen"; target: string }
  /** Разрешить / запретить показ экрана в режиме screen: "approved". */
  | { action: "allowScreen"; target: string }
  | { action: "disallowScreen"; target: string }
  /** Запретить / разрешить участнику писать в чат. */
  | { action: "chatMute"; target: string }
  | { action: "chatUnmute"; target: string }
  /** Передать права хоста присутствующему участнику. */
  | { action: "transfer"; target: string }
  /**
   * Владелец забирает права хоста себе. Хватает того, что identity вызывающего —
   * ownerIdentity; иначе нужен hostKey.
   */
  | { action: "reclaim"; hostKey?: string }
  /**
   * Занять свободное место хоста. Разрешено, если хоста нет в комнате дольше
   * HOST_HANDOVER_DELAY_SEC; раньше — HOST_HANDOVER_PENDING с retryAfterSec.
   * Хватит, чтобы claim слал один участник (самый ранний по joinedAt); если
   * пришлют несколько, сервер отдаст место первому, остальным — HOST_PRESENT.
   */
  | { action: "claim" }
  | { action: "settings"; settings: RoomSettingsPatch };

export type ModerationAction = ModerationCommand["action"];

export type ModerateRequest = {
  code: string;
  /** Свой LiveKit-токен из TokenResponse: подпись проверяется, срок — нет. */
  token: string;
} & ModerationCommand;

export type BanEntry = { identity: string; name: string };

export type ModerateResponse = { ok: true; bans?: BanEntry[] };

// ── Чат ───────────────────────────────────────────────────────────────────────

/** Тема data-пакетов LiveKit, в которых сервер рассылает сообщения чата. */
export const CHAT_TOPIC = "chat";
/** Максимальная длина сообщения, символов (кодовых точек). */
export const CHAT_MAX_LENGTH = 500;
/** Сколько последних сообщений хранит сервер (история для вошедших позже). */
export const CHAT_HISTORY_LIMIT = 100;

/**
 * Сообщение чата. Отправителя ставит сервер из проверенного токена — подделать
 * нельзя. Рассылается всем, включая автора: data-пакет LiveKit, тема CHAT_TOPIC,
 * reliable, полезная нагрузка — UTF-8 JSON этого объекта. У пакета нет
 * participant-отправителя (его шлёт сервер). Один и тот же id приходит и в ответе
 * POST, и в пакете — склеивайте по id.
 */
export type ChatMessage = {
  /** Уникальный id (base64url). */
  id: string;
  /** Время приёма сервером, мс с эпохи. */
  ts: number;
  from: { identity: string; name: string };
  text: string;
  /**
   * Сообщение администрации сервиса (а не участника): from = SYSTEM_CHAT_AUTHOR.
   * Поля нет — обычное сообщение.
   */
  system?: true;
};

/**
 * Токен личной ссылки заявки (/request/<id>?t=…) клиент шлёт в API этим заголовком,
 * а не в адресе: адреса оседают в логах и отчётах об ошибках.
 */
export const LEAD_TOKEN_HEADER = "x-lead-token";

/** Автор системных сообщений администрации в чате. */
export const SYSTEM_CHAT_AUTHOR = { identity: "system", name: "Администрация" } as const;

/**
 * POST /api/chat. text: до CHAT_MAX_LENGTH символов; управляющие символы сервер
 * вырезает, пробелы по краям обрезает, 3+ перевода строки сводит к двум.
 * Отказы: CHAT_DISABLED, CHAT_HOST_ONLY, CHAT_MUTED, RATE_LIMITED, NOT_IN_ROOM.
 */
export type ChatPostRequest = { code: string; token: string; text: string };
export type ChatPostResponse = { message: ChatMessage };

/**
 * GET /api/chat?code=КОД с заголовком Authorization: Bearer <token>. Звать
 * после подключения к комнате (сервер проверяет, что вы в ней). Сообщения — от
 * старых к новым.
 */
export type ChatHistoryResponse = { messages: ChatMessage[] };

// ── Голос участника: participant.attributes ───────────────────────────────────

/** Что другие видят о голосе участника, кроме мьюта (мьют виден по треку). */
export type PublicVoiceState = {
  /** «Звук выкл»: заглушил себе всю комнату — не слышит и сам заглушён. */
  deafened: boolean;
  /**
   * Рация включена: говорит, только пока держит клавишу. Трек почти всё время
   * заглушён, но это не «микрофон выключен» — интерфейс рисует значок рации.
   */
  ptt: boolean;
};

/**
 * Ключи атрибутов участника LiveKit (participant.attributes) для PublicVoiceState. * Значение "1" — да, ключа нет — нет (читать parseVoiceAttributes). Пишет только
 * сервер по POST /api/voice: правку своих атрибутов клиенту не даём — право
 * canUpdateOwnMetadata открыло бы и metadata с решениями хоста. Префикс «lk.»
 * занят самим LiveKit, поэтому свой — «voice.». Читает их только клиент:
 * livekit-server-sdk отдаёт ключи атрибутов в camelCase (voiceDeafened).
 */
export const VOICE_ATTRIBUTES: Readonly<Record<keyof PublicVoiceState, string>> = {
  deafened: "voice.deafened",
  ptt: "voice.ptt",
};

/**
 * POST /api/voice — сообщить своё «звук выкл» и рацию. Сервер пишет их в атрибуты
 * участника, LiveKit рассылает всем (ParticipantEvent.AttributesChanged).
 * Атрибуты живут, пока жива сессия участника в LiveKit: короткий обрыв (resume)
 * их не трогает, а после полного переподключения и входа заново (новый токен)
 * их нет — клиент шлёт состояние снова. Отказы: BAD_REQUEST, UNAUTHORIZED,
 * NOT_IN_ROOM, RATE_LIMITED.
 */
export type VoiceRequest = { code: string; token: string } & PublicVoiceState;
export type VoiceResponse = { ok: true };

// ── Рисунок участника: participant.attributes ─────────────────────────────────
// Свой Румик человек рисует в браузере (src/lib/rumik/storage.ts). Чтобы его
// видели другие в комнате, клиент шлёт уменьшенную копию на сервер, сервер
// хранит её под id-хэшем содержимого и пишет id в атрибут участника — LiveKit
// рассылает его всем, и вошедший позже получает его вместе со списком людей.
// Картинку берут по GET /api/avatar/<id>. Публичной галереи нет: адрес знает
// тот, кто видит атрибуты участника, то есть сидит в той же комнате (и тот, кому
// он этот адрес передал).

/**
 * Ключ атрибута участника LiveKit с id его рисунка; ключа нет — Румик цвета участника без рисунка.
 * Пишет только сервер по POST /api/avatar (как VOICE_ATTRIBUTES). Читает его
 * только клиент: livekit-server-sdk отдаёт ключи атрибутов в camelCase (avatarId).
 */
export const AVATAR_ATTRIBUTE = "avatar.id";

/** Рисунок для других — PNG ровно такого размера: рамка VIEW Румика (RUMIK_ASPECT). */
export const AVATAR_WIDTH = 286;
export const AVATAR_HEIGHT = 240;
/**
 * Потолок размера PNG, байт. Румик, нарисованный кистью, весит 5–20 КБ; фото,
 * загруженное в рисовалку, — 40–60 КБ, и клиент огрубляет цвета, пока не влезет
 * (обычно 10–30 КБ). Шум не влезает и огрублённым — против забивания хранилища.
 */
export const AVATAR_MAX_BYTES = 32 * 1024;
/**
 * Сколько дней сервер хранит рисунок после последнего POST с ним: каждый вход в
 * комнату с тем же рисунком продлевает срок. Потом запись стирается сама.
 */
export const AVATAR_TTL_DAYS = 30;

/** id рисунка: sha256 содержимого PNG, первые 16 символов base64url. */
const AVATAR_ID_RE = /^[A-Za-z0-9_-]{16}$/;

/** Похоже ли на id рисунка (формат, а не существование). */
export function isAvatarId(x: unknown): x is string {
  return typeof x === "string" && AVATAR_ID_RE.test(x);
}

/** Адрес картинки рисунка (для <Rumik paint={…} />). */
export function avatarUrl(id: string): string {
  return `/api/avatar/${id}`;
}

/** id рисунка из participant.attributes; нет или кривой — null (Румик без рисунка). */
export function parseAvatarAttribute(attributes: Readonly<Record<string, string>> | undefined): string | null {
  const id = attributes?.[AVATAR_ATTRIBUTE];
  return isAvatarId(id) ? id : null;
}

/**
 * POST /api/avatar — показать свой рисунок другим в комнате (или снять: png null).
 * png — base64 (без «data:…») PNG ровно AVATAR_WIDTH×AVATAR_HEIGHT, не больше
 * AVATAR_MAX_BYTES, без анимации. Кому писать, сервер берёт из подписи токена,
 * и только тому, кто сейчас в комнате. Одинаковые картинки — одна запись.
 * Атрибут живёт, пока жива сессия участника: после входа заново (новый токен)
 * его нет — клиент шлёт рисунок снова. Отказы: BAD_REQUEST, AVATAR_INVALID (не
 * PNG, не тот размер, анимация, слишком большой), UNAUTHORIZED, NOT_IN_ROOM,
 * AVATAR_BLOCKED (этот рисунок или все рисунки этого участника в комнате скрыла
 * администрация — повторять бесполезно), AVATAR_LIMIT (новые рисунки на сегодня
 * кончились на весь сайт), FEATURE_DISABLED (флаг rumik_share), RATE_LIMITED (с
 * retryAfterSec: часто, много новых с адреса или в комнате). После отказа клиент
 * снимает свой атрибут (png: null): другие видят Румика без рисунка, а не прошлый.
 */
export type AvatarRequest = { code: string; token: string; png: string | null };
/** id — что теперь в атрибуте участника; null — рисунок снят. */
export type AvatarResponse = { ok: true; id: string | null };

// GET /api/avatar/<id> — сама картинка (image/png). Адрес — хэш содержимого,
// поэтому кеш браузера держит её год (private, immutable: общие кеши по дороге её
// не хранят). Нет, истёк срок или скрыт администрацией — 404 AVATAR_NOT_FOUND;
// частые запросы с одного адреса — 429.

// ── Разбор metadata (для клиента и сервера) ──────────────────────────────────

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function parseJsonRecord(raw: string | undefined | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const optString = (x: unknown): string | null => (typeof x === "string" && x ? x : null);

const BADGE_LABEL_MAX = 40;

/** Бейдж клуба из недоверенного JSON; кривой — undefined (комната без бейджа). */
export function parseRoomBadge(raw: unknown): RoomBadge | undefined {
  if (!isRecord(raw)) return undefined;
  const label = typeof raw.label === "string" ? raw.label.trim() : "";
  if (!label || [...label].length > BADGE_LABEL_MAX) return undefined;
  const color = typeof raw.color === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : null;
  return { label, color };
}

/**
 * Разбирает room.metadata. Принимает и схему v2, и прежнюю (без settings, хост —
 * ник): по ней переносится описание комнат прежней версии сервера (МИГРАЦИЯ в
 * loadRoomMetaOrAdopt, src/lib/server/roomSync.ts). Недостающее заполняет
 * значениями по умолчанию. null — metadata нет или она битая (тогда интерфейсу
 * нечего показывать, кроме кода).
 */
export function parseRoomPublicMeta(raw: string | undefined | null): RoomPublicMeta | null {
  const m = parseJsonRecord(raw);
  if (!m) return null;
  if (typeof m.title !== "string" || !m.title) return null;
  if (typeof m.isPublic !== "boolean") return null;
  if (typeof m.createdAt !== "number" || !Number.isFinite(m.createdAt)) return null;
  const s = isRecord(m.settings) ? m.settings : {};
  const screen = SCREEN_POLICIES.find((p) => p === s.screen) ?? DEFAULT_ROOM_SETTINGS.screen;
  const chat = CHAT_POLICIES.find((p) => p === s.chat) ?? DEFAULT_ROOM_SETTINGS.chat;
  const hostIdentity = optString(m.hostIdentity);
  const badge = parseRoomBadge(m.badge);
  return {
    v: 2,
    title: m.title,
    isPublic: m.isPublic,
    createdAt: m.createdAt,
    hostIdentity,
    // В прежней схеме имени не было: там хост и был ником.
    hostName: optString(m.hostName) ?? hostIdentity,
    ownerIdentity: optString(m.ownerIdentity),
    locked: m.locked === true,
    hasPassword: m.hasPassword === true,
    settings: { screen, chat },
    ...(badge ? { badge } : {}),
  };
}

/** Голос участника из participant.attributes; чего нет — false. */
export function parseVoiceAttributes(
  attributes: Readonly<Record<string, string>> | undefined,
): PublicVoiceState {
  return {
    deafened: attributes?.[VOICE_ATTRIBUTES.deafened] === "1",
    ptt: attributes?.[VOICE_ATTRIBUTES.ptt] === "1",
  };
}

/** Разбирает participant.metadata; при пустой или битой — все флаги false. */
export function parseParticipantPublicMeta(raw: string | undefined | null): ParticipantPublicMeta {
  const m = parseJsonRecord(raw) ?? {};
  const meta: ParticipantPublicMeta = {
    forceMuted: m.forceMuted === true,
    chatMuted: m.chatMuted === true,
    screenAllowed: m.screenAllowed === true,
  };
  const removed = m.removed;
  if (isRecord(removed)) {
    const rawReason = removed.reason;
    const reason = REMOVAL_REASONS.find((r) => r === rawReason);
    if (reason) {
      const retry = removed.retryAfterSec;
      meta.removed =
        typeof retry === "number" && Number.isFinite(retry)
          ? { reason, retryAfterSec: retry }
          : { reason };
    }
  }
  return meta;
}

// ── Реакции ───────────────────────────────────────────────────────────────────
// 👍 🔥 😂 GG над местом участника: всплывают на пару секунд, видят все в комнате.
// Своих data-пакетов клиенты слать не могут, поэтому реакция идёт через сервер,
// как чат: POST /api/reaction → data-пакет от сервера всем. Истории нет: кто
// вошёл позже, прошлых реакций не увидит.

/** Тема data-пакетов LiveKit, в которых сервер рассылает реакции. */
export const REACTION_TOPIC = "reaction";

/** Реакция: like 👍, fire 🔥, lol 😂, gg — надпись «GG». */
export type ReactionKind = "like" | "fire" | "lol" | "gg";
export const REACTION_KINDS: readonly ReactionKind[] = ["like", "fire", "lol", "gg"];

/**
 * Сколько реакций подряд можно послать: не больше REACTION_BURST за
 * REACTION_WINDOW_MS. Короткая очередь (🔥🔥🔥) проходит, флуд — нет. Клиент
 * держит это правило сам и до сервера лишнее не шлёт; сервер отказывает
 * RATE_LIMITED только тем, кто обходит клиент.
 */
export const REACTION_BURST = 5;
export const REACTION_WINDOW_MS = 5_000;

/** Это известная реакция? */
export function isReactionKind(x: unknown): x is ReactionKind {
  return typeof x === "string" && (REACTION_KINDS as readonly string[]).includes(x);
}

/**
 * POST /api/reaction — показать реакцию над своим местом. Кто реагирует, сервер
 * берёт из подписи токена, а не из тела. Отказы: BAD_REQUEST (неизвестная kind),
 * UNAUTHORIZED, ROOM_NOT_FOUND, NOT_IN_ROOM, FEATURE_DISABLED (реакции выключены
 * администрацией — флаг reactions), RATE_LIMITED (с retryAfterSec).
 */
export type ReactionRequest = { code: string; token: string; kind: ReactionKind };
export type ReactionResponse = { ok: true };

/**
 * Рассылка реакции: data-пакет LiveKit от сервера (participant пустой), тема
 * REACTION_TOPIC, всем, включая автора; полезная нагрузка — UTF-8 JSON этого
 * объекта. at — время приёма сервером (мс с эпохи); показывать реакцию клиент
 * начинает по своему времени получения: часы у людей расходятся.
 */
export type ReactionPacket = { identity: string; kind: ReactionKind; at: number };

/** Пакет реакции из сети; кривой — null. */
export function parseReactionPacket(raw: unknown): ReactionPacket | null {
  if (!isRecord(raw)) return null;
  const { identity, kind, at } = raw;
  if (typeof identity !== "string" || !identity || !isReactionKind(kind)) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  return { identity, kind, at };
}

// ── Соундборд ─────────────────────────────────────────────────────────────────
// Короткие звуки «для всех» (ба-дум-тсс, та-дам, сверчки…): нажал — звук играет у
// каждого в комнате. Звуков-файлов нет: каждый браузер синтезирует звук сам
// (src/lib/audio/soundboard.ts), по сети идёт только его имя. Как реакции:
// POST /api/sound → data-пакет от сервера всем. Истории нет.
//
// Звук входа — один из тех же звуков: его слышат все, когда человек входит в
// комнату (вместо обычного «вошёл»). Выбирают его в настройках, на сервер он
// приходит с запросом токена (TokenRequest.enterSound).

/** Тема data-пакетов LiveKit, в которых сервер рассылает звуки соундборда. */
export const SOUND_TOPIC = "sound";

/**
 * Вшитые звуки: синтез на Web Audio (запасной набор, пока нет готового). Готовый
 * набор — файлы public/sounds/pack.json, свои звуки комнаты — раздел ниже.
 */
export type BuiltinSoundId = "rimshot" | "tada" | "fail" | "horn" | "crickets" | "correct" | "wrong" | "applause";
export const BUILTIN_SOUND_IDS: readonly BuiltinSoundId[] = [
  "rimshot",
  "tada",
  "fail",
  "horn",
  "crickets",
  "correct",
  "wrong",
  "applause",
];

/**
 * Звук соундборда: имя из вшитых, из готового набора (pack.json) или звук комнаты
 * («c_» + 12 hex). По сети идёт только оно; что за звук, каждый клиент решает сам:
 * неизвестное имя молча не играет. Сервер проверяет только вид имени.
 */
export type SoundId = string;

/**
 * Сколько звуков подряд можно послать: не больше SOUND_BURST за SOUND_WINDOW_MS.
 * Звук мешает разговору сильнее реакции, поэтому окно строже. Клиент держит
 * правило сам; сервер отказывает RATE_LIMITED тем, кто обходит клиент.
 */
export const SOUND_BURST = 3;
export const SOUND_WINDOW_MS = 10_000;

const SOUND_ID_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

/** Похоже ли на имя звука (вид, а не существование). */
export function isSoundId(x: unknown): x is SoundId {
  return typeof x === "string" && SOUND_ID_RE.test(x);
}

/**
 * POST /api/sound — сыграть звук всем в комнате. Кто играет, сервер берёт из
 * подписи токена. Отказы: BAD_REQUEST (неизвестный sound), UNAUTHORIZED,
 * ROOM_NOT_FOUND, NOT_IN_ROOM, FEATURE_DISABLED (флаг soundboard), RATE_LIMITED
 * (с retryAfterSec: часто от человека или от всей комнаты).
 */
export type SoundRequest = { code: string; token: string; sound: SoundId };
export type SoundResponse = { ok: true };

/**
 * Рассылка звука: data-пакет от сервера (participant пустой), тема SOUND_TOPIC,
 * всем, включая автора (он свой звук уже сыграл по клику и эхо пропускает).
 * at — время приёма сервером; играть клиент начинает по получении.
 */
export type SoundPacket = { identity: string; sound: SoundId; at: number };

/** Пакет звука из сети; кривой — null. */
export function parseSoundPacket(raw: unknown): SoundPacket | null {
  if (!isRecord(raw)) return null;
  const { identity, sound, at } = raw;
  if (typeof identity !== "string" || !identity || !isSoundId(sound)) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  return { identity, sound, at };
}

/**
 * Ключ атрибута участника с его звуком входа. Пишет сервер в токен при входе
 * (как AVATAR_ATTRIBUTE — клиенту правка своих атрибутов не дана), поэтому
 * звук известен всем уже в момент ParticipantConnected.
 */
export const ENTER_SOUND_ATTRIBUTE = "sound.enter";

/** Звук входа из participant.attributes; нет или чужой — null (обычный звук «вошёл»). */
export function parseEnterSoundAttribute(attributes: Readonly<Record<string, string>> | undefined): SoundId | null {
  const id = attributes?.[ENTER_SOUND_ATTRIBUTE];
  return isSoundId(id) ? id : null;
}

// ── Игры в комнате ────────────────────────────────────────────────────────────
// Мелочи «перед катку»: кубик, «Кто платит?» (случайный человек из комнаты) и
// «Все готовы?» (каждый отвечает «Готов», итог видят все). Случай считает
// сервер — честно, одинаково для всех; рассылает результат data-пакетом от
// своего имени (тема GAME_TOPIC). Истории нет, состояния на сервере тоже:
// ответы «Готов» собирает каждый клиент сам.

/** Тема data-пакетов LiveKit с играми. */
export const GAME_TOPIC = "game";

/** Сколько идёт «Все готовы?», мс: не ответил за это время — не готов. */
export const READY_CHECK_MS = 30_000;

/** Что сделать: бросить кубик, выбрать случайного, спросить «Все готовы?», ответить. */
export type GameCommand =
  | { action: "dice" }
  | { action: "pick" }
  | { action: "ready" }
  | { action: "ready_answer"; id: string; ready: boolean };
export type GameAction = GameCommand["action"];

/**
 * POST /api/game — игра для всех в комнате. Кто играет, сервер берёт из подписи
 * токена. Отказы: BAD_REQUEST (неизвестное действие, кривой id), UNAUTHORIZED,
 * ROOM_NOT_FOUND, NOT_IN_ROOM, FEATURE_DISABLED (флаг games), RATE_LIMITED (часто
 * от человека; «Все готовы?» — не чаще раза в 20 с на комнату).
 */
export type GameRequest = { code: string; token: string } & GameCommand;
export type GameResponse = { ok: true };

/**
 * Рассылка игры (data-пакет сервера, тема GAME_TOPIC, всем, включая автора):
 *   dice — кто бросил и что выпало (1–6);
 *   pick — кто крутил и на кого выпало (identity из тех, кто сейчас в комнате);
 *   ready — кто спросил «Все готовы?», id опроса;
 *   ready_answer — кто ответил на опрос id и что.
 * at — время сервера; сроки опроса клиент считает по своим часам от получения.
 */
export type GamePacket =
  | { kind: "dice"; identity: string; value: number; at: number }
  | { kind: "pick"; identity: string; chosen: string; at: number }
  | { kind: "ready"; identity: string; id: string; at: number }
  | { kind: "ready_answer"; identity: string; id: string; ready: boolean; at: number };

const GAME_ID_RE = /^[A-Za-z0-9_-]{8,32}$/;

/** Похоже ли на id опроса «Все готовы?». */
export function isGameId(x: unknown): x is string {
  return typeof x === "string" && GAME_ID_RE.test(x);
}

/** Пакет игры из сети; кривой — null. */
export function parseGamePacket(raw: unknown): GamePacket | null {
  if (!isRecord(raw)) return null;
  const { kind, identity, at } = raw;
  if (typeof identity !== "string" || !identity) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  switch (kind) {
    case "dice": {
      const v = raw.value;
      return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 6 ? { kind, identity, value: v, at } : null;
    }
    case "pick":
      return typeof raw.chosen === "string" && raw.chosen ? { kind, identity, chosen: raw.chosen, at } : null;
    case "ready":
      return isGameId(raw.id) ? { kind, identity, id: raw.id, at } : null;
    case "ready_answer":
      return isGameId(raw.id) && typeof raw.ready === "boolean"
        ? { kind, identity, id: raw.id, ready: raw.ready, at }
        : null;
    default:
      return null;
  }
}

// ── Статус участника ──────────────────────────────────────────────────────────
// «В игре», «Отошёл», «Слушаю» и «во что играю» — значком у ника, словами в
// подписи места. Как «звук выкл»: лежит в атрибутах участника, пишет только
// сервер по POST /api/status; после входа заново (новый токен) клиент шлёт снова.

/** Статус: в игре, отошёл (АФК), слушает (не говорит, но здесь). */
export type ManualStatus = "game" | "afk" | "listen";
export const MANUAL_STATUSES: readonly ManualStatus[] = ["game", "afk", "listen"];

/** «Во что играю» — не длиннее стольких символов (кодовых точек). */
export const STATUS_TEXT_MAX = 24;

/** Статус, который видят другие. kind null — статуса нет; text — только у «В игре». */
export type PublicStatus = { kind: ManualStatus | null; text: string };
export const NO_STATUS: PublicStatus = { kind: null, text: "" };

/** Ключи атрибутов участника для PublicStatus. Читает их только клиент (сервер видит camelCase). */
export const STATUS_ATTRIBUTES = { kind: "status.kind", text: "status.text" } as const;

export function isManualStatus(x: unknown): x is ManualStatus {
  return typeof x === "string" && (MANUAL_STATUSES as readonly string[]).includes(x);
}

// Управляющие символы и символы направления текста: ими переворачивают строку.
const STATUS_STRIP = /\p{Cc}|[؜‎‏‪-‮⁦-⁩]/gu;

/** «Во что играю»: без управляющих символов, пробелы схлопнуты, не длиннее STATUS_TEXT_MAX. */
export function cleanStatusText(raw: string): string {
  const text = raw.replace(STATUS_STRIP, "").replace(/\s+/gu, " ").trim();
  return [...text].slice(0, STATUS_TEXT_MAX).join("").trim();
}

/** Статус из participant.attributes; чужое значение — без статуса, текст — только у «В игре». */
export function parseStatusAttributes(attributes: Readonly<Record<string, string>> | undefined): PublicStatus {
  const kind = attributes?.[STATUS_ATTRIBUTES.kind];
  if (!isManualStatus(kind)) return NO_STATUS;
  const text = kind === "game" ? cleanStatusText(attributes?.[STATUS_ATTRIBUTES.text] ?? "") : "";
  return { kind, text };
}

/**
 * POST /api/status — поставить или снять свой статус. text без «В игре»
 * игнорируется. Отказы: BAD_REQUEST, UNAUTHORIZED, NOT_IN_ROOM,
 * FEATURE_DISABLED (флаг statuses), RATE_LIMITED.
 */
export type StatusRequest = { code: string; token: string } & PublicStatus;
export type StatusResponse = { ok: true };

// ── Звуки комнаты (свои, загруженные) ─────────────────────────────────────────
// Любой участник добавляет короткий звук на панель «Звуки»: он лежит на сервере,
// пока жива комната (как её состояние, 48 ч), и появляется у всех. Играет его
// каждый клиент сам, как и остальные звуки; по сети идёт только имя. Список и файл
// отдаёт сервер: GET /api/sounds, GET /api/sounds/<id>.

/** Потолок файла, байт: ≈ 8–10 с mp3 или ogg. Больше — «обрежьте звук». */
export const SOUND_FILE_MAX_BYTES = 300 * 1024;
/** Потолок длины звука, с: мемы короткие, а длинное — это уже музыка поверх разговора. */
export const SOUND_FILE_MAX_SEC = 8;
/** Сколько своих звуков может быть в одной комнате. */
export const SOUND_MAX_PER_ROOM = 12;
/** Название звука на кнопке, символов. */
export const SOUND_NAME_MAX = 18;

/** Свой звук комнаты: имя на кнопке и кто добавил (identity — чтобы убрать свой). */
export type RoomSound = { id: SoundId; name: string; by: string };

/** Тема data-пакета «список звуков комнаты изменился — запросите заново». */
export const SOUNDS_CHANGED_TOPIC = "sounds";

/** Имя своего звука: «c_» + 12 hex от содержимого. Одинаковые файлы — один звук. */
export function isCustomSoundId(x: unknown): x is SoundId {
  return typeof x === "string" && /^c_[0-9a-f]{12}$/.test(x);
}

/**
 * GET /api/sounds?code=КОД с Authorization: Bearer <token> — звуки комнаты.
 * POST /api/sounds { code, token, name, data } — добавить (data — base64 файла).
 * POST /api/sounds { code, token, remove: id } — убрать (свой или хост).
 * Отказы: BAD_REQUEST, UNAUTHORIZED, NOT_IN_ROOM, FEATURE_DISABLED (флаг
 * soundboard_upload), SOUND_INVALID (не звук, слишком большой), SOUND_LIMIT (в
 * комнате уже SOUND_MAX_PER_ROOM), RATE_LIMITED.
 */
export type SoundsListResponse = { sounds: RoomSound[] };
export type SoundUploadRequest = { code: string; token: string; name: string; data: string };
export type SoundRemoveRequest = { code: string; token: string; remove: SoundId };
export type SoundUploadResponse = { ok: true; sound: RoomSound };
export type SoundRemoveResponse = { ok: true };
