// «Кто говорит» на клиенте, без сервера. LiveKit присылает признак с задержкой
// (обновление раз в 200–500 мс со сглаживанием — аудит 1-audio, 3.12), а кольцо
// «говорит» должно загораться вместе с голосом, как в Discord.
//
//  • у других — по уровню принятого звука (RoomAudio вешает анализатор на дорожку,
//    RemoteLevelMonitor опрашивает их одним таймером);
//  • у себя — по порогу шумодава: открыт и звук в эфире (useMicPipeline).
//
// Хранилище — по участникам: подписчик узнаёт только о своём человеке, поэтому
// голос одного не перерисовывает всю комнату (DESIGN_SYSTEM, правило 5).

/** Настройка детектора по уровню принятого звука, дБFS. */
export const SPEAKING_TUNING = {
  /** Выше — заговорил. Голос после обработки отправителя ≈ −35…−15, тишина за порогом — нули. */
  onDb: -46,
  /** Ниже — замолчал (гистерезис, чтобы кольцо не мигало на слогах). */
  offDb: -54,
  /** Сколько тишины держать кольцо после последнего слога. */
  holdMs: 300,
  /** Уровень, который на кольце — ноль, и уровень «в полную силу». */
  floorDb: -50,
  ceilDb: -14,
} as const;

export type SpeakingTuning = typeof SPEAKING_TUNING;

export type SpeakingState = {
  speaking: boolean;
  /** Сила голоса для кольца 0…1 (шаг 0,1 — меньше перерисовок). */
  level: number;
  /** Сколько уже тихо, мс (для удержания). */
  quietMs: number;
};

export const SILENT: SpeakingState = { speaking: false, level: 0, quietMs: 0 };

/** Уровень в дБ → сила для кольца 0…1 с шагом 0,1. */
export function levelFromDb(db: number, t: SpeakingTuning = SPEAKING_TUNING): number {
  if (!Number.isFinite(db) || db <= t.floorDb) return 0;
  const f = Math.min(1, (db - t.floorDb) / (t.ceilDb - t.floorDb));
  return Math.round(f * 10) / 10;
}

/**
 * Следующее состояние по свежему замеру. Заговорил — сразу (порог onDb);
 * замолчал — только после holdMs ниже offDb. Между порогами состояние не
 * меняется.
 */
export function nextSpeaking(
  prev: SpeakingState,
  levelDb: number,
  dtMs: number,
  t: SpeakingTuning = SPEAKING_TUNING,
): SpeakingState {
  const level = levelFromDb(levelDb, t);
  if (levelDb >= t.onDb || (prev.speaking && levelDb >= t.offDb)) {
    return { speaking: true, level: Math.max(level, 0.1), quietMs: 0 };
  }
  if (!prev.speaking) return prev.level === 0 && prev.quietMs === 0 ? prev : SILENT;
  const quietMs = prev.quietMs + Math.max(0, dtMs);
  return quietMs >= t.holdMs ? SILENT : { speaking: true, level, quietMs };
}

/** RMS отсчётов → дБFS (тишина → −∞). */
export function rmsDb(samples: Float32Array): number {
  let sum = 0;
  for (const v of samples) sum += v * v;
  return sum > 0 ? 10 * Math.log10(sum / samples.length) : -Infinity;
}

type Entry = { speaking: boolean; level: number };

/**
 * Состояние «говорит» по участникам. Источник — RoomAudio (другие) и
 * useMicPipeline (я). Нет записи — источника нет (например, обработка не
 * запустилась), и хуки берут признак LiveKit.
 */
class SpeakingStore {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Map<string, Set<() => void>>();
  /** Подписчики «говорит ли кто-нибудь» (приглушение звука показа) — будим только на смену. */
  private readonly anyListeners = new Set<() => void>();
  private speakers = 0;

  set(identity: string, speaking: boolean, level: number): void {
    const prev = this.entries.get(identity);
    if (prev && prev.speaking === speaking && prev.level === level) return;
    this.entries.set(identity, { speaking, level });
    if ((prev?.speaking ?? false) !== speaking) this.count(speaking ? 1 : -1);
    this.notify(identity);
  }

  delete(identity: string): void {
    const prev = this.entries.get(identity);
    if (!prev) return;
    this.entries.delete(identity);
    if (prev.speaking) this.count(-1);
    this.notify(identity);
  }

  /** Говорит ли сейчас хоть кто-то (я или другие). */
  anySpeaking(): boolean {
    return this.speakers > 0;
  }

  /** Подписка на смену anySpeaking(): кто-то заговорил в тишине или все замолчали. */
  subscribeAny(cb: () => void): () => void {
    this.anyListeners.add(cb);
    return () => {
      this.anyListeners.delete(cb);
    };
  }

  private count(delta: number): void {
    const before = this.speakers > 0;
    this.speakers = Math.max(0, this.speakers + delta);
    if (before !== this.speakers > 0) this.anyListeners.forEach((cb) => cb());
  }

  /** null — источника нет. */
  speaking(identity: string): boolean | null {
    return this.entries.get(identity)?.speaking ?? null;
  }

  level(identity: string): number | null {
    return this.entries.get(identity)?.level ?? null;
  }

  subscribe(identity: string, cb: () => void): () => void {
    let set = this.listeners.get(identity);
    if (!set) this.listeners.set(identity, (set = new Set()));
    set.add(cb);
    return () => {
      set.delete(cb);
      if (set.size === 0) this.listeners.delete(identity);
    };
  }

  private notify(identity: string): void {
    this.listeners.get(identity)?.forEach((cb) => cb());
  }
}

export const speakingStore = new SpeakingStore();

/** Для тестов: своё хранилище без общего состояния. */
export function createSpeakingStore(): SpeakingStore {
  return new SpeakingStore();
}

