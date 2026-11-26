"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/icons";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { Logo } from "@/components/ui/Logo";
import { Rumik } from "@/components/ui/Rumik";
import { nextIndex, rovingKey } from "@/components/ui/roving";
import { Skeleton } from "@/components/ui/Spinner";
import { trackPostcard, type RumikPlace } from "@/lib/analytics/rumik";
import { POSTCARD_FILE_NAME, POSTCARD_POSES, renderPostcard } from "@/lib/rumik/postcard";
import type { RumikPose } from "@/lib/rumik/geometry";
import { useMyPaint } from "@/lib/rumik/useMyRumik";

// Окно «Открытка» (R5) — тяжёлая часть открытки: сборка PNG, выбор позы,
// «Скачать» и «Поделиться». Грузится отдельным куском, только когда открытку
// попросили (PostcardButton), поэтому на главной и в лобби её код не качается
// заранее.

export type PostcardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  place: RumikPlace;
  /** Поза живёт в кнопке: помнится между открытиями окна. */
  pose: RumikPose;
  onPose: (pose: RumikPose) => void;
};

/**
 * Открывает окно: выбор позы, превью PNG 1200×630, «Скачать открытку» и
 * «Поделиться» (Web Share с файлом — где браузер умеет). Собирается в браузере
 * (src/lib/rumik/postcard.ts), рисунок никуда не уходит.
 */
export function PostcardDialog({ open, onOpenChange, place, pose, onPose }: PostcardDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Открытка «Мой Румик»"
      description="Картинка для соцсетей и чатов. Собирается в вашем браузере и никуда не отправляется."
      data-testid="rumik-postcard"
    >
      {open && <PostcardBody place={place} pose={pose} onPose={onPose} />}
    </Dialog>
  );
}

/** Что на открытке: поза и рисунок (null — белый Румик). */
type Shown = { pose: RumikPose; paint: string | null };
type Card = Shown & { url: string; file: File };

function same<T extends Shown>(a: T | null, b: Shown): a is T {
  return !!a && a.pose === b.pose && a.paint === b.paint;
}

