import type { Metadata } from "next";
import { notFound } from "next/navigation";

// Витрина дизайн-системы и макеты экранов — инструмент разработки. В
// продакшене её нет, если явно не задано NEXT_PUBLIC_SHOW_DESIGN=1.
export const metadata: Metadata = {
  title: "Дизайн-система",
  robots: { index: false, follow: false },
};

function designEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_SHOW_DESIGN === "1";
}

export default function DesignLayout({ children }: { children: React.ReactNode }) {
  if (!designEnabled()) notFound();
  return children;
}
