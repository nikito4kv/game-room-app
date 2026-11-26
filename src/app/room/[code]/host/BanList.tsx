"use client";

import { useEffect, useState } from "react";
import type { BanEntry } from "@/lib/api/contract";
import { Button, Skeleton, toast } from "@/components/ui";
import { useModeration } from "../state/useModeration";

/**
 * Список банов с «Разбанить». Загружается при открытии настроек: банят из меню
 * участника, а снимают здесь — забаненного в комнате уже нет, кликнуть не по кому.
 */
export default function BanList() {
  const { moderate } = useModeration();
  const [bans, setBans] = useState<BanEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void moderate({ action: "bans" }).then((r) => {
      if (!alive) return;
      if (r.ok) setBans(r.response.bans ?? []);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [moderate]);

  async function unban(entry: BanEntry) {
    setBusy(entry.identity);
    const r = await moderate({ action: "unban", target: entry.identity });
    setBusy(null);
    if (!r.ok) return;
    setBans((list) => list?.filter((b) => b.identity !== entry.identity) ?? null);
    toast({ title: entry.name, description: "снова может зайти в комнату", icon: "check" });
  }

  if (failed) {
    return <p className="text-body text-ink-3">Список не загрузился. Откройте настройки ещё раз.</p>;
  }
  if (!bans) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-2/3" />
      </div>
    );
  }
  if (bans.length === 0) {
    return <p className="text-body text-ink-3">Никого. Забанить можно в меню участника.</p>;
  }
  return (
    <ul className="divide-y divide-line rounded-card border border-line" data-testid="ban-list">
      {bans.map((b) => (
        <li key={b.identity} className="flex items-center gap-3 py-2 pl-4 pr-2">
          <span className="min-w-0 flex-1 truncate text-body text-ink">{b.name}</span>
          <Button
            size="sm"
            variant="ghost"
            loading={busy === b.identity}
            disabled={busy !== null && busy !== b.identity}
            onClick={() => void unban(b)}
            data-testid="unban"
          >
            Разбанить
          </Button>
        </li>
      ))}
    </ul>
  );
}
