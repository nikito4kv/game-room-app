"use client";

// Мини-комната поверх игры (Document Picture-in-Picture, Chrome/Edge 116+).
// Окно маленькое и живёт поверх игры в оконном режиме: кто говорит + две
// кнопки. Ничего лишнего, всё читается боковым зрением. Внутри окна —
// тот же React через портал, поэтому те же примитивы и токены. Люди — головы
// Румиков (LiveAvatar → RumikAvatar, флаг rumik_table), реакция — пузырь
// поверх головы: над ней в маленьком окне места нет (PipRoom.tsx).

import { Icon, IconButton, Logo, SignalBars, UiRoot, cn } from "@/components/ui";
import { RumikAvatar } from "@/components/ui/Avatar";
import { useMyPaint } from "@/lib/rumik/useMyRumik";
import { PEOPLE, ROOM, type MockPerson } from "./data";
import { FakeScreen } from "./room-parts";
import type { GlyphSpec } from "@/components/ui/Glyph";
import { REACTION_VIEW } from "@/app/room/[code]/reactions/gesture";
import { ReactionBubbleSample } from "./rumikSamples";

/** Реакция в макете: Ника только что нажала «огонь». */
const REACTION: Record<string, GlyphSpec> = { nika: REACTION_VIEW.fire.glyph };

/** Голова участника с пузырём реакции поверх (как PipPerson в комнате). */
function PipHead({ p, size, paint }: { p: MockPerson; size: "md" | "sm"; paint: string | null }) {
  const glyph = REACTION[p.id];
  return (
    <span className="relative inline-flex">
      <RumikAvatar
        name={p.name}
        colorIndex={p.colorIndex}
        paint={p.me ? paint : null}
        size={size}
        speaking={p.speaking}
        status={p.status}
      />
      {glyph && <ReactionBubbleSample glyph={glyph} className="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />}
    </span>
  );
}

export function PipContent({ size = "md" }: { size?: "md" | "sm" }) {
  const people = PEOPLE;
  // Свой рисунок — из рисовалки этого браузера, как в комнате.
  const paint = useMyPaint();
  const talker = people.find((p) => p.speaking);
  if (size === "sm") {
    return (
      <div className="flex h-full items-center gap-2 bg-canvas px-2.5">
        <ul className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden" aria-label="Участники">
          {people.map((p) => (
            <li key={p.id}>
              <PipHead p={p} size="sm" paint={paint} />
            </li>
          ))}
        </ul>
        <IconButton icon="mic" label="Выключить микрофон" shortcut="M" variant="soft" size="md" shape="round" tooltip={false} />
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <Logo variant="mark" height={16} title="" className="shrink-0 text-ink" />
        <span className="min-w-0 truncate text-label font-medium text-ink">{ROOM.title}</span>
        <span className="ml-auto flex items-center gap-1.5 text-caption tabular-nums text-ink-3">
          <SignalBars quality="excellent" />
          42 мс
        </span>
      </div>
      <ul className="flex flex-1 items-center justify-center gap-3 px-3" aria-label="Участники">
        {people.map((p) => (
          <li key={p.id} className="flex w-[50px] flex-col items-center gap-1.5">
            <PipHead p={p} size="md" paint={paint} />
            <span className={cn("w-full truncate text-center text-caption", p.speaking ? "text-ink" : "text-ink-3")}>
              {p.me ? "Вы" : p.name.split(" ")[0]}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 px-3 pb-3">
        <IconButton icon="mic" label="Выключить микрофон" shortcut="M" variant="soft" size="md" shape="round" tooltip={false} />
        <IconButton icon="headphones" label="Выключить звук" shortcut="D" variant="soft" size="md" shape="round" tooltip={false} />
        <span className="min-w-0 flex-1 truncate text-caption text-ink-3">
          {talker ? (
            <>
              Говорит <span className="text-ink">{talker.name}</span>
            </>
          ) : (
            "Тихо"
          )}
        </span>
        <IconButton icon="maximize" label="Вернуться в комнату" size="sm" tooltip={false} />
      </div>
    </div>
  );
}

/** Рамка окна PiP, как её рисует Chrome: тонкая шапка с «назад к вкладке». */
function PipFrame({ width, height, children, className }: { width: number; height: number; children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn("absolute overflow-hidden rounded-[10px] border border-[rgb(255_255_255/0.14)] bg-[#202124] shadow-[0_18px_50px_-10px_rgb(0_0_0/0.7)]", className)}
      style={{ width, height: height + 28 }}
    >
      <div className="flex h-7 items-center gap-2 px-2.5 text-[11px] text-[#c4c7c5]">
        <Icon name="arrow-left" size={13} />
        <span className="truncate">club.game-room.space</span>
        <Icon name="x" size={13} className="ml-auto" />
      </div>
      <div data-ui="" style={{ height }} className="text-ink">
        {children}
      </div>
    </div>
  );
}

export function PipMock() {
  return (
    <UiRoot className="fixed inset-0 overflow-hidden">
      <FakeScreen className="absolute inset-0" />
      <div className="absolute left-5 top-5 max-w-[440px] rounded-card bg-[rgb(0_0_0/0.55)] p-4 text-white">
        <p className="text-title">Мини-комната поверх игры</p>
        <p className="mt-1 text-label text-white/75">
          Окно Document Picture-in-Picture (Chrome, Edge). Игра должна идти в окне или без рамки.
          Вверху справа обычный размер (360×184), внизу сжатый (260×64). Люди — головы Румиков, реакция
          всплывает поверх головы.
        </p>
      </div>
      <PipFrame width={360} height={184} className="right-6 top-6">
        <PipContent />
      </PipFrame>
      <PipFrame width={260} height={64} className="bottom-6 right-6">
        <PipContent size="sm" />
      </PipFrame>
    </UiRoot>
  );
}
