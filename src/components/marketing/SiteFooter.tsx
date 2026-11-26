import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { Rumik } from "@/components/ui/Rumik";
import { SideDecor } from "./decor/SideDecor";

const LINKS = [
  { href: "/pricing", label: "Тарифы" },
  { href: "/clubs", label: "Для клубов" },
  { href: "/rooms", label: "Открытые комнаты" },
  { href: "/rules", label: "Правила" },
  { href: "/privacy", label: "Политика конфиденциальности" },
  { href: "/terms", label: "Условия" },
] as const;

/**
 * Подвал продающих страниц (главная, /pricing, /clubs). Живёт не в каркасе
 * (site)/layout.tsx, а на самих страницах: так он не лезет в «Открытые комнаты».
 * `sleeper` — спящий Румик на линии подвала слева (украшение главной, от 1400 px).
 */
export function SiteFooter({ sleeper = false }: { sleeper?: boolean }) {
  return (
    <footer className="relative border-t border-line">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-5 py-10 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex max-w-[34ch] flex-col gap-3">
          <Link href="/" aria-label="Game Room, на главную" className="-m-1 w-fit rounded-control p-1">
            <Logo variant="lockup" height={24} title="" className="text-ink" />
          </Link>
          <p className="text-label text-ink-3">Голосовая комната для своей компании. Без регистрации, в браузере.</p>
        </div>
        <nav aria-label="Ссылки внизу страницы">
          <ul className="grid grid-cols-1 gap-x-10 gap-y-0.5 sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-3">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="-mx-2 inline-flex min-h-9 items-center rounded-item px-2 text-body text-ink-2 transition-colors duration-140 hover:bg-wash-2 hover:text-ink"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="mx-auto w-full max-w-[1200px] px-5 pb-8 text-caption text-ink-3">© 2026 Game Room</div>
      {sleeper && (
        <SideDecor side="left" sit>
          <Rumik pose="sit" colors={[6, 7, 8, 5]} sticker eyes="sleep" extra="zzz" tilt={6} />
        </SideDecor>
      )}
    </footer>
  );
}
