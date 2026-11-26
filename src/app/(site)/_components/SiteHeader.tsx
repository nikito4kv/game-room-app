import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { LeadReplyNotice } from "@/components/platform/LeadReplyNotice";
import { NavLink } from "./NavLink";

/**
 * Шапка сайта: знак-надпись (ссылка на главную), метка «Есть ответ на заявку»
 * (если есть) и «Открытые комнаты». Живёт
 * в каркасе (site)/layout.tsx и на страницах-состояниях (404, ошибка). У
 * комнаты своя шапка — эта туда не попадает: комната вне группы (site).
 */
export function SiteHeader() {
  return (
    <header className="mx-auto flex h-16 w-full max-w-[1200px] shrink-0 items-center justify-between gap-3 px-5">
      <Link href="/" aria-label="Game Room, на главную" className="-m-1.5 rounded-control p-1.5">
        <Logo variant="lockup" height={28} title="" className="text-ink" />
      </Link>
      <nav aria-label="Разделы сайта" className="flex items-center gap-2">
        {/* Метка «Есть ответ на заявку» — только если с этого браузера отправляли заявки. */}
        <LeadReplyNotice />
        <NavLink href="/rooms" icon="globe">
          <span className="max-sm:hidden">Открытые комнаты</span>
          <span className="sm:hidden">Комнаты</span>
        </NavLink>
      </nav>
    </header>
  );
}
