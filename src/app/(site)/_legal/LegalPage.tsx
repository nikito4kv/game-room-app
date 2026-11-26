import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/icons";
import { LEGAL_ENTITY, LEGAL_REVISION, legalPlaceholder, type LegalField } from "@/lib/legalEntity";

// Единый шаблон страницы-документа: /privacy, /terms, /offer, /rules. Серверный компонент,
// без JS: оглавление слева на широком экране (липкое), на узком — раскрывающийся
// список «Содержание» над текстом. Колонка текста — 68ch. Цвета и размеры — только
// токены «Эфира».

export type LegalSection = { id: string; title: string; children: ReactNode };

const DOCS = [
  { href: "/rules", label: "Правила Game Room" },
  { href: "/privacy", label: "Политика конфиденциальности" },
  { href: "/terms", label: "Условия использования" },
  { href: "/offer", label: "Публичная оферта" },
] as const;

export type LegalDocPath = (typeof DOCS)[number]["href"];

const TOC_LINK =
  "block rounded-item px-2.5 py-1.5 text-label text-ink-3 transition-colors duration-140 hover:bg-wash-1 hover:text-ink";

export function LegalPage({
  path,
  title,
  lead,
  banner,
  summary,
  sections,
  revision = LEGAL_REVISION,
}: {
  /** Адрес этой страницы — чтобы в списке документов она не была ссылкой. */
  path: LegalDocPath;
  title: string;
  lead: ReactNode;
  /** Крупная плашка над текстом (оферта: «тарифы ещё не запущены»). */
  banner?: { title: string; text: string };
  /** Блок «Главное коротко» после вступления. */
  summary?: { title: string; children: ReactNode };
  sections: LegalSection[];
  /** Дата редакции, если у документа своя (по умолчанию — общая LEGAL_REVISION). */
  revision?: { label: string; iso: string };
}) {
  const toc = sections.map((s, i) => (
    <li key={s.id}>
      <a href={`#${s.id}`} className={TOC_LINK}>
        <span className="mr-1.5 tabular-nums">{i + 1}.</span>
        {s.title}
      </a>
    </li>
  ));

  return (
    // text-body-lg на корне: от него считается 68ch и ширина всей страницы.
    <main className="mx-auto w-full max-w-[calc(13.75rem+3.5rem+68ch+2.5rem)] flex-1 px-5 pb-20 pt-6 text-body-lg lg:pt-10">
      <div className="grid gap-x-14 lg:grid-cols-[13.75rem_minmax(0,1fr)]">
        <aside className="max-lg:hidden lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:self-start lg:overflow-y-auto">
          <nav aria-label="Содержание">
            <p className="px-2.5 pb-2 text-caption font-medium uppercase tracking-wide text-ink-3">Содержание</p>
            <ol className="flex flex-col gap-0.5">{toc}</ol>
          </nav>
        </aside>

        <div className="min-w-0">
          <header>
            <h1 className="text-balance break-words font-brand text-heading text-ink sm:text-display">{title}</h1>
            <p className="mt-3 text-label text-ink-3">
              Редакция от <time dateTime={revision.iso}>{revision.label}</time>
            </p>
            {banner && (
              <div
                role="note"
                className="mt-6 flex gap-4 rounded-panel border border-caution/30 bg-caution-wash p-5 sm:p-6"
              >
                <Icon name="alert-triangle" size={28} className="mt-0.5 shrink-0 text-caution-ink" />
                <div className="min-w-0">
                  <p className="text-balance font-brand text-heading text-ink">{banner.title}</p>
                  <p className="mt-2 text-body-lg text-ink-2">{banner.text}</p>
                </div>
              </div>
            )}
            <div className="mt-5 space-y-3 text-pretty leading-[1.65] text-ink-2">{lead}</div>
          </header>

          {summary && (
            <Card tone="sunken" padding="md" className="mt-6">
              <p className="text-title text-ink">{summary.title}</p>
              <div className="mt-3">{summary.children}</div>
            </Card>
          )}

          <details className="group mt-6 rounded-card border border-line bg-raised lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-card px-4 py-3 text-body-lg font-medium text-ink [&::-webkit-details-marker]:hidden">
              Содержание
              <Icon
                name="chevron-down"
                size={18}
                className="shrink-0 text-ink-3 transition-[rotate] duration-140 group-open:rotate-180"
              />
            </summary>
            <nav aria-label="Содержание" className="border-t border-line px-2 py-2">
              <ol className="flex flex-col gap-0.5">{toc}</ol>
            </nav>
          </details>

          <article className="mt-10 space-y-10">
            {sections.map((s, i) => (
              <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-6">
                <h2 id={`${s.id}-title`} className="text-title text-ink">
                  <span className="mr-2 tabular-nums text-ink-3">{i + 1}.</span>
                  {s.title}
                </h2>
                <div className="mt-3 space-y-3">{s.children}</div>
              </section>
            ))}
          </article>

          <nav aria-label="Другие документы" className="mt-14 border-t border-line pt-6">
            <p className="text-label text-ink-3">Другие документы</p>
            <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-body-lg">
              {DOCS.map((d) => (
                <li key={d.href}>
                  {d.href === path ? (
                    <span aria-current="page" className="font-medium text-ink">
                      {d.label}
                    </span>
                  ) : (
                    <Link href={d.href} className="text-link underline underline-offset-4">
                      {d.label}
                    </Link>
                  )}
                </li>
              ))}
              <li>
                <Link href="/" className="text-link underline underline-offset-4">
                  На главную
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </main>
  );
}

