// Реквизиты и переключатели для юридических страниц: /privacy, /terms, /offer.
//
// ЕДИНОЕ место, где вписываются реквизиты оператора. Ничего не выдумано:
// `null` означает «ещё не заполнено» — на странице вместо значения стоит заметная
// подсказка в [квадратных скобках], чтобы пропуск нельзя было не заметить.
//
// Тексты страниц — src/app/(site)/_legal/ (шаблон) и privacy|terms|offer/page.tsx.

/** Дата текущей редакции всех трёх документов. Меняется вместе с текстом. */
export const LEGAL_REVISION = {
  /** Как пишем на странице: «Редакция от …». */
  label: "1 октября 2026",
  /** Для <time dateTime>. */
  iso: "2026-10-01",
} as const;

export type LegalField = string | null;

export type LegalEntity = {
  /** ФИО полностью, как в «Мой налог» или в ЕГРИП. */
  operatorName: LegalField;
  /**
   * Правовой статус, одной фразой. Например: «самозанятый, плательщик налога на
   * профессиональный доход» или «индивидуальный предприниматель».
   */
  operatorStatus: LegalField;
  /** ИНН (12 цифр у физлица, самозанятого и ИП). */
  inn: LegalField;
  /** ОГРНИП. Только если статус — ИП; самозанятому оставить null. */
  ogrnip: LegalField;
  /** Почта для обращений: вопросы, удаление данных, жалобы, претензии. */
  contactEmail: LegalField;
  /** Почтовый адрес для претензий. Необязательно для самозанятого; уточнить у юриста. */
  contactAddress: LegalField;
  /**
   * Применимое право и подсудность (решает юрист). Примеры формулировки:
   * «право Российской Федерации; споры рассматривает суд по месту нахождения Исполнителя».
   */
  governingLaw: LegalField;
  /** Платёжный сервис, который принимает оплату (появится при запуске платных тарифов). */
  paymentProvider: LegalField;
  /**
   * Фраза про НДС для оферты: «Исполнитель не является плательщиком НДС» или
   * «цена включает НДС 22 %». Зависит от статуса, решает бухгалтер.
   */
  vatNote: LegalField;
};

/**
 * Реквизиты оператора. В публичной копии не заполнены: `null` показывается на странице
 * подсказкой в [квадратных скобках]. Впишите свои данные перед запуском.
 */
export const LEGAL_ENTITY: LegalEntity = {
  operatorName: null,
  operatorStatus: null,
  inn: null,
  ogrnip: null,
  contactEmail: null,
  contactAddress: null,
  governingLaw: null,
  paymentProvider: null,
  vatNote: null,
};

/**
 * Что реально включено в сборке. Привязано к тем же переменным, что включают код
 * (src/lib/analytics/posthogClient.ts, src/lib/observability/sentryOptions.ts), а
 * не к ручному флажку: страницы статические и собираются вместе с приложением,
 * поэтому текст политики меняется сам, когда ключ появляется в сборке (Dockerfile,
 * build-args). Ключ задан, а раздел политики не перечитан и вопрос про баннер
 * согласия не решён — значит, включать рано.
 */
export const LEGAL_SERVICES = {
  /** PostHog (облако ЕС): включён, если при сборке задан NEXT_PUBLIC_POSTHOG_KEY. */
  analytics: Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY),
  /** Sentry: включён, если при сборке задан NEXT_PUBLIC_SENTRY_DSN. */
  errorReporting: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
} as const;

/** Подсказка вместо пустого поля: «[ФИО оператора]». */
export function legalPlaceholder(hint: string): string {
  return `[${hint}]`;
}
