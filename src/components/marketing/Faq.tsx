import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icons";
import { glueShortWords } from "@/components/ui/typography";

export type FaqItem = { q: string; a: ReactNode };

/**
 * Вопросы и ответы на нативном <details>: открывается без JavaScript, работает с
 * клавиатуры и скринридером «из коробки». Шеврон поворачивается сдвигом
 * (rotate), больше ничего не движется.
 */
export function Faq({ items }: { items: FaqItem[] }) {
  return (
    <div className="divide-y divide-line border-y border-line">
      {items.map((item) => (
        <details key={item.q} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-item py-4 text-body-lg font-medium text-ink transition-colors duration-140 hover:text-ink focus-visible:outline-offset-[-2px] sm:text-title [&::-webkit-details-marker]:hidden">
            <span className="text-pretty">{glueShortWords(item.q)}</span>
            <Icon
              name="chevron-down"
              size={20}
              className="shrink-0 text-ink-3 transition-[rotate] duration-180 ease-swift group-open:rotate-180"
            />
          </summary>
          <div className="max-w-[68ch] space-y-3 pb-5 pr-9 text-body-lg text-ink-2 [&_a]:text-ink [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:text-ink-2">
            {item.a}
          </div>
        </details>
      ))}
    </div>
  );
}
