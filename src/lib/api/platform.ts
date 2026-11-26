// Контракт «платформа ↔ внутренний API»: типы и константы.
//
// Один файл на обе стороны: сайт (src/) импортирует его как "@/lib/api/platform",
// внешний клиент внутреннего API — как "@platform". Поэтому здесь ТОЛЬКО типы и константы, без
// импортов и без кода, зависящего от окружения.
//
// Слои:
//   • публичные маршруты сайта: /api/config, /api/report, /api/ev, /api/leads…;
//   • внутренний API сайта /api/internal/* — только с заголовком x-internal-token,
//     снаружи закрыт Caddy (404); ходит к нему только доверенный клиент;
//   • клиент внутреннего API (агент на сервере) — слушает только закрытый адрес,
//     пускает по Authorization: Bearer <AGENT_TOKEN>, отдаёт метрики машины и
//     проксирует /app/<путь> → /api/internal/<путь>.

// ───────────────────────────── Общие ─────────────────────────────

/** Заголовок внутреннего API сайта. */
export const INTERNAL_TOKEN_HEADER = "x-internal-token";

/** Порт агента на закрытом адресе. */
export const AGENT_PORT = 9180;

/** Ошибка любого внутреннего/публичного маршрута платформы. */
export type PlatformError = { error: string; message?: string };

// ─────────────────────── Настройки продукта (А3) ───────────────────────

/**
 * Описание переключателя. roomless — флаг проверяется без комнаты (создание
 * комнаты, заявки, страницы сайта): у него только «вкл / выкл», доля комнат и
 * список комнат для него бессмысленны. Сайт отвергает такие правила, админка их
 * не предлагает — обе стороны смотрят сюда.
 */
export type FeatureFlagInfo = { label: string; defaultOn: boolean; roomless?: true };

/**
 * Известные переключатели. Новая фича добавляет сюда своё имя и по умолчанию
 * выключена (правило «фичи выходят обрезанными»). Существующие функции —
 * включены по умолчанию, флаг служит аварийным выключателем.
 */
export const FEATURE_FLAGS = {
  chat: { label: "Чат комнаты", defaultOn: true },
  screen_share: { label: "Показ экрана", defaultOn: true },
  public_rooms: { label: "Витрина публичных комнат", defaultOn: true },
  create_room: { label: "Создание новых комнат", defaultOn: true, roomless: true },
  leads: { label: "Заявки с сайта", defaultOn: true, roomless: true },
  reports: { label: "Кнопка «Пожаловаться»", defaultOn: true },
  access_keys: { label: "Ключи клубов и коды на создание комнат", defaultOn: true, roomless: true },
  rumik_decor: { label: "Украшения сайта: Румики по краям и «стена»", defaultOn: true, roomless: true },
  rumik_editor: { label: "Рисовалка Румика на главной и в лобби", defaultOn: true, roomless: true },
  rumik_table: { label: "Румики за столом в комнате (вместо кружков)", defaultOn: true },
  rumik_share: { label: "Рисунок Румика виден другим в комнате", defaultOn: true },
  reactions: { label: "Реакции в комнате (👍 🔥 😂 GG)", defaultOn: true },
  soundboard: { label: "Соундборд и звук входа", defaultOn: false },
  soundboard_upload: { label: "Свои звуки в соундборде (загрузка в комнату)", defaultOn: false },
  games: { label: "Игры: кубик, «Кто платит?», «Все готовы?»", defaultOn: false },
  statuses: { label: "Статус «в игре / отошёл / слушаю»", defaultOn: false },
  invite_share: { label: "Приглашение: Telegram, VK, текст для Discord и QR-код", defaultOn: false },
  screen_ducking: { label: "Приглушать звук показа, пока говорят", defaultOn: false },
  calendar: { label: "«Собираемся в 21:00» — встреча в календарь (.ics, Google)", defaultOn: false },
  pwa: { label: "Установка сайта как приложения (PWA)", defaultOn: false, roomless: true },
  recap: { label: "«Итоги вечера» — картинка для постинга", defaultOn: false },
} as const satisfies Record<string, FeatureFlagInfo>;
export type FeatureFlagName = keyof typeof FEATURE_FLAGS;

