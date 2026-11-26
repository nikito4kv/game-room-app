// Приглушение звука показа, пока говорят — как в телеэфире: заговорил кто-то
// (вы или другие) — звук показа тише на 9 дБ, замолчали все — через полсекунды
// возвращается. Голос важнее фильма. Источник «говорит» — speakingStore (он уже
// держит речь 300 мс после слога), здесь — ещё пауза перед возвратом, чтобы
// звук не «дышал» между фразами.
import { speakingStore } from "./speaking";

/** Во сколько раз тише звук показа, пока говорят: ≈ −9 дБ. */
export const DUCK_GAIN = 0.35;
/** Сколько тишины ждать, прежде чем вернуть громкость, мс. */
export const DUCK_RELEASE_MS = 500;

type AnySpeaking = { anySpeaking(): boolean; subscribeAny(cb: () => void): () => void };
type Timers = {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};
const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export type StreamDuck = {
  /** Приглушать ли сейчас. */
  get(): boolean;
  subscribe(onChange: () => void): () => void;
};

/**
 * «Приглушать сейчас» поверх «говорит ли кто-нибудь»: включается сразу, гаснет
 * через DUCK_RELEASE_MS тишины. Подписка на речь — только пока есть свои
 * подписчики; в тишине таймеров нет.
 */
export function createStreamDuck(source: AnySpeaking = speakingStore, timers: Timers = realTimers): StreamDuck {
  let ducked = false;
  let release: unknown = null;
  let unsubscribe: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const set = (next: boolean) => {
    if (next === ducked) return;
    ducked = next;
    listeners.forEach((l) => l());
  };
  const onSpeech = () => {
    if (source.anySpeaking()) {
      if (release !== null) timers.clearTimeout(release);
      release = null;
      set(true);
    } else if (ducked && release === null) {
      release = timers.setTimeout(() => {
        release = null;
        set(false);
      }, DUCK_RELEASE_MS);
    }
  };
  return {
    get: () => ducked,
    subscribe(onChange) {
      listeners.add(onChange);
      if (!unsubscribe) {
        unsubscribe = source.subscribeAny(onSpeech);
        onSpeech();
      }
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0 && unsubscribe) {
          unsubscribe();
          unsubscribe = null;
          if (release !== null) timers.clearTimeout(release);
          release = null;
          ducked = false;
        }
      };
    },
  };
}

export const streamDuck = createStreamDuck();
