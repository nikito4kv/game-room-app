import type { Metadata } from "next";
import { UiRoot } from "@/components/ui/UiRoot";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { AnnouncementBar } from "@/components/platform/AnnouncementBar";
import { SiteHeader } from "../../(site)/_components/SiteHeader";
import RequestClient from "./RequestClient";

// Личная переписка по заявке (А5). Ссылка с токеном (?t=) — у автора заявки;
// в поиск страница не попадает, а сама переписка грузится в браузере (токен в
// серверную разметку не идёт).
export const metadata: Metadata = {
  title: "Ваша заявка",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// В Next.js 16 params — это Promise, поэтому страница асинхронная.
export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <UiRoot className="flex min-h-dvh flex-col">
      <SiteHeader />
      <AnnouncementBar />
      <RequestClient id={id} />
      <SiteFooter />
    </UiRoot>
  );
}