/** Флаг на весь сайт (roomless): только «вкл / выкл». */
export function isRoomlessFlag(name: FeatureFlagName): boolean {
  return (FEATURE_FLAGS[name] as FeatureFlagInfo).roomless === true;
}

export type FlagRule =
  | { mode: "on" }
  | { mode: "off" }
  /** Доля комнат 0–100; комната попадает по устойчивому хэшу своего кода. */
  | { mode: "percent"; percent: number }
  /** Только перечисленные коды комнат (тестовые). */
  | { mode: "list"; rooms: string[] };

export type ScreenQualityCap = "720p" | "1080p" | "1440p";

export type RuntimeLimits = {
  /** Людей в комнате (обычной, без ключа). Потолок сервера — MAX_PARTICIPANTS_HARD. */
  maxParticipants: number;
  /** Сколько живых комнат может быть одновременно; 0 — без ограничения. */
  maxRooms: number;
  /** Новых комнат в минуту на весь сайт; 0 — без ограничения. */
  newRoomsPerMinute: number;
  /** Потолок качества показа экрана для всех. */
  maxScreenQuality: ScreenQualityCap;
  /** Одновременных показов экрана на весь сервер; 0 — без ограничения. */
  maxScreenShares: number;
  /**
   * Суточный бюджет новых рисунков Румика на весь сайт, МБ PNG (сутки по UTC).
   * Повтор уже лежащего рисунка его не тратит. Нет поля (настройки старше этой
   * правки) — значение по умолчанию.
   */
  avatarDayBudgetMb: number;
  /** Новых рисунков на сервере из одной комнаты за 10 минут. Нет поля — по умолчанию. */
  avatarNewPerRoom: number;
};

/**
 * Пределы лимитов рисунков (одни для сайта и админки). Хранилище рисунков за
 * 30 дней (AVATAR_TTL_DAYS) не больше ≈ 40 суточных бюджетов: 8 МБ → ≈ 330 МБ
 * в Redis (base64 на треть тяжелее PNG), 32 МБ → ≈ 1,3 ГБ.
 */
export const AVATAR_LIMIT_BOUNDS = {
  avatarDayBudgetMb: { min: 1, max: 32 },
  avatarNewPerRoom: { min: 1, max: 500 },
} as const;

export type AnnouncementLevel = "info" | "warning" | "critical";

export type Announcement = {
  id: string;
  text: string;
  level: AnnouncementLevel;
  /** Где показывать. */
  where: "site" | "room" | "both";
  /** ISO-время; null — сразу / бессрочно. */
  startsAt: string | null;
  endsAt: string | null;
};

export type Maintenance = {
  enabled: boolean;
  /** Что видит человек. */
  message: string;
  /** Запретить создание новых комнат. */
  blockNewRooms: boolean;
  /** Запретить вход в существующие комнаты (идущие разговоры не рвём). */
  blockJoins: boolean;
};

export type RuntimeConfig = {
  flags: Partial<Record<FeatureFlagName, FlagRule>>;
  limits: RuntimeLimits;
  announcements: Announcement[];
  maintenance: Maintenance;
  /** Растёт на каждую запись; админка шлёт ожидаемый rev (защита от гонки). */
  rev: number;
  updatedAt: string | null;
};

/** Абсолютный потолок людей в комнате (ключи клубов не могут поднять выше). */
export const MAX_PARTICIPANTS_HARD = 25;

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  flags: {},
  limits: {
    maxParticipants: 10,
    maxRooms: 0,
    newRoomsPerMinute: 0,
    maxScreenQuality: "1440p",
    maxScreenShares: 0,
    avatarDayBudgetMb: 8,
    avatarNewPerRoom: 40,
  },
  announcements: [],
  maintenance: { enabled: false, message: "", blockNewRooms: false, blockJoins: false },
  rev: 0,
  updatedAt: null,
};

/** GET /api/config?room=CODE — то, что нужно браузеру (без внутренних деталей). */
export type PublicConfigResponse = {
  /** Флаги, уже вычисленные для этой комнаты (или для сайта, если room не задан). */
  flags: Record<FeatureFlagName, boolean>;
  maxScreenQuality: ScreenQualityCap;
  /** Только активные сейчас объявления для этого места. */
  announcements: Pick<Announcement, "id" | "text" | "level">[];
  maintenance: { enabled: boolean; message: string; blockNewRooms: boolean; blockJoins: boolean };
  /** Текущая версия правил (А7): клиент показывает ссылку и пишет её в событие входа. */
  rulesVersion: string;
};

