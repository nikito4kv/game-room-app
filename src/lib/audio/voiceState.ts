// Состояние своего голоса: что человек хочет (намерение) и что из этого следует —
// идёт ли звук в эфир и как выглядит кнопка микрофона. Чистая логика без LiveKit:
// трек только догоняет то, что посчитано здесь (см. audio/useMic.tsx).
//
// Почему не mic.enabled LiveKit: там «включён» = опубликован и не заглушён. В
// рации трек почти всё время заглушён, и «рация готова» по нему не отличить от
// «выключено» — отсюда была ошибка, когда после авто-включения рации микрофон
// оставался в эфире (аудит 1-audio, 3.3).
import type { VoiceMode } from "@/lib/clientStorage";

/** Вид кнопки микрофона в доке — как MicState в макете комнаты. */
export type MicState = "on" | "off" | "ptt-idle" | "ptt-talk" | "forced";

/** Всё, от чего зависит эфир. */
export type VoiceInputs = {
  mode: VoiceMode;
  /** Микрофон включён; в рации — «рация готова». */
  enabled: boolean;
  /** Клавиша рации зажата (вместе с задержкой отпускания). */
  pttHeld: boolean;
  /** «Звук выкл»: как в Discord, глушит и свой микрофон. */
  deafened: boolean;
  /** Хост выключил микрофон. */
  forceMuted: boolean;
};

/** Должен ли звук сейчас уходить в эфир. */
export function shouldTransmit(v: VoiceInputs): boolean {
  if (!v.enabled || v.deafened || v.forceMuted) return false;
  return v.mode === "ptt" ? v.pttHeld : true;
}

/** Вид кнопки микрофона. «Звук выкл» показывает микрофон выключенным, как в Discord. */
export function micState(v: VoiceInputs): MicState {
  if (v.forceMuted) return "forced";
  if (!v.enabled || v.deafened) return "off";
  if (v.mode === "ptt") return v.pttHeld ? "ptt-talk" : "ptt-idle";
  return "on";
}

/**
 * Намерение человека. beforePtt — было ли включено до перехода в рацию: рация
 * при входе включается сама («авто-готовность»), а при выходе возвращаем как
 * было. Любое явное переключение внутри рации это забывает — дальше действует
 * последний выбор человека (так выключенная им рация не превратится в открытый
 * микрофон при смене режима).
 */
export type MicIntent = { enabled: boolean; beforePtt: boolean | null };

export type MicIntentAction =
  | { type: "set"; enabled: boolean }
  | { type: "mode"; mode: VoiceMode; forceMuted: boolean }
  /** Хост выключил микрофон: после того как он вернёт право, человек включает сам. */
  | { type: "force-muted" }
  /**
   * Хост выключил микрофоны всем (сервер заглушил трек). Мягко: права никто не
   * забирал, но микрофон выключен по-настоящему — иначе трек, который догоняет
   * намерение, сам снял бы заглушение. Включает человек сам, когда нужно.
   */
  | { type: "muted-remotely" };

export const INITIAL_MIC_INTENT: MicIntent = { enabled: true, beforePtt: null };

export function micIntentReducer(state: MicIntent, action: MicIntentAction): MicIntent {
  switch (action.type) {
    case "set":
      return state.enabled === action.enabled && state.beforePtt === null
        ? state
        : { enabled: action.enabled, beforePtt: null };
    case "mode":
      if (action.mode === "ptt") {
        // Заглушённого хостом не «готовим»: включать всё равно нельзя.
        return { enabled: action.forceMuted ? state.enabled : true, beforePtt: state.enabled };
      }
      return { enabled: state.beforePtt ?? state.enabled, beforePtt: null };
    // Выход из рации после этого не вернёт «как было»: хост просил тишины.
    case "force-muted":
    case "muted-remotely":
      return state.enabled ? { enabled: false, beforePtt: null } : state;
  }
}
