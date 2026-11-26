"use client"; // Границы ошибок в Next — только клиентские компоненты.

import { useEffect } from "react";
import "./globals.css";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";
import { StateScreen } from "@/components/ui/StateScreen";
import { UiRoot } from "@/components/ui/UiRoot";
import { reportError } from "@/lib/observability/sentryClient";
import { fontVariables } from "./fonts";

/**
 * Последний рубеж: упал сам корневой макет. Этот компонент заменяет его
 * целиком, поэтому сам рисует <html> и <body>, подключает стили и шрифты.
 * Метаданные здесь не работают — заголовок вкладки ставим тегом <title>.
 */
export default function GlobalError({
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
    <html lang="ru" className={`${fontVariables} h-full antialiased`}>
      <body className="min-h-full">
        <title>Что-то пошло не так · Game Room</title>
        <UiRoot className="flex min-h-dvh flex-col">
          <header className="mx-auto flex h-16 w-full max-w-[1200px] items-center px-5">
            <Logo variant="lockup" height={28} className="text-ink" />
          </header>
          <main className="flex flex-1 flex-col items-center justify-center px-5 pb-24 pt-8">
            <StateScreen
              // Без Румика, со значком: этот файл грузится на каждой странице, а экран —
              // последний рубеж, когда сломан корневой макет (DESIGN_SYSTEM.md §8 «Вес»).
              icon="alert-triangle"
              tone="caution"
              title="Сайт споткнулся"
              actions={
                <>
                  <Button variant="primary" size="lg" icon="refresh" block onClick={() => unstable_retry()}>
                    Попробовать снова
                  </Button>
                  {/* Полная загрузка, а не переход роутером: корневой макет только что упал. */}
                  <Button variant="ghost" block onClick={() => window.location.assign("/")}>
                    На главную
                  </Button>
                </>
              }
            >
              Что-то сломалось при загрузке страницы. Попробуйте ещё раз, а если не поможет, откройте главную.
            </StateScreen>
            {error.digest && (
              <p className="mt-6 text-caption text-ink-3">
                Код ошибки для разработчика: <span className="font-code">{error.digest}</span>
              </p>
            )}
          </main>
        </UiRoot>
      </body>
    </html>
  );
}