// ─────────────────────────── События (А4) ───────────────────────────

/** Поток событий в Redis: XADD gr:ev MAXLEN ~ EVENTS_MAXLEN. */
export const EVENTS_STREAM = "gr:ev";
export const EVENTS_MAXLEN = 300_000;

/**
 * Типы событий. Все поля — строки (так их хранит поток Redis); числа — в
 * десятичной записи. ip есть только там, где он нужен для гео и блокировок:
 * админка превращает его в страну/сеть и сам адрес хранит лишь у сигналов.
 */
export type PlatformEvent =
  | { t: "page"; ts: string; path: string; ref?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string; vid?: string; ip?: string }
  | { t: "room_created"; ts: string; code: string; ip?: string; vid?: string; key?: string; isPublic: "0" | "1"; hasPassword: "0" | "1" }
  | { t: "join"; ts: string; code: string; identity: string; ip?: string; vid?: string; owner: "0" | "1"; rules?: string }
  | { t: "join_fail"; ts: string; code: string; reason: string; ip?: string }
  | { t: "leave"; ts: string; code: string; identity: string; durSec?: string }
  | { t: "room_finished"; ts: string; code: string; peak?: string; unique?: string; durSec?: string }
  /**
   * Использование функций: screen_share, chat, ptt, deafen, host_action, avatar
   * (рисунок Румика виден в комнате), reaction… Не чаще раза в минуту на
   * человека и функцию; kind — вид (у reaction — like/fire/lol/gg), тогда раз в
   * минуту на человека и вид.
   */
  | { t: "feature"; ts: string; code: string; name: string; identity?: string; kind?: string }
  /** Рисовалка Румика на витрине (маяк /api/ev): без комнаты и без ника. */
  | { t: "rumik"; ts: string; name: RumikEventName; place: RumikPlace; pose?: string; vid?: string }
  | { t: "signal"; ts: string; kind: SignalKind; severity: Severity; code?: string; identity?: string; ip?: string; detail?: string }
  | { t: "report"; ts: string; reportId: string; code: string; reason: ReportReason }
  | { t: "lead"; ts: string; leadId: string; kind: LeadThreadKind; product: string }
  | { t: "lead_msg"; ts: string; leadId: string }
  | { t: "admin"; ts: string; action: string; code?: string; identity?: string; reason?: string };

export type PlatformEventType = PlatformEvent["t"];

/** Событие, как его отдаёт /api/internal/events: id потока + поля. */
export type StoredEvent = PlatformEvent & { id: string };

/** POST /api/ev — маяк страницы из браузера (sendBeacon, тело — JSON). */
export type PageBeacon = {
  path: string;
  ref?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  /** Случайный id браузера из localStorage (gr:vid), без связи с человеком. */
  vid?: string;
};

/**
 * События рисовалки Румика (R2, R5) — строгий белый список: маяк с другим
 * именем сайт молча отбрасывает. Имена те же, что в PostHog.
 */
export const RUMIK_EVENTS = {
  rumik_editor_opened: "Открыли рисовалку",
  rumik_paint_started: "Начали рисовать",
  rumik_file_saved: "Сохранили рисунок файлом",
  rumik_file_loaded: "Загрузили свой рисунок",
  rumik_postcard_downloaded: "Скачали открытку",
  rumik_postcard_shared: "Поделились открыткой",
} as const;
export type RumikEventName = keyof typeof RUMIK_EVENTS;

/** Где рисовалка: герой главной или окно «Раскрасить» в лобби. */
export const RUMIK_PLACES = { hero: "Главная", lobby: "Лобби" } as const;
export type RumikPlace = keyof typeof RUMIK_PLACES;

/**
 * POST /api/ev с полем ev — событие рисовалки (тот же маяк и тот же лимит, что у
 * страниц). pose — поза открытки (латиница, до 12 символов); vid — как у страниц:
 * по нему админка связывает «нарисовал → создал комнату» на одном браузере.
 */
export type RumikBeacon = { ev: RumikEventName; place: RumikPlace; pose?: string; vid?: string };

// ─────────────────────── Модерация (А2) ───────────────────────