function PostcardBody({ place, pose, onPose }: { place: RumikPlace; pose: RumikPose; onPose: (p: RumikPose) => void }) {
  const paint = useMyPaint();
  const scopeRef = useRef<HTMLDivElement>(null);
  const srcRef = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [failed, setFailed] = useState<Shown | null>(null);
  const [shareFailed, setShareFailed] = useState(false);
  const option = POSTCARD_POSES.find((p) => p.pose === pose) ?? POSTCARD_POSES[0];

  // Собираем PNG по SVG, которые React уже отрисовал в скрытом блоке ниже.
  useEffect(() => {
    const src = srcRef.current;
    const scope = scopeRef.current;
    const rumik = src?.querySelector<SVGSVGElement>("[data-part=rumik] svg");
    const mark = src?.querySelector<SVGSVGElement>("[data-part=mark] svg");
    const word = src?.querySelector<SVGSVGElement>("[data-part=word] svg");
    if (!scope || !rumik || !mark || !word) return;
    let cancelled = false;
    renderPostcard({ rumik, mark, word }, pose, scope).then(
      (blob) => {
        if (cancelled) return;
        setFailed(null);
        const file = new File([blob], POSTCARD_FILE_NAME, { type: "image/png" });
        setCard({ pose, paint, url: URL.createObjectURL(blob), file });
      },
      (err: unknown) => {
        if (cancelled) return;
        console.warn("postcard:", err);
        setFailed({ pose, paint });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [pose, paint]);

  // Прошлое превью больше не нужно — отпускаем его память.
  useEffect(() => {
    if (!card) return;
    return () => URL.revokeObjectURL(card.url);
  }, [card]);

  const now: Shown = { pose, paint };
  const ready = same(card, now) ? card : null;
  const broken = same(failed, now);
  const canShare =
    !!ready && typeof navigator.share === "function" && !!navigator.canShare?.({ files: [ready.file] });

  async function share() {
    if (!card) return;
    setShareFailed(false);
    try {
      await navigator.share({ files: [card.file], title: "Мой Румик", text: "Мой Румик из Game Room" });
      trackPostcard("shared", place, pose);
    } catch (err) {
      // Закрыли окно «Поделиться» — это не ошибка.
      if (!(err instanceof DOMException && err.name === "AbortError")) setShareFailed(true);
    }
  }

  return (
    <div ref={scopeRef} className="flex flex-col gap-5">
      <div className="relative aspect-[1200/630] w-full overflow-hidden rounded-card border border-line bg-sunken">
        {card ? (
          // eslint-disable-next-line @next/next/no-img-element -- превью из blob: next/image тут не нужен
          <img
            src={card.url}
            alt={`Открытка: ваш Румик, поза «${option.label}», надпись «Мой Румик»`}
            className={cn("block size-full transition-opacity duration-140", !ready && "opacity-60")}
          />
        ) : (
          <Skeleton className="size-full rounded-none" />
        )}
      </div>

      <PosePicker pose={pose} onPose={onPose} paint={paint} />

      {!paint && (
        <p className="-mt-2 text-caption text-ink-3">Румик пока белый. Раскрасьте его в рисовалке, и открытка обновится.</p>
      )}
      {broken && (
        <InlineAlert tone="caution" title="Открытка не собралась">
          Этот браузер не дал нарисовать картинку. Попробуйте ещё раз или откройте сайт в Chrome или Edge.
        </InlineAlert>
      )}
      {shareFailed && <p className="text-caption text-ink-3">Поделиться не получилось. Скачайте открытку и отправьте файлом.</p>}

      <div className="flex flex-wrap justify-end gap-2">
        {canShare && (
          <Button variant="secondary" icon="share" onClick={() => void share()}>
            Поделиться
          </Button>
        )}
        {ready ? (
          <a
            href={ready.url}
            download={POSTCARD_FILE_NAME}
            className={buttonClass({ variant: "primary" })}
            onClick={() => trackPostcard("downloaded", place, pose)}
            data-testid="rumik-postcard-download"
          >
            <Icon name="download" size={18} className="-ml-0.5" />
            Скачать открытку
          </a>
        ) : (
          <Button variant="primary" icon="download" loading={!broken} disabled={broken}>
            Скачать открытку
          </Button>
        )}
      </div>

      {/* Источники открытки: Румик в выбранной позе и логотип. Не видны, их SVG
          копирует сборка (цвета подставляются из токенов этого окна). */}
      <div ref={srcRef} hidden>
        <span data-part="rumik">
          <Rumik colors="white" paint={paint ?? undefined} pose={pose} eyes={option.eyes} sticker />
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

/** Поза открытки: шесть маленьких Румиков с вашим рисунком; стрелки переключают. */
function PosePicker({
  pose,
  onPose,
  paint,
}: {
  pose: RumikPose;
  onPose: (p: RumikPose) => void;
  paint: string | null;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const labelId = useId();
  const index = Math.max(
    0,
    POSTCARD_POSES.findIndex((o) => o.pose === pose),
  );

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const move = rovingKey(e.key, "both");
    if (!move) return;
    e.preventDefault();
    const next = nextIndex(index, move, POSTCARD_POSES.map(() => false));
    onPose(POSTCARD_POSES[next].pose);
    refs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-2">
      <p id={labelId} className="text-label font-medium text-ink-2">
        Поза
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={onKeyDown}
        className="grid grid-cols-3 gap-2 sm:grid-cols-6"
      >
        {POSTCARD_POSES.map((o, i) => {
          const selected = i === index;
          return (
            <button
              key={o.pose}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onPose(o.pose)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-card border px-1 pb-2 pt-2.5",
                "transition-[background-color,border-color] duration-140 ease-swift",
                selected ? "border-ink/70 bg-wash-2" : "border-line hover:border-line-strong hover:bg-wash-1",
              )}
            >
              <Rumik colors="white" paint={paint ?? undefined} pose={o.pose} eyes={o.eyes} size={64} />
              <span className={cn("text-caption", selected ? "text-ink" : "text-ink-2")}>{o.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
