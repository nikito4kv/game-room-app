// «Итоги вечера»: что считала эта вкладка, пока была в комнате, — сколько
// просидели, сколько было людей, кто говорил больше всех и кто меньше, сколько
// реакций, звуков и бросков кубика. Без сервера: числа — то, что видел этот
// браузер (кто вошёл позже вас, для вас «начал» позже). Говорит/молчит — по
// событиям активных говорящих LiveKit (их считает сервер медиа и шлёт и в фоновую
// вкладку, пока человек в игре), а не по своим кольцам: те в фоне спят.
//
// Чистая логика без браузера; время передаёт вызывающий — тест рядом.

/** Меньше этого говорения — не «болтун», а случайный звук. */
export const TOP_TALK_MIN_MS = 30_000;
/** «Молчун» — только из тех, кто просидел с вами хотя бы столько. */
export const QUIET_PRESENT_MIN_MS = 5 * 60_000;

type PersonLog = {
  name: string;
  talkMs: number;
  /** Говорит с этого момента (null — молчит). */
  talkSince: number | null;
  presentMs: number;
  /** В комнате с этого момента (null — вышел). */
  hereSince: number | null;
};

export type RecapPerson = { identity: string; name: string; talkMs: number };

export type Recap = {
  title: string;
  /** Когда вы вошли (мс с эпохи). */
  startedAt: number;
  /** Сколько вы в комнате, мс. */
  durationMs: number;
  /** Разных людей за вечер, вместе с вами. */
  people: number;
  /** Больше всего одновременно, вместе с вами. */
  peak: number;
  top: RecapPerson | null;
  quiet: RecapPerson | null;
  reactions: number;
  sounds: number;
  dice: number;
};

export type RecapTracker = {
  /** Название комнаты (могли переименовать). */
  setTitle(title: string): void;
  /** Человек в комнате (и вы сами при входе). Повторный вход того же — продолжение. */
  join(identity: string, name: string, now: number): void;
  leave(identity: string, now: number): void;
  /** Кто говорит сейчас — полный список (как ActiveSpeakersChanged). */
  speakers(identities: readonly string[], now: number): void;
  reaction(): void;
  sound(): void;
  dice(): void;
  /** Вы вышли: время стоит, пока не войдёте снова. */
  pause(now: number): void;
  /** Вы снова в комнате. */
  resume(now: number): void;
  snapshot(now: number): Recap;
};

export function createRecapTracker(title: string, startedAt: number): RecapTracker {
  const log = new Map<string, PersonLog>();
  let roomTitle = title;
  let mineMs = 0;
  let mineSince: number | null = startedAt;
  let peak = 0;
  let reactions = 0;
  let sounds = 0;
  let dice = 0;

  const hereNow = () => [...log.values()].filter((p) => p.hereSince !== null).length;
  const stopTalk = (p: PersonLog, now: number) => {
    if (p.talkSince !== null) p.talkMs += Math.max(0, now - p.talkSince);
    p.talkSince = null;
  };
  const stopHere = (p: PersonLog, now: number) => {
    if (p.hereSince !== null) p.presentMs += Math.max(0, now - p.hereSince);
    p.hereSince = null;
  };

  return {
    setTitle(t) {
      roomTitle = t;
    },
    join(identity, name, now) {
      const p = log.get(identity);
      if (p) {
        p.name = name || p.name;
        if (p.hereSince === null) p.hereSince = now;
      } else {
        log.set(identity, { name, talkMs: 0, talkSince: null, presentMs: 0, hereSince: now });
      }
      peak = Math.max(peak, hereNow());
    },
    leave(identity, now) {
      const p = log.get(identity);
      if (!p) return;
      stopTalk(p, now);
      stopHere(p, now);
    },
    speakers(identities, now) {
      const speaking = new Set(identities);
      for (const [id, p] of log) {
        if (speaking.has(id) && p.hereSince !== null) {
          if (p.talkSince === null) p.talkSince = now;
        } else stopTalk(p, now);
      }
    },
    reaction() {
      reactions++;
    },
    sound() {
      sounds++;
    },
    dice() {
      dice++;
    },
    pause(now) {
      if (mineSince !== null) mineMs += Math.max(0, now - mineSince);
      mineSince = null;
      for (const p of log.values()) {
        stopTalk(p, now);
        stopHere(p, now);
      }
    },
    resume(now) {
      if (mineSince === null) mineSince = now;
    },
    snapshot(now) {
      const people = [...log.entries()].map(([identity, p]) => ({
        identity,
        name: p.name,
        talkMs: p.talkMs + (p.talkSince !== null ? Math.max(0, now - p.talkSince) : 0),
        presentMs: p.presentMs + (p.hereSince !== null ? Math.max(0, now - p.hereSince) : 0),
      }));
      const byTalk = [...people].sort((a, b) => b.talkMs - a.talkMs);
      const topP = byTalk[0] && byTalk[0].talkMs >= TOP_TALK_MIN_MS ? byTalk[0] : null;
      const quietP =
        people.length >= 2
          ? [...people]
              .filter((p) => p.presentMs >= QUIET_PRESENT_MIN_MS && p.identity !== topP?.identity)
              .sort((a, b) => a.talkMs - b.talkMs)[0]
          : undefined;
      const pick = (p: (typeof people)[number] | null | undefined): RecapPerson | null =>
        p ? { identity: p.identity, name: p.name, talkMs: p.talkMs } : null;
      return {
        title: roomTitle,
        startedAt,
        durationMs: mineMs + (mineSince !== null ? Math.max(0, now - mineSince) : 0),
        people: log.size,
        peak,
        top: pick(topP),
        quiet: pick(quietP),
        reactions,
        sounds,
        dice,
      };
    },
  };
}

/** «2 ч 15 мин», «48 мин», «меньше минуты». */
export function formatSpan(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "меньше минуты";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

/** Есть ли что показывать: вечер короче пары минут — итогов нет. */
export function recapWorthShowing(r: Recap): boolean {
  return r.durationMs >= 2 * 60_000;
}
