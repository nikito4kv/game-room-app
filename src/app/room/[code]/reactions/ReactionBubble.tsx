"use client";

import { useCallback, useSyncExternalStore } from "react";
import { cn } from "@/components/ui/cn";
import { Glyph } from "@/components/ui/Glyph";
import { BUBBLE_VIEW } from "./gesture";
import { reactionStore } from "./reactionStore";
import { useActiveReaction } from "./useReactionGesture";

const notLeaving = () => false;

/**
 * Реакция над местом участника (👍 🔥 😂 GG) или значок звука соундборда
 * (🥁, 🎉…): всплывает на пару секунд и исчезает. Стол ставит её в каждое место внутрь обёртки `relative` вокруг
 * головы; пузырь сам встаёт по центру над ней. Корень помечен data-reaction
 * (значение — вид реакции): стол переставляет пузырь вбок классами обёртки
 * `[&>[data-reaction]]:…`, поэтому позиция — только классами, без inline-стилей.
 *
 * Появление — @starting-style (200 мс), уход быстрее (140 мс), только opacity и
 * scale/translate; при «меньше движения» без движения. В покое ничего не тикает.
 * Для скринридера пузырь скрыт: реакции другим объявляет ReactionFeed.
 */
export function ReactionBubble({ identity }: { identity: string }) {
  const reaction = useActiveReaction(identity);
  const subscribe = useCallback((cb: () => void) => reactionStore.subscribe(identity, cb), [identity]);
  const leaving = useSyncExternalStore(subscribe, () => reactionStore.leaving(identity), notLeaving);
  if (!reaction) return null;
  return (
    <span
      data-reaction={reaction.kind}
      aria-hidden="true"
      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2"
    >
      {/* key: следующая реакция того же человека всплывает заново. */}
      <span
        key={reaction.at}
        className={cn(
          "grid h-9 min-w-9 origin-bottom place-items-center rounded-full border border-line bg-overlay px-2 shadow-float",
          "select-none whitespace-nowrap leading-none transition-[opacity,scale,translate] ease-swift",
          leaving
            ? "opacity-0 duration-140 motion-safe:scale-90"
            : "duration-200 starting:opacity-0 motion-safe:starting:translate-y-1.5 motion-safe:starting:scale-50",
        )}
      >
        <Glyph spec={BUBBLE_VIEW[reaction.kind].glyph} size={20} />
      </span>
    </span>
  );
}
