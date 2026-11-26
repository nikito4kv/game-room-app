// Приём реакций и звуков соундборда для ReactionFeed — чистые функции без React
// (тест рядом): какой data-пакет принять и что сказать скринридеру.
import {
  REACTION_TOPIC,
  SOUND_TOPIC,
  parseReactionPacket,
  parseSoundPacket,
  type ReactionPacket,
  type SoundPacket,
} from "@/lib/api/contract";

import { realClock, type Clock } from "./reactionStore";

const decoder = new TextDecoder();

/**
 * Data-пакет LiveKit → реакция или null. Принимаем только пакеты СЕРВЕРА с темой
 * REACTION_TOPIC: у них participant пустой. Свои data-пакеты клиентам запрещены,
 * поэтому пакет от участника — подделка (реакция от чужого имени): отбрасываем.
 * Кривой JSON и неизвестная реакция — тоже null.
 */
export function readReactionData(
  payload: Uint8Array,
  participant: object | null | undefined,
  topic: string | undefined,
): ReactionPacket | null {
  if (topic !== REACTION_TOPIC || participant != null) return null;
  try {
    return parseReactionPacket(JSON.parse(decoder.decode(payload)));
  } catch {
    return null;
  }
}

/**
 * Data-пакет LiveKit → звук соундборда или null. Правила те же, что у реакций:
 * только пакеты сервера (participant пустой) с темой SOUND_TOPIC.
 */
export function readSoundData(
  payload: Uint8Array,
  participant: object | null | undefined,
  topic: string | undefined,
): SoundPacket | null {
  if (topic !== SOUND_TOPIC || participant != null) return null;
  try {
    return parseSoundPacket(JSON.parse(decoder.decode(payload)));
  } catch {
    return null;
  }
}

/** «3 раза», «5 раз», «21 раз». */
function times(n: number): string {
  const d = n % 10;
  const h = n % 100;
  return `${n} ${d >= 2 && d <= 4 && (h < 12 || h > 14) ? "раза" : "раз"}`;
}

/**
 * Что сказать скринридеру: «Боря: огонь»; склеенные — «Боря: огонь 3 раза,
 * смешно» (виды в порядке прихода). Ник не склоняем.
 */
export function reactionPhrase(name: string, words: ReadonlyMap<string, number>): string {
  const parts = [...words].map(([word, n]) => (n > 1 ? `${word} ${times(n)}` : word));
  return `${name}: ${parts.join(", ")}`;
}

/**
 * Реакции одного человека объявляем не чаще раза в столько: флуд (до 10 за 5 с)
 * не должен засыпать скринридер. Что пришло в паузе — одной фразой в её конце.
 */
export const ANNOUNCE_GAP_MS = 2_000;

export type ReactionAnnouncer = {
  /** Реакция человека: сказать сейчас или склеить с ближайшим объявлением. */
  push(identity: string, name: string, word: string): void;
  /** Ушли из комнаты: отложенное не говорить, таймеры остановить. */
  clear(): void;
};

/**
 * Очередь объявлений по людям. say зовётся с готовой фразой; повтор той же фразы —
 * тоже новый вызов (live-область сама решает, как его объявить). Таймер — только
 * пока есть отложенное, в покое ничего не тикает.
 */
export function createReactionAnnouncer(say: (text: string) => void, clock: Clock = realClock): ReactionAnnouncer {
  const lastSaid = new Map<string, number>();
  const pending = new Map<string, { name: string; kinds: Map<string, number>; timer: unknown }>();

  const flush = (identity: string) => {
    const p = pending.get(identity);
    if (!p) return;
    pending.delete(identity);
    lastSaid.set(identity, clock.now());
    say(reactionPhrase(p.name, p.kinds));
  };

  return {
    push(identity, name, word) {
      const waiting = pending.get(identity);
      if (waiting) {
        waiting.name = name;
        waiting.kinds.set(word, (waiting.kinds.get(word) ?? 0) + 1);
        return;
      }
      const now = clock.now();
      const last = lastSaid.get(identity);
      if (last === undefined || now - last >= ANNOUNCE_GAP_MS) {
        lastSaid.set(identity, now);
        say(reactionPhrase(name, new Map([[word, 1]])));
        return;
      }
      const timer = clock.setTimeout(() => flush(identity), last + ANNOUNCE_GAP_MS - now);
      pending.set(identity, { name, kinds: new Map([[word, 1]]), timer });
    },
    clear() {
      for (const p of pending.values()) clock.clearTimeout(p.timer);
      pending.clear();
      lastSaid.clear();
    },
  };
}
