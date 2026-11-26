"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import type { LeadProduct } from "@/lib/api/platform";
import { LeadForm } from "./LeadForm";

// Заявка со страницы тарифов: одна форма в диалоге на всю страницу. Кнопки
// «Написать нам» в карточках тарифов открывают её через контекст (useWaitlist)
// с нужным продуктом. Платежей нет: форма — сообщение команде, ответ придёт на
// сайт по личной ссылке, и в тексте это сказано прямо.

type WaitlistContext = { open: (product: LeadProduct) => void };
const Ctx = createContext<WaitlistContext | null>(null);

export function useWaitlist(): WaitlistContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWaitlist вне <WaitlistRoot>");
  return ctx;
}

const INTRO: Partial<Record<LeadProduct, { badge: string; text: string }>> = {
  pro: {
    badge: "Pro для хоста",
    text: "Наш план: 249 ₽ в месяц или 2 490 ₽ в год. Оплаты пока нет.",
  },
  club: {
    badge: "Клуб",
    text: "Наш план: от 990 ₽ в месяц за точку. Первый месяц бесплатно по пилоту. Оплаты пока нет.",
  },
  support: {
    badge: "Поддержать проект",
    text: "Способа поддержать пока нет. Напишите, как хотели бы помочь, и мы ответим здесь же, на сайте.",
  },
};

/** Варианты «что хочу» на странице тарифов. */
const PRICING_PRODUCTS: readonly LeadProduct[] = ["pro", "club", "community", "event", "pass", "gift", "support", "other"];

export function WaitlistRoot({ children }: { children: ReactNode }) {
  const [product, setProduct] = useState<LeadProduct>("pro");
  const [open, setOpen] = useState(false);
  // Новый ключ на каждое открытие: форма начинается с чистого листа.
  const [session, setSession] = useState(0);

  const openFor = useCallback((next: LeadProduct) => {
    setProduct(next);
    setSession((n) => n + 1);
    setOpen(true);
  }, []);
  const value = useMemo(() => ({ open: openFor }), [openFor]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <WaitlistDialog key={session} open={open} onOpenChange={setOpen} product={product} />
    </Ctx.Provider>
  );
}

function WaitlistDialog({
  open,
  onOpenChange,
  product,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: LeadProduct;
}) {
  const [sent, setSent] = useState(false);
  const intro = INTRO[product];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={sent ? "Готово" : "Написать нам"}
      description={
        sent
          ? undefined
          : "Тарифы ещё не запущены, платить сейчас не нужно. Напишите, что вам нужно, — ответим здесь же, на сайте."
      }
      size="md"
      data-testid="lead-dialog"
    >
      <LeadForm
        defaultProduct={product}
        products={PRICING_PRODUCTS}
        intro={
          intro && (
            <div className="flex flex-col gap-2 rounded-card border border-line bg-wash-1 p-3.5">
              <Badge variant="outline" className="self-start">
                {intro.badge} · скоро
              </Badge>
              <p className="text-label text-ink-2">{intro.text}</p>
            </div>
          )
        }
        messageHint="Что вам нужно и что важнее всего. Можно просто задать вопрос."
        onSent={() => setSent(true)}
        sentAction={
          <Button variant="ghost" size="lg" onClick={() => onOpenChange(false)} className="max-sm:w-full">
            Закрыть
          </Button>
        }
      />
    </Dialog>
  );
}
