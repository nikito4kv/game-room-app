// Тарифы в одном месте: страница /pricing, блок на главной и таблица берут цены
// отсюда. Цифры — пример сетки тарифов.
// Все платные тарифы пока «Скоро»: оплаты нет, это план.

export type PlanId = "free" | "pro" | "club";
export type Period = "month" | "year";

/** Годовая оплата: 10 месяцев вместо 12 (−17 %), «2 месяца в подарок». */
export const YEAR_NOTE = "2 месяца в подарок";

export const PRICE = {
  pro: { month: "249 ₽", year: "2 490 ₽" },
  clubStart: { month: "990 ₽", year: "9 900 ₽" },
  club: { month: "1 990 ₽", year: "19 900 ₽" },
} as const;

export const PLAN_FEATURES: Record<PlanId, string[]> = {
  free: [
    "Комнаты по ссылке, без регистрации",
    "Голос: шумодав, рация, громкость каждого друга до 200%",
    "Чат с историей для зашедших позже",
    "Показ экрана со звуком: 720p, 1080p, 1440p и режим «Текст»",
    "Права хоста: кик, бан, замок, пароль",
    "Мини-окно поверх игры (Chrome и Edge)",
    "До 10 человек в комнате",
  ],
  pro: [
    "Всё из бесплатного тарифа",
    "Постоянная комната со своим адресом: ссылка остаётся рабочей, даже когда все вышли",
    "Больше мест, чем в бесплатной комнате",
    "История чата дольше, чем сейчас",
    "Свой цвет и название стола",
  ],
  club: [
    "Всё из бесплатного тарифа",
    "Комната клуба со своим названием и адресом",
    "Логотип и цвет клуба на комнате",
    "Несколько залов: отдельные комнаты (на тарифе до 40 ПК)",
    "Кнопка-ссылка в комнату для сайта клуба",
    "Помощь с запуском",
  ],
};

export type ComparisonValue = "yes" | "soon" | "no";
export type ComparisonRow = { label: string; free: ComparisonValue; pro: ComparisonValue; club: ComparisonValue };

/** Что есть сегодня: во всех трёх колонках, платное лишь добавляется сверху. */
export const COMPARISON_NOW: ComparisonRow[] = [
  { label: "Комнаты по ссылке без регистрации", free: "yes", pro: "yes", club: "yes" },
  { label: "Голос: шумодав, рация, громкость каждого", free: "yes", pro: "yes", club: "yes" },
  { label: "Чат", free: "yes", pro: "yes", club: "yes" },
  { label: "Показ экрана со звуком", free: "yes", pro: "yes", club: "yes" },
  { label: "Права хоста: кик, бан, замок, пароль", free: "yes", pro: "yes", club: "yes" },
  { label: "Мини-окно поверх игры", free: "yes", pro: "yes", club: "yes" },
  { label: "До 10 человек в комнате", free: "yes", pro: "yes", club: "yes" },
];

/** Что только планируется: в бесплатном этого нет и не обещано. */
export const COMPARISON_PLANNED: ComparisonRow[] = [
  { label: "Постоянная комната: ссылка не протухает", free: "no", pro: "soon", club: "soon" },
  { label: "Больше мест, чем в бесплатной комнате", free: "no", pro: "soon", club: "soon" },
  { label: "История чата дольше", free: "no", pro: "soon", club: "soon" },
  { label: "Свой цвет и название стола", free: "no", pro: "soon", club: "soon" },
  { label: "Логотип и цвет клуба на комнате", free: "no", pro: "no", club: "soon" },
  { label: "Несколько залов", free: "no", pro: "no", club: "soon" },
  { label: "Кнопка-ссылка для сайта клуба", free: "no", pro: "no", club: "soon" },
  { label: "Помощь с запуском", free: "no", pro: "no", club: "soon" },
];
