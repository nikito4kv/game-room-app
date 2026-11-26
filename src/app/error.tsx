"use client"; // Границы ошибок в Next — только клиентские компоненты.

import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { Rumik } from "@/components/ui/Rumik";
import { StateScreen } from "@/components/ui/StateScreen";
import { UiRoot } from "@/components/ui/UiRoot";
import { reportError } from "@/lib/observability/sentryClient";
import { SiteHeader } from "./(site)/_components/SiteHeader";

/**
 * Страница упала при отрисовке (на сервере или в браузере). Технический текст
 * не показываем — он уходит в Sentry, если тот включён. Главное действие —
 * «Попробовать снова»: Next заново запросит и отрисует страницу.
 */
export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    reportError(error);
  }, [error]);

  return (
    <UiRoot className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex flex-1 flex-col items-center justify-center px-5 pb-24 pt-8">
        <StateScreen
          // Ошибка застала врасплох: глаза круглые, над плечом «!».
          visual={<Rumik colors={[4, 5, 6, 7]} sticker extra="bang" eyes="wide" tilt={7} />}
          title="Что-то пошло не так"
          actions={
            <>
              <Button variant="primary" size="lg" icon="refresh" block onClick={() => unstable_retry()}>
                Попробовать снова
              </Button>
              <Link href="/" className={buttonClass({ variant: "ghost", block: true })}>
                На главную
              </Link>
            </>
          }
        >
          Страница споткнулась на ошибке. Обычно помогает попробовать ещё раз.
        </StateScreen>
        {error.digest && (
          <p className="mt-6 text-caption text-ink-3">
            Код ошибки для разработчика: <span className="font-code">{error.digest}</span>
          </p>
        )}
      </main>
    </UiRoot>
  );
}