// ── Кирпичики текста ─────────────────────────────────────────────────────────

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-pretty leading-[1.65] text-ink-2", className)}>{children}</p>;
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 leading-[1.65] text-ink-2 marker:text-ink-3">{children}</ul>;
}

export function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-ink">{children}</strong>;
}

/** Ссылка на другое место сайта или на раздел этой же страницы (#id). */
export function A({ href, children }: { href: string; children: ReactNode }) {
  const cls = "text-link underline underline-offset-4";
  if (href.startsWith("#")) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

/**
 * Поле из legalEntity.ts. Заполнено — просто значение, нет — заметная подсказка в
 * скобках (её нельзя пропустить при вычитке).
 */
export function Fill({ value, hint }: { value: LegalField; hint: string }) {
  if (value) return <>{value}</>;
  return <span className="rounded-key bg-caution-wash px-1.5 py-0.5 text-ink">{legalPlaceholder(hint)}</span>;
}

/** Почта для обращений: ссылка, когда адрес заполнен. */
export function ContactEmail() {
  const email = LEGAL_ENTITY.contactEmail;
  if (!email) return <Fill value={null} hint="почта для обращений" />;
  return (
    <a href={`mailto:${email}`} className="text-link underline underline-offset-4">
      {email}
    </a>
  );
}

/** Строки «название: значение» для реквизитов. */
export function Requisites({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-4 gap-y-2 rounded-card border border-line bg-raised p-4 text-body-lg sm:grid-cols-[10rem_minmax(0,1fr)] sm:p-5">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-ink-3 max-sm:mt-1 max-sm:first:mt-0">{r.label}</dt>
          <dd className="min-w-0 break-words text-ink">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type DataItem = {
  title: string;
  what: ReactNode;
  why: ReactNode;
  term: ReactNode;
};

/** Перечень данных: что это, зачем, на какой срок. Один блок на вид данных. */
export function DataList({ items }: { items: DataItem[] }) {
  return (
    <Card padding="none">
      <ul className="divide-y divide-line">
        {items.map((it) => (
          <li key={it.title} className="px-4 py-4 sm:px-5">
            <h3 className="text-body-lg font-semibold text-ink">{it.title}</h3>
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-body leading-[1.6] sm:grid-cols-[5.5rem_minmax(0,1fr)]">
              <dt className="text-label text-ink-3 sm:pt-px">Что это</dt>
              <dd className="text-ink-2 max-sm:mb-1.5">{it.what}</dd>
              <dt className="text-label text-ink-3 sm:pt-px">Зачем</dt>
              <dd className="text-ink-2 max-sm:mb-1.5">{it.why}</dd>
              <dt className="text-label text-ink-3 sm:pt-px">Сколько</dt>
              <dd className="text-ink-2">{it.term}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </Card>
  );
}