/** Сколько раз в секунду опрашивать анализаторы принятого звука. */
const POLL_MS = 50;

/**
 * Кольца кто-то видит: вкладка на экране или открыта мини-комната — окно
 * поверх игры рисует те же кольца, пока сама вкладка скрыта.
 */
export function ringsVisible(s: { pageVisible: boolean; miniRoomOpen: boolean }): boolean {
  return s.pageVisible || s.miniRoomOpen;
}

/**
 * Нужен ли опрос уровней: есть что слушать (хоть одна чужая дорожка не
 * заглушена — у заглушённой приёмник отдаёт нули) и кому смотреть.
 */
export function shouldPollLevels(activeSources: number, visible: boolean): boolean {
  return activeSources > 0 && visible;
}

/** Видит ли кто-то кольца сейчас — и подписка на перемены. */
export type RingVisibility = {
  /** Мини-комнату учитывает, пока есть подписка watch(). */
  visible: () => boolean;
  /** Подписаться на перемены; вернуть отписку. */
  watch: (onChange: () => void) => () => void;
};

/** Document Picture-in-Picture (мини-комната); в типах DOM его ещё нет. */
type DocumentPip = EventTarget & { window: Window | null };

function documentPip(): DocumentPip | null {
  return (window as Window & { documentPictureInPicture?: DocumentPip }).documentPictureInPicture ?? null;
}

/**
 * Браузер: видна ли вкладка и открыта ли мини-комната. Мини-комнату открывает
 * pip/usePipWindow, а здесь — только общий API браузера: «enter» — окно
 * открылось, «pagehide» этого окна — закрылось. Открытое окно помним сами:
 * documentPictureInPicture.window на pagehide может быть ещё не пуст.
 */
function browserRingVisibility(): RingVisibility {
  let pipWindow: Window | null = null;
  return {
    visible: () => ringsVisible({ pageVisible: document.visibilityState === "visible", miniRoomOpen: pipWindow !== null }),
    watch(onChange) {
      const pip = documentPip();
      const onPipHide = () => {
        setPipWindow(null);
        onChange();
      };
      const setPipWindow = (w: Window | null) => {
        pipWindow?.removeEventListener("pagehide", onPipHide);
        pipWindow = w;
        pipWindow?.addEventListener("pagehide", onPipHide);
      };
      const onEnter = (e: Event) => {
        setPipWindow((e as Event & { window?: Window }).window ?? pip?.window ?? null);
        onChange();
      };
      setPipWindow(pip?.window ?? null);
      document.addEventListener("visibilitychange", onChange);
      pip?.addEventListener("enter", onEnter);
      return () => {
        document.removeEventListener("visibilitychange", onChange);
        pip?.removeEventListener("enter", onEnter);
        setPipWindow(null);
      };
    },
  };
}

type LevelSource = {
  analyser: AnalyserNode;
  buf: Float32Array<ArrayBuffer>;
  state: SpeakingState;
  /** Дорожка не заглушена отправителем — есть что слушать. */
  active: boolean;
};

/**
 * Уровни принятого голоса: по анализатору на участника, один таймер на всех.
 * Таймер идёт, только пока он нужен (shouldPollLevels): все замолчали кнопкой
 * или вкладка ушла за игру без мини-комнаты — ни одного пробуждения в секунду.
 * На паузе кольца гаснут, а не застывают. Замер — RMS последних ≈21 мс.
 */
export class RemoteLevelMonitor {
  private readonly sources = new Map<string, LevelSource>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private unwatch: (() => void) | null = null;

  constructor(private readonly visibility: RingVisibility = browserRingVisibility()) {}

  /** active — дорожка сейчас не заглушена (RemoteTrack.isMuted === false). */
  add(identity: string, analyser: AnalyserNode, active = true): void {
    this.sources.set(identity, { analyser, buf: new Float32Array(analyser.fftSize), state: SILENT, active });
    speakingStore.set(identity, false, 0);
    this.unwatch ??= this.visibility.watch(() => this.update());
    this.update();
  }

  remove(identity: string, analyser: AnalyserNode): void {
    // Дорожку могли заменить новой раньше, чем убрали старую — не трогаем новую.
    if (this.sources.get(identity)?.analyser !== analyser) return;
    this.sources.delete(identity);
    speakingStore.delete(identity);
    if (this.sources.size === 0) {
      this.unwatch?.();
      this.unwatch = null;
    }
    this.update();
  }

  /** Отправитель заглушил или открыл дорожку. */
  setActive(identity: string, analyser: AnalyserNode, active: boolean): void {
    const src = this.sources.get(identity);
    if (!src || src.analyser !== analyser || src.active === active) return;
    src.active = active;
    if (!active) this.silence(identity, src);
    this.update();
  }

  private update(): void {
    let activeSources = 0;
    for (const src of this.sources.values()) if (src.active) activeSources++;
    const poll = shouldPollLevels(activeSources, this.visibility.visible());
    if (poll && !this.timer) {
      this.last = performance.now();
      this.timer = setInterval(() => this.tick(), POLL_MS);
    } else if (!poll && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      for (const [identity, src] of this.sources) this.silence(identity, src);
    }
  }

  private silence(identity: string, src: LevelSource): void {
    src.state = SILENT;
    speakingStore.set(identity, false, 0);
  }

  private tick(): void {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    for (const [identity, src] of this.sources) {
      if (!src.active) continue;
      src.analyser.getFloatTimeDomainData(src.buf);
      src.state = nextSpeaking(src.state, rmsDb(src.buf), dt);
      speakingStore.set(identity, src.state.speaking, src.state.level);
    }
  }
}

export const remoteLevels = new RemoteLevelMonitor();
