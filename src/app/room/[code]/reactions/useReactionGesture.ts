"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { gestureFor, type ReactionGesture } from "./gesture";
import { reactionStore, type ActiveReaction } from "./reactionStore";

// Тип реакции один на весь проект — из контракта API.
export type { ReactionKind } from "@/lib/api/contract";
export type { ReactionGesture } from "./gesture";

const noReaction = () => null;

/**
 * Свежая реакция участника (≈2 с) или null. Подписка — только на этого
 * участника: реакция соседа это место не перерисует.
 */
export function useActiveReaction(identity: string): ActiveReaction | null {
  const subscribe = useCallback((cb: () => void) => reactionStore.subscribe(identity, cb), [identity]);
  return useSyncExternalStore(subscribe, () => reactionStore.get(identity), noReaction);
}

const REDUCE = "(prefers-reduced-motion: reduce)";
let reduceQuery: MediaQueryList | null = null;
const reduceMedia = () => (reduceQuery ??= window.matchMedia(REDUCE));

function subscribeReduce(onChange: () => void) {
  const mq = reduceMedia();
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const readReduce = () => reduceMedia().matches;
const serverReduce = () => false;

/** Включено ли «меньше движения» в системе (следит за сменой настройки). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduce, readReduce, serverReduce);
}

/**
 * Текущий жест Румика участника или null: поза и глаза на время реакции
 * (👍 машет, 🔥 руки вверх, 😂 держится за живот и жмурится, GG — руки вверх и
 * круглые глаза). Пока реакция тает, жест тот же объект — лишних перерисовок нет.
 * При «меньше движения» жеста нет: Румик не меняет ни позу, ни глаза, о реакции
 * говорит только пузырь над местом.
 */
export function useReactionGesture(identity: string): ReactionGesture | null {
  const reaction = useActiveReaction(identity);
  const calm = useReducedMotion();
  return useMemo(() => (reaction && !calm ? gestureFor(reaction) : null), [reaction, calm]);
}
