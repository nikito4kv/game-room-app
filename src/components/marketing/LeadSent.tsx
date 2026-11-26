"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode, type Ref } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";

export type SentLead = {
  id: string;
  token: string;
  /** Абсолютная личная ссылка с токеном. */
  link: string;
  /** Контакт, если человек его оставил. */
  contact: string | null;
};

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * «Заявка отправлена»: личная ссылка на переписку, «Скопировать» и «Открыть».
 * Ответ придёт туда — поэтому просим сохранить ссылку (в этом браузере она уже
 * сохранена, а на другом устройстве без неё переписку не открыть).
 */
export function LeadSent({ ref, lead, action }: { ref?: Ref<HTMLDivElement>; lead: SentLead; action?: ReactNode }) {
  // null — не нажимали; true — скопировали; false — браузер не дал.
  const [copied, setCopied] = useState<boolean | null>(null);
  useEffect(() => {
    if (copied === null) return;
    const t = window.setTimeout(() => setCopied(null), 2500);
    return () => window.clearTimeout(t);
  }, [copied]);
  const href = `/request/${encodeURIComponent(lead.id)}?t=${encodeURIComponent(lead.token)}`;

  return (
    <div ref={ref} tabIndex={-1} role="status" className="flex flex-col gap-5 outline-none" data-testid="lead-sent">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-signal-wash text-signal-ink">
          <Icon name="check" size={20} />
        </span>
        <div className="min-w-0">
          <h3 className="font-brand text-heading text-ink">Заявка отправлена</h3>
          <p className="mt-1.5 max-w-[56ch] text-pretty text-body-lg text-ink-2">
            Ответ придёт сюда, на сайт, по вашей личной ссылке. Сохраните её: по ней можно вернуться к переписке и
            дописать.
            {lead.contact ? ` Если удобнее, напишем и на ${lead.contact}.` : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-label font-medium text-ink-2">Ваша личная ссылка</span>
        <div className="flex items-center gap-2 rounded-control border border-line-strong bg-sunken py-1 pl-3 pr-1">
          <span className="min-w-0 flex-1 select-all truncate text-body text-ink-2" data-testid="lead-link">
            {lead.link}
          </span>
          <Button
            size="sm"
            variant="secondary"
            icon={copied ? "check" : "copy"}
            onClick={() => void copy(lead.link).then(setCopied)}
          >
            {copied ? "Скопировано" : "Скопировать"}
          </Button>
        </div>
        <p role="status" className="min-h-[18px] text-caption text-ink-3">
          {copied === false
            ? "Не получилось скопировать: выделите ссылку и скопируйте вручную."
            : "В этом браузере ссылка уже сохранена: когда ответим, вверху сайта появится «Есть ответ на заявку»."}
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Link href={href} className={buttonClass({ variant: "primary", size: "lg", className: "max-sm:w-full" })}>
          Открыть переписку
          <Icon name="arrow-right" size={18} className="-mr-1 opacity-70" />
        </Link>
        {action}
      </div>
    </div>
  );
}
