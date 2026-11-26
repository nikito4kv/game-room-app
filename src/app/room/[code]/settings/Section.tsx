import type { ReactNode } from "react";

/** Раздел вкладки настроек: заголовок (и контрол справа от него) + содержимое. */
export default function Section({
  title,
  aside,
  children,
}: {
  title: string;
  /** Контрол в строке заголовка — например, режим порога. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 className="text-title text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}