export type Severity = "low" | "medium" | "high";

export const SIGNAL_KINDS = {
  password_fail: "Неверный пароль комнаты",
  password_bruteforce: "Перебор пароля (исчерпан лимит)",
  rate_limited: "Сработал лимит частоты",
  room_spam: "Всплеск создания комнат с одного адреса",
  host_kick: "Хост выгнал участника",
  host_ban: "Хост забанил участника",
  chat_flag: "Подозрительные слова в чате",
  blocked_attempt: "Попытка входа с заблокированного адреса/устройства",
  lead_spam: "Спам в заявках",
  report_spam: "Слишком много жалоб с одного адреса",
} as const;
export type SignalKind = keyof typeof SIGNAL_KINDS;

export const REPORT_REASONS = {
  spam: "Спам или реклама",
  abuse: "Оскорбления, травля",
  illegal: "Незаконный контент",
  nsfw: "Контент 18+",
  cheating: "Читы, мошенничество",
  other: "Другое",
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

/** Причины действий администрации — обязательны при любом действии (А2). */
export const ADMIN_REASONS = {
  spam: "Спам или реклама",
  abuse: "Оскорбления, травля",
  illegal: "Незаконный контент",
  overload: "Перегрузка сервера",
  rules: "Нарушение правил сервиса",
  test: "Проверка / тест",
  other: "Другое",
} as const;
export type AdminReason = keyof typeof ADMIN_REASONS;

/** POST /api/report (из комнаты; автор — по токену LiveKit, как в чате). */
export type ReportRequest = {
  code: string;
  /** Токен участника LiveKit — доказывает, что жалуется человек из комнаты. */
  token: string;
  /** На кого; не задано — на комнату целиком. */
  targetIdentity?: string;
  reason: ReportReason;
  /** До 500 символов. */
  note?: string;
};
export type ReportResponse = { ok: true; id: string };

export type ReportStatus = "new" | "resolved" | "dismissed";

export type StoredReport = {
  id: string;
  code: string;
  reporterIdentity: string;
  reporterName: string | null;
  targetIdentity: string | null;
  targetName: string | null;
  reason: ReportReason;
  note: string;
  createdAt: string;
  status: ReportStatus;
  resolution: string | null;
  /** Последние до 30 сообщений чата на момент жалобы — основание для решения. */
  chatSnapshot: { name: string; text: string; at: number }[];
  /**
   * Рисунок Румика того, на кого жалоба, в момент жалобы (id для
   * /api/internal/avatar/<id> и «Сбросить рисунок»). Нет поля или null — рисунка
   * не было (или жалоба старше R4).
   */
  targetAvatarId?: string | null;
};

/** Блокировка администрацией (Redis gr:block:ip:<ip> / gr:block:dev:<identity>, с TTL). */
export type BlockKind = "ip" | "device";
export type Block = {
  kind: BlockKind;
  value: string;
  reason: AdminReason;
  note: string;
  createdAt: string;
  /** null — бессрочно. */
  until: string | null;
};

/**
 * Причины удаления участника, которые клиент показывает человеку. Сайт уже
 * знает kicked/banned от хоста; администрация добавляет свои.
 */
export const ADMIN_REMOVAL_REASONS = ["admin_kick", "admin_ban", "admin_close"] as const;
export type AdminRemovalReason = (typeof ADMIN_REMOVAL_REASONS)[number];

/** Комната закрыта администрацией: ключ gr:closed:<CODE> (TTL сутки), вход отклоняется. */
export type ClosedRoom = { reason: AdminReason; message: string; at: string };

// ──────────────────── Заявки-диалоги (А5) ────────────────────

export const LEAD_THREAD_KINDS = ["pricing", "club", "event", "other"] as const;
export type LeadThreadKind = (typeof LEAD_THREAD_KINDS)[number];

/** Что человек хочет — свободный список продуктов, админка показывает как есть. */
export const LEAD_PRODUCTS = {
  pro: "Pro для компании",
  club: "Клуб / киберарена",
  community: "Комната сообщества или стримера",
  event: "Событие под ключ (турнир, вечеринка)",
  pass: "Пропуск на вечер",
  gift: "Подарить комнату другу",
  support: "Поддержать проект",
  other: "Другое",
} as const;
export type LeadProduct = keyof typeof LEAD_PRODUCTS;

export type LeadStatus = "new" | "in_progress" | "answered" | "paying" | "closed";

export type LeadMessage = { from: "user" | "team"; text: string; at: string };

/** POST /api/leads — новая заявка. Контакт необязателен (решение 05.10.2026). */
export type LeadCreateRequest = {
  kind: LeadThreadKind;
  product: LeadProduct;
  /** Имя или ник, 1–60. */
  name: string;
  /** Сообщение, 1–2000. */
  message: string;
  /** Необязательно: почта / VK / Telegram — если хочет, чтобы написали туда. */
  contact?: string;
  /** Для клубов: название, город, число ПК — необязательно. */
  clubName?: string;
  city?: string;
  pcCount?: number;
  consent: true;
  /** Источник (utm/реферер), если есть. */
  source?: string;
};
/** Ответ: личная ссылка /request/<id>?t=<token>. Токен показываем один раз. */
export type LeadCreateResponse = { ok: true; id: string; token: string; url: string };

/** GET /api/leads/<id>?t=<token> — то, что видит автор. */
export type LeadThreadPublic = {
  id: string;
  kind: LeadThreadKind;
  product: LeadProduct;
  name: string;
  status: LeadStatus;
  createdAt: string;
  messages: LeadMessage[];
  /** Есть ответ команды, который автор ещё не видел (сбрасывается этим GET). */
  hasUnread: boolean;
};

/** POST /api/leads/<id>/messages { t, text } → обновлённая переписка. */
export type LeadReplyRequest = { t: string; text: string };

/** POST /api/leads/status { items: [{id, t}] } — пометки «есть ответ» для шапки сайта. */
export type LeadStatusBatchRequest = { items: { id: string; t: string }[] };
export type LeadStatusBatchResponse = { items: { id: string; hasUnread: boolean; status: LeadStatus }[] };

/** Полная заявка для админки. */
export type LeadThreadAdmin = LeadThreadPublic & {
  contact: string | null;
  clubName: string | null;
  city: string | null;
  pcCount: number | null;
  source: string | null;
  updatedAt: string;
  lastUserAt: string | null;
  lastTeamAt: string | null;
  /** Заявка перенесена из старого списка leads:v1. */
  migrated: boolean;
};

// ──────────────────── Ключи клубов и коды (А6) ────────────────────

export const ACCESS_KEY_TYPES = {
  club: "Ключ клуба / сообщества",
  pass: "Пропуск на вечер",
  gift: "Подарочный код",
} as const;
export type AccessKeyType = keyof typeof ACCESS_KEY_TYPES;

export type AccessKey = {
  id: string;
  type: AccessKeyType;
  /** Название, которое видят в комнате (клуб) — до 40 символов. */
  label: string;
  /** Цвет бейджа комнаты, #RRGGBB. */
  color: string | null;
  /** Людей в комнате, созданной с ключом (≤ MAX_PARTICIPANTS_HARD). null — как обычно. */
  maxParticipants: number | null;
  /** Срок действия ключа, ISO; null — бессрочно. */
  expiresAt: string | null;
  /** Сколько раз можно создать комнату; null — без ограничения. */
  maxUses: number | null;
  uses: number;
  revoked: boolean;
  createdAt: string;
  /** Последнее использование. */
  lastUsedAt: string | null;
  /** К какой записи админки относится (клуб, платёж) — непрозрачная строка. */
  ref: string | null;
};

/** Выпуск ключа: сам ключ (строка вида GR-XXXX-XXXX-XXXX) возвращается один раз. */
export type AccessKeyCreateRequest = Pick<AccessKey, "type" | "label" | "color" | "maxParticipants" | "expiresAt" | "maxUses" | "ref">;
export type AccessKeyCreateResponse = { key: AccessKey; secret: string };

/** Что видят в комнате, созданной по ключу (часть публичного описания комнаты). */
export type RoomBadge = { label: string; color: string | null };

// ───────────────────── Внутренний API (/api/internal/*) ─────────────────────

export type LiveParticipant = {
  identity: string;
  name: string;
  joinedAt: number;
  isHost: boolean;
  isOwner: boolean;
  micOn: boolean;
  screenSharing: boolean;
  deafened: boolean;
  ptt: boolean;
  /** id рисунка Румика, который видят в комнате; null — без рисунка. Нет поля — сайт старше R4. */
  avatarId?: string | null;
};

export type LiveRoom = {
  code: string;
  title: string;
  isPublic: boolean;
  locked: boolean;
  hasPassword: boolean;
  createdAt: number;
  numParticipants: number;
  maxParticipants: number;
  badge: RoomBadge | null;
  keyId: string | null;
  participants: LiveParticipant[];
  /** Сколько человек сейчас показывают экран. */
  screenShares: number;
  /** Оценка зрителей: на каждый показ — все остальные в комнате. */
  screenViewers: number;
};

/** GET /api/internal/live */
export type LiveResponse = {
  at: string;
  rooms: LiveRoom[];
  totals: { rooms: number; participants: number; screenShares: number; screenViewers: number };
};

/** GET /api/internal/rooms/<code> */
export type RoomDetailResponse = {
  room: LiveRoom | null;
  /** Состояние из Redis, даже если в LiveKit комнаты уже нет. */
  stored: { exists: boolean; createdAt: number | null; hostName: string | null; bans: { identity: string; name: string | null }[] };
  closed: ClosedRoom | null;
  reports: StoredReport[];
};

/** POST /api/internal/rooms/<code>/close */
export type CloseRoomRequest = { reason: AdminReason; note?: string; message?: string };
/** POST /api/internal/rooms/<code>/kick — minutes null = бан в этой комнате навсегда. */
export type KickRequest = { identity: string; minutes: number | null; reason: AdminReason; note?: string };
/** POST /api/internal/rooms/<code>/mute */
export type MuteRequest = { identity: string; reason: AdminReason; note?: string };
/**
 * POST /api/internal/rooms/<code>/avatar-reset — «сбросить рисунок»: скрываются
 * для всех рисунок, который сейчас у участника (сервер читает атрибут сам), и
 * avatarId из запроса — тот, что видела администрация (жалоба, карточка); снова
 * их загрузить нельзя, пока не истечёт срок хранения. У участника в комнате
 * атрибут снимается, и новые рисунки в этой комнате у него не принимаются, пока
 * она жива. 404 no_avatar — сбрасывать нечего. GET /api/internal/avatar/<id> —
 * сама картинка (image/png) для админки, в том числе скрытая (X-Avatar-Hidden: 1),
 * пока жива жалоба; нет — 404.
 */
export type AvatarResetRequest = { identity: string; avatarId?: string; reason: AdminReason; note?: string };
/**
 * avatarId — рисунок, что был у участника (или из запроса); cleared — атрибут
 * снят прямо сейчас; hidden — все скрытые id (нет поля — сайт старше этой правки).
 */
export type AvatarResetResponse = { ok: true; avatarId: string; cleared: boolean; hidden?: string[] };
/** POST /api/internal/rooms/<code>/message — системное сообщение в чат комнаты. */
export type RoomMessageRequest = { text: string };
/** GET /api/internal/rooms/<code>/chat?reason=<AdminReason> — только с причиной. */
export type RoomChatResponse = { messages: { name: string; text: string; at: number }[] };

/** POST /api/internal/blocks — добавить; DELETE /api/internal/blocks?kind=&value= — снять. */
export type BlockCreateRequest = {
  kind: BlockKind;
  /** Адрес или identity. Для kind=ip можно оставить пустым и указать fromParticipant. */
  value: string;
  /**
   * Заблокировать IP участника, не зная его адреса: сайт сам помнит, с какого IP
   * человек вошёл в комнату (gr:ipof:<CODE>:<identity>, живёт 48 ч). Админка IP не видит.
   */
  fromParticipant?: { code: string; identity: string };
  reason: AdminReason;
  note?: string;
  minutes: number | null;
};
export type BlocksResponse = { blocks: Block[] };

/** GET /api/internal/config → RuntimeConfig; PUT с { config, expectedRev }. */
export type ConfigPutRequest = { config: Omit<RuntimeConfig, "rev" | "updatedAt">; expectedRev: number };

/** GET /api/internal/events?after=<id|0>&count=<≤1000> */
export type EventsResponse = { events: StoredEvent[]; last: string | null };

/** GET /api/internal/reports?status=new|all; POST /api/internal/reports/<id> */
export type ReportsResponse = { reports: StoredReport[]; nextCursor?: string | null };
export type ReportUpdateRequest = { status: ReportStatus; resolution?: string };

/** GET /api/internal/leads?status=&cursor= ; GET /api/internal/leads/<id> */
export type LeadsListResponse = { leads: LeadThreadAdmin[]; nextCursor: string | null };
/** POST /api/internal/leads/<id>/reply */
export type LeadAdminReplyRequest = { text: string };
/** POST /api/internal/leads/<id>/status */
export type LeadStatusRequest = { status: LeadStatus };

/** GET /api/internal/keys ; POST /api/internal/keys ; POST /api/internal/keys/<id>/revoke */
export type AccessKeysResponse = { keys: AccessKey[] };

/**
 * GET /api/internal/avatars — хранилище рисунков Румика (карточка «Здоровья»).
 * Ключи считаются проходом SCAN по шаблону gr:avatar* (с потолком шагов) и
 * держатся в кэше сайта минуту; бюджет дня читается свежим.
 */
export type AvatarStorageResponse = {
  at: string;
  /** Когда пересчитаны count/bytes/hidden (кэш до минуты). */
  countedAt: string;
  /** Рисунков, которые видят в комнатах (gr:avatar:<id>). */
  count: number;
  /** Сколько они занимают в Redis, байт (строки base64, без служебных расходов Redis). */
  bytes: number;
  /** Скрытых администрацией: лежат для жалоб и журнала (gr:avatarhidden:<id>). */
  hidden: number;
  hiddenBytes: number;
  /** Проход не дошёл до конца (потолок шагов SCAN): числа — нижняя оценка. */
  partial: boolean;
  /** Новые рисунки за сутки (UTC): потрачено байт PNG (с отказами сверх бюджета) и потолок. */
  today: { date: string; usedBytes: number; budgetBytes: number };
  /** Новых рисунков из одной комнаты за 10 минут (из настроек). */
  newPerRoom: number;
  /** Срок хранения после последнего использования, дней. */
  ttlDays: number;
};

/** GET /api/internal/health — сайт о себе. */
export type AppHealthResponse = {
  ok: boolean;
  version: { commit: string | null; builtAt: string | null };
  redis: { ok: boolean; latencyMs: number | null };
  livekit: { ok: boolean; latencyMs: number | null };
  config: { rev: number; updatedAt: string | null };
};

// ───────────────────────── Агент (А0.4) ─────────────────────────

/** GET /host */
export type AgentHost = {
  at: string;
  hostname: string;
  uptimeSec: number;
  cpu: { cores: number; usagePct: number; load1: number; load5: number; load15: number };
  mem: { totalBytes: number; availableBytes: number };
  disk: { totalBytes: number; freeBytes: number };
  /** Счётчики основного сетевого интерфейса с загрузки машины (сбрасываются при перезагрузке). */
  net: { iface: string; rxBytes: number; txBytes: number };
};

export type ServiceCheck = { name: string; ok: boolean; latencyMs: number | null; detail?: string };

/** GET /services */
export type AgentServices = {
  at: string;
  checks: ServiceCheck[];
  redis: {
    ok: boolean;
    usedMemoryBytes: number | null;
    aofEnabled: boolean | null;
    lastSaveAt: string | null;
    /** Ключей в базе. */
    keys: number | null;
  };
  /** Срок сертификатов по именам. */
  certs: { name: string; expiresAt: string | null; daysLeft: number | null }[];
  backup: { lastAt: string | null; file: string | null; sizeBytes: number | null };
};

/** GET /livekit — выжимка из метрик LiveKit (127.0.0.1:6789/metrics). */
export type AgentLivekit = {
  at: string;
  ok: boolean;
  rooms: number | null;
  participants: number | null;
  tracksPublished: number | null;
  /** Суммарно отправлено LiveKit байт с запуска (по счётчикам Prometheus). */
  bytesOut: number | null;
  bytesIn: number | null;
  packetLossPct: number | null;
};

/** GET /backup/latest — сам файл (application/gzip), заголовок x-backup-file. */
export const AGENT_BACKUP_FILE_HEADER = "x-backup-file";

// ───────────────────────── Правила (А7) ─────────────────────────

/** Версия правил сервиса; меняется при изменении текста /rules. */
export const RULES_VERSION = "2026-10-05";
