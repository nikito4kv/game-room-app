import { TEST_FILES } from "./constants";
import { parseVoiceUrl, resolveTurnHost } from "./hosts";
import { probeFile, probeTurn, probeVoice, probeWebRtc } from "./probes";
import type { CheckResults, FileResult, TurnResult, VoiceResult, WebRtcResult } from "./types";

// Запуск всей проверки по трём именам нашего сервера: сайт (файлы по очереди), голос
// rtc.… (HTTPS и WebSocket) и turn.… (TLS на 443, UDP). Голос, TURN и WebRTC стартуют
// сразу рядом с файлами: они почти не грузят канал и не портят замер скорости.

export type RunHandlers = {
  onFile: (index: number, state: "running" | FileResult) => void;
  onVoice: (state: "running" | VoiceResult) => void;
  onTurn: (state: "running" | TurnResult) => void;
  onWebRtc: (state: "running" | WebRtcResult) => void;
};

function skipped(index: number): FileResult {
  const f = TEST_FILES[index];
  return {
    id: f.id,
    label: f.label,
    expectedBytes: f.bytes,
    status: "skipped",
    receivedBytes: 0,
    ttfbMs: null,
    totalMs: 0,
    httpStatus: null,
    silenceMs: null,
  };
}

export async function runCheck(opts: {
  origin: string;
  voiceUrl: string | null;
  /** NEXT_PUBLIC_TURN_DOMAIN, если задан; иначе имя выводится из адреса голоса. */
  turnDomain?: string | null;
  signal: AbortSignal;
  handlers: RunHandlers;
}): Promise<CheckResults> {
  const { origin, voiceUrl, signal, handlers } = opts;
  const parsed = parseVoiceUrl(voiceUrl);
  const turnHost = resolveTurnHost(parsed?.hostname, opts.turnDomain);

  const siteTask = async (): Promise<FileResult[]> => {
    const files: FileResult[] = [];
    let silentFails = 0;
    for (let i = 0; i < TEST_FILES.length; i++) {
      // Два файла подряд без единого байта: сайт не отвечает, остальные ждать 10 с каждый незачем.
      if (signal.aborted || silentFails >= 2) {
        const s = skipped(i);
        files.push(s);
        handlers.onFile(i, s);
        continue;
      }
      handlers.onFile(i, "running");
      const r = await probeFile(TEST_FILES[i], { baseUrl: origin, signal });
      silentFails = r.status !== "ok" && r.receivedBytes === 0 ? silentFails + 1 : 0;
      files.push(r);
      handlers.onFile(i, r);
    }
    return files;
  };

  const voiceTask = async (): Promise<VoiceResult> => {
    handlers.onVoice("running");
    const r = await probeVoice(voiceUrl, { signal });
    handlers.onVoice(r);
    return r;
  };

  const turnTask = async (): Promise<TurnResult> => {
    handlers.onTurn("running");
    const r = await probeTurn(turnHost, { signal });
    handlers.onTurn(r);
    return r;
  };

  const webrtcTask = async (): Promise<WebRtcResult> => {
    handlers.onWebRtc("running");
    // UDP спрашиваем у имени TURN (там же слушает STUN); нет его, спросим имя голоса:
    // у обоих один IP.
    const r = await probeWebRtc(turnHost ?? parsed?.hostname ?? null, { signal });
    handlers.onWebRtc(r);
    return r;
  };

  const [files, voice, turn, webrtc] = await Promise.all([siteTask(), voiceTask(), turnTask(), webrtcTask()]);
  return { site: { origin, files }, voice, turn, webrtc };
}
