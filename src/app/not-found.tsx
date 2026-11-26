import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";
import { Rumik } from "@/components/ui/Rumik";
import { StateScreen } from "@/components/ui/StateScreen";
import { UiRoot } from "@/components/ui/UiRoot";
import { SiteHeader } from "./(site)/_components/SiteHeader";

export const metadata: Metadata = {
  title: "Страница не найдена",
  robots: { index: false },
};

// 404 для любого неизвестного адреса. Комнаты здесь не бывает: несуществующий
// код комнаты показывает лобби («Комнаты K7QMP4 нет»), а сюда попадают опечатки
// в остальном адресе. Главное действие — на главную: там можно ввести код.
export default function NotFound() {
  return (
    <UiRoot className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="flex flex-1 flex-col items-center justify-center px-5 pb-24 pt-8">
        <StateScreen
          // Румик с «?» оглядывается: страницы нет, но ничего страшного.
          visual={<Rumik colors={[6, 7, 8, 5]} sticker extra="q" look={[3, -2]} tilt={-6} />}
          title="Такой страницы нет"
          actions={
            <>
              <Link href="/" className={buttonClass({ variant: "primary", size: "lg", block: true })}>
                На главную
              </Link>
              <Link href="/rooms" className={buttonClass({ variant: "ghost", block: true })}>
                Открытые комнаты
              </Link>
            </>
          }
        >
          Возможно, в ссылке опечатка. Код комнаты можно ввести на главной.
        </StateScreen>
      </main>
    </UiRoot>
  );
}
