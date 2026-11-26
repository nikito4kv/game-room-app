"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Icon, InlineAlert, Logo, Rumik, Skeleton, buttonClass } from "@/components/ui";
import { avatarColorIndex } from "@/components/ui/avatarColor";
import type { Recap } from "@/lib/room/recap";
import { RECAP_FILE_NAME, recapSubtitle, recapSummary, recapTiles, renderRecapCard } from "@/lib/room/recapCard";
import { useMyPaint } from "@/lib/rumik/useMyRumik";

/**
 * «Итоги вечера» (флаг recap): превью картинки 1200×630 и «Скачать картинку» /
 * «Поделиться» (Web Share с файлом — где браузер умеет). Картинка собирается в
 * браузере (src/lib/room/recapCard.ts) и никуда не уходит. Те же итоги — текстом
 * под превью: картинку видят не все (скринридер, сбой холста).
 */
export function RecapDialog({
  open,
  onOpenChange,
  recap,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recap: Recap | null;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Итоги вечера"
      description="Картинка для чата и соцсетей. Числа — то, что видел ваш браузер, пока вы были в комнате."
      data-testid="recap-dialog"
    >
      {open && recap && <RecapBody recap={recap} />}
    </Dialog>
  );
}

type Card = { url: string; file: File };

function RecapBody({ recap }: { recap: Recap }) {
  const paint = useMyPaint();
  const scopeRef = useRef<HTMLDivElement>(null);
  const srcRef = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [broken, setBroken] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);
  const tiles = recapTiles(recap);

  useEffect(() => {
    const src = srcRef.current;
    const scope = scopeRef.current;
    const rumik = src?.querySelector<SVGSVGElement>("[data-part=rumik] svg");
    const mark = src?.querySelector<SVGSVGElement>("[data-part=mark] svg");
    const word = src?.querySelector<SVGSVGElement>("[data-part=word] svg");
    if (!scope || !rumik || !mark || !word) return;
    let cancelled = false;
    renderRecapCard(recap, { rumik, mark, word }, scope).then(
      (blob) => {
        if (cancelled) return;
        setCard({ url: URL.createObjectURL(blob), file: new File([blob], RECAP_FILE_NAME, { type: "image/png" }) });
      },
      (err: unknown) => {
        if (cancelled) return;
        console.warn("recap:", err);
        setBroken(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [recap, paint]);

  useEffect(() => {
    if (!card) return;
    return () => URL.revokeObjectURL(card.url);
  }, [card]);

  const canShare = !!card && typeof navigator.share === "function" && !!navigator.canShare?.({ files: [card.file] });
  async function share() {
    if (!card) return;
    setShareFailed(false);
    try {
      await navigator.share({
        files: [card.file],
        title: "Итоги вечера",
        text: `Итоги вечера в Game Room · ${recap.title}`,
      });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) setShareFailed(true);
    }
  }

  return (
    <div ref={scopeRef} className="flex flex-col gap-5">
      <div className="relative aspect-[1200/630] w-full overflow-hidden rounded-card border border-line bg-sunken">
        {card ? (
          // eslint-disable-next-line @next/next/no-img-element -- превью из blob: next/image тут не нужен
          <img src={card.url} alt={recapSummary(recap)} className="block size-full" />
        ) : broken ? null : (
          <Skeleton className="size-full rounded-none" />
        )}
      </div>

      <section aria-label="Итоги вечера" className="flex flex-col gap-3" data-testid="recap-cells">
        <p className="text-label text-ink-2">{recapSubtitle(recap)}</p>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {tiles.map((t) => (
            <li
              key={t.caption}
              className="flex min-w-0 items-center gap-3 rounded-card border border-line bg-wash-1 p-2.5"
              data-testid="recap-tile"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-wash-2 text-ink-2">
                <Icon name={t.icon} size={16} />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-brand text-title font-semibold text-ink">{t.value}</span>
                <span className="block truncate text-caption text-ink-3">{t.caption}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {broken && (
        <InlineAlert tone="caution" title="Картинка не собралась">
          Этот браузер не дал нарисовать картинку. Итоги выше — их можно переписать в чат.
        </InlineAlert>
      )}
      {shareFailed && (
        <p className="text-caption text-ink-3">Поделиться не получилось. Скачайте картинку и отправьте файлом.</p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {canShare && (
          <Button variant="secondary" icon="share" onClick={() => void share()}>
            Поделиться
          </Button>
        )}
        {card ? (
          <a
            href={card.url}
            download={RECAP_FILE_NAME}
            className={buttonClass({ variant: "primary" })}
            data-testid="recap-download"
          >
            <Icon name="download" size={18} className="-ml-0.5" />
            Скачать картинку
          </a>
        ) : (
          <Button variant="primary" icon="download" loading={!broken} disabled={broken}>
            Скачать картинку
          </Button>
        )}
      </div>

      {/* Источники картинки: ваш Румик с поднятыми руками и логотип. Не видны,
          их SVG копирует сборка (цвета — из токенов этого окна). */}
      <div ref={srcRef} hidden>
        <span data-part="rumik">
          <Rumik
            colors={paint ? "white" : avatarColorIndex(recap.title)}
            paint={paint ?? undefined}
            pose="cheer"
            eyes="wide"
            sticker
          />
        </span>
        <span data-part="mark">
          <Logo variant="mark" title="" />
        </span>
        <span data-part="word">
          <Logo variant="wordmark" title="" />
        </span>
      </div>
    </div>
  );
}
