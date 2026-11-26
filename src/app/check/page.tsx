import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { UiRoot } from "@/components/ui/UiRoot";
import { CheckClient } from "./_components/CheckClient";

// «Проверка связи»: страницу открывает друг или владелец клуба из своей сети, нажимает
// одну кнопку и получает вывод и текст отчёта. Нужна, чтобы узнать, работает ли сайт и
// голос из сетей РФ без VPN. Страница не для поиска.

export const metadata: Metadata = {
  title: "Проверка связи",
  description: "Проверка, открывается ли Game Room и слышно ли голос из вашей сети.",
  robots: { index: false, follow: false, nocache: true },
};

export default function CheckPage() {
  // Публичный адрес сервера голоса: тот же, что клиент получает при входе в комнату
  // (NEXT_PUBLIC_LIVEKIT_URL вшивается в сборку). Секретов тут нет.
  const voiceUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL || null;
  // Имя сервера TURN: если не задано, страница выводит turn.… из адреса голоса rtc.….
  const turnDomain = process.env.NEXT_PUBLIC_TURN_DOMAIN || null;
  return (
    <UiRoot className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-16 w-full max-w-[720px] shrink-0 items-center px-5">
        <Link href="/" aria-label="Game Room, на главную" className="-m-1.5 rounded-control p-1.5">
          <Logo variant="lockup" height={28} title="" className="text-ink" />
        </Link>
      </header>
      <main className="mx-auto w-full max-w-[720px] flex-1 px-5 pb-16 pt-4 sm:pt-8">
        <noscript>
          <p className="text-body text-ink-2">Для проверки нужен включённый JavaScript.</p>
        </noscript>
        <CheckClient voiceUrl={voiceUrl} turnDomain={turnDomain} />
      </main>
    </UiRoot>
  );
}
