import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { glueShortWords } from "@/components/ui/typography";

/**
 * Секция продающих страниц: тонкая линия сверху, колонка 1200, заголовок h2
 * (Unbounded), под ним необязательное пояснение. Заголовки секций — только h2:
 * h1 у страницы один (на главной он в герое).
 *
 * `decor` — украшения бренд-слоя по краям (SideDecor, DecorSquare из ./decor):
 * секция во всю ширину и `relative`, поэтому их отступы считаются от неё.
 */
export function Section({
  id,
  title,
  lead,
  children,
  decor,
  className,
}: {
  id: string;
  title: string;
  lead?: string;
  children: ReactNode;
  decor?: ReactNode;
  className?: string;
}) {
  const titleId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={titleId} className="relative scroll-mt-16 border-t border-line">
      <div className={cn("mx-auto w-full max-w-[1200px] px-5 py-14 sm:py-16 lg:py-20", className)}>
        <div className="max-w-[680px]">
          <h2 id={titleId} className="text-balance font-brand text-heading text-ink sm:text-display">
            {glueShortWords(title)}
          </h2>
          {lead && (
            <p className="mt-3 max-w-[56ch] text-pretty text-body-lg text-ink-2 sm:text-[17px] sm:leading-[1.55]">
              {glueShortWords(lead)}
            </p>
          )}
        </div>
        <div className="mt-8 sm:mt-10">{children}</div>
      </div>
      {decor}
    </section>
  );
}

/** Контейнер без заголовка: герой страниц и узкие блоки в той же колонке 1200. */
export function Container({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-[1200px] px-5", className)}>{children}</div>;
}
