"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/icons";

/**
 * Пункт навигации шапки: тихая кнопка-ссылка. Текущий раздел отмечаем
 * aria-current — скринридер скажет «текущая страница». Клиентский только
 * ради usePathname: каркас общий для нескольких страниц.
 */
export function NavLink({ href, icon, children }: { href: string; icon: IconName; children: ReactNode }) {
  const current = usePathname() === href;
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={buttonClass({ variant: "ghost", size: "sm" })}
    >
      <Icon name={icon} size={16} />
      {children}
    </Link>
  );
}
