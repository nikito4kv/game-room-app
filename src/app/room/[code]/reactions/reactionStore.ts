// Свежие реакции участников (👍 🔥 😂 GG) — хранилище без React, одно на вкладку.
//
// Реакция живёт REACTION_TTL_MS: всплывает над местом, за REACTION_FADE_MS до
// конца тает и пропадает. Подписка — по identity: реакция Бори будит только
// место Бори (его пузырь и жест Румика), а не весь стол (§7 №5). Таймеры
// заводятся только на событие, в покое ничего не тикает.
import { REACTION_BURST, REACTION_WINDOW_MS, type ReactionPacket } from "@/lib/api/contract";
import type { BubbleKind } from "./gesture";

/** Сколько живёт реакция над местом, мс: появление, показ и уход. */
export const REACTION_TTL_MS = 2_000;
/** Уход: за столько до конца пузырь начинает таять (быстрее появления, §3). */
export const REACTION_FADE_MS = 140;

/** Реакция над местом. Один и тот же объект от появления до ухода. */
export type ActiveReaction = {
  kind: BubbleKind;
  /** Когда показали (часы этой вкладки), растёт у каждой новой: ключ анимации. */
  at: number;
};

/** Часы и таймеры: в тестах — ручные. */
export type Clock = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

type Entry = {
  reaction: ActiveReaction;
  leaving: boolean;
  fade: unknown;
  end: unknown;
};

export type ReactionStore = {
  /** Текущая реакция участника или null. */
  get(identity: string): ActiveReaction | null;
  /** Реакция уже тает (последние REACTION_FADE_MS). */
  leaving(identity: string): boolean;
  /** Показать реакцию над местом; прежняя у того же человека сменяется новой. */
  show(identity: string, kind: BubbleKind): ActiveReaction;
  /**
   * Пакет от сервера. Своё эхо пропускаем: своя реакция показана сразу по
   * клику, а повтор по эху всплыл бы второй раз.
   */
  receive(packet: ReactionPacket, myIdentity: string): ActiveReaction | null;
  /** Убрать реакцию, если она всё ещё та же (своя не дошла до сервера). */
  retract(identity: string, reaction: ActiveReaction): void;
  /** Подписка на изменения реакции одного участника. */
  subscribe(identity: string, onChange: () => void): () => void;
  /** Вышли из комнаты: всё убрать и остановить таймеры. */
  clear(): void;
};

export function createReactionStore(clock: Clock = realClock): ReactionStore {
  const entries = new Map<string, Entry>();
  const listeners = new Map<string, Set<() => void>>();

  const notify = (identity: string) => {
    listeners.get(identity)?.forEach((l) => l());
  };

  const drop = (identity: string) => {
    const e = entries.get(identity);
    if (!e) return;
    clock.clearTimeout(e.fade);
    clock.clearTimeout(e.end);
    entries.delete(identity);
    notify(identity);
  };

  const show = (identity: string, kind: BubbleKind): ActiveReaction => {
    const prev = entries.get(identity);
    if (prev) {
      clock.clearTimeout(prev.fade);
      clock.clearTimeout(prev.end);
    }
    // at строго растёт: две реакции в одну миллисекунду — всё равно два всплытия.
    const reaction: ActiveReaction = { kind, at: Math.max(clock.now(), (prev?.reaction.at ?? 0) + 1) };
    const entry: Entry = { reaction, leaving: false, fade: null, end: null };
    entry.fade = clock.setTimeout(() => {
      if (entries.get(identity) !== entry) return;
      entry.leaving = true;
      notify(identity);
    }, REACTION_TTL_MS - REACTION_FADE_MS);
    entry.end = clock.setTimeout(() => {
      if (entries.get(identity) === entry) drop(identity);
    }, REACTION_TTL_MS);
    entries.set(identity, entry);
    notify(identity);
    return reaction;
  };

  return {
    get: (identity) => entries.get(identity)?.reaction ?? null,
    leaving: (identity) => entries.get(identity)?.leaving ?? false,
    show,
    receive(packet, myIdentity) {
      if (packet.identity === myIdentity) return null;
      return show(packet.identity, packet.kind);
    },
    retract(identity, reaction) {
      if (entries.get(identity)?.reaction === reaction) drop(identity);
    },
    subscribe(identity, onChange) {
      let set = listeners.get(identity);
      if (!set) listeners.set(identity, (set = new Set()));
      set.add(onChange);
      return () => {
        set.delete(onChange);
        if (set.size === 0) listeners.delete(identity);
      };
    },
    clear() {
      for (const identity of [...entries.keys()]) drop(identity);
    },
  };
}

/** Хранилище комнаты: пишет ReactionFeed (пакеты) и кнопка дока (свои), читают места. */
export const reactionStore = createReactionStore();

/**
 * Сколько ждать до следующей своей реакции, мс (0 — можно сейчас): не больше
 * burst за windowMs (по умолчанию REACTION_BURST за REACTION_WINDOW_MS; у
 * звуков соундборда — свои). sent — времена прошлых отправок.
 */
export function burstWait(
  sent: readonly number[],
  now: number,
  burst: number = REACTION_BURST,
  windowMs: number = REACTION_WINDOW_MS,
): number {
  const recent = sent.filter((t) => now - t < windowMs).sort((a, b) => a - b);
  if (recent.length < burst) return 0;
  // Можно, когда в окне останется burst − 1 отправка.
  return recent[recent.length - burst] + windowMs - now;
}
