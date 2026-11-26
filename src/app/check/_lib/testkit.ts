import { TEST_FILES } from "./constants";
import type {
  CheckResults,
  FileResult,
  TurnResult,
  VoiceResult,
  WebRtcResult,
} from "./types";

// Заготовки результатов для тестов (verdict.test.ts, report.test.ts): собрать нужную
// ситуацию в одну строку. В рабочий код страницы не попадает: его никто не импортирует.

export function okFile(index: number, over: Partial<FileResult> = {}): FileResult {
  const f = TEST_FILES[index];
  return {
    id: f.id,
    label: f.label,
    expectedBytes: f.bytes,
    status: "ok",
    receivedBytes: f.bytes,
    ttfbMs: 140,
    totalMs: Math.max(200, Math.round(f.bytes / 600)),
    httpStatus: 200,
    silenceMs: null,
    ...over,
  };
}

/** Файл «замёрз»: пришло receivedBytes из размера файла, потом тишина. */
export function stalledFile(index: number, receivedBytes = 16 * 1024, over: Partial<FileResult> = {}): FileResult {
  return okFile(index, {
    status: "stalled",
    receivedBytes,
    totalMs: 5_300,
    silenceMs: 5_000,
    ...over,
  });
}

export function deadFile(index: number, over: Partial<FileResult> = {}): FileResult {
  return okFile(index, {
    status: "timeout",
    receivedBytes: 0,
    ttfbMs: null,
    totalMs: 10_000,
    httpStatus: null,
    ...over,
  });
}

export function skippedFile(index: number): FileResult {
  return okFile(index, {
    status: "skipped",
    receivedBytes: 0,
    ttfbMs: null,
    totalMs: 0,
    httpStatus: null,
  });
}

export function goodSite(origin = "https://game-room.space") {
  return { origin, files: TEST_FILES.map((_, i) => okFile(i)) };
}

export function goodVoice(over: Partial<VoiceResult> = {}): VoiceResult {
  return {
    url: "wss://rtc.game-room.space",
    host: "rtc.game-room.space",
    status: "reachable",
    https: { ok: true, ms: 210, error: null },
    ws: { outcome: "failed", ms: 230 },
    ...over,
  };
}

export function deadVoice(): VoiceResult {
  return goodVoice({
    status: "unreachable",
    https: { ok: false, ms: null, error: "timeout" },
    ws: { outcome: "timeout", ms: 8_000 },
  });
}

export function goodTurn(over: Partial<TurnResult> = {}): TurnResult {
  return {
    status: "reachable",
    host: "turn.game-room.space",
    url: "turns:turn.game-room.space:443?transport=tcp",
    code: 401,
    ms: 240,
    failCodes: [],
    ...over,
  };
}

export function deadTurn(over: Partial<TurnResult> = {}): TurnResult {
  return goodTurn({ status: "unreachable", code: null, ms: null, failCodes: [701], ...over });
}

export function goodWebRtc(over: Partial<WebRtcResult> = {}): WebRtcResult {
  return {
    status: "ok",
    stunUrls: ["stun:turn.game-room.space:3478", "stun:turn.game-room.space:443"],
    host: 2,
    srflx: 1,
    relay: 0,
    firstHostMs: 4,
    firstSrflxMs: 180,
    doneMs: 520,
    completed: true,
    errors: [],
    ...over,
  };
}

export function noUdpWebRtc(over: Partial<WebRtcResult> = {}): WebRtcResult {
  return goodWebRtc({
    status: "no-srflx",
    srflx: 0,
    firstSrflxMs: null,
    doneMs: 6_000,
    completed: false,
    errors: [{ code: 701, url: "stun:turn.game-room.space:3478" }],
    ...over,
  });
}

export function allGood(): CheckResults {
  return { site: goodSite(), voice: goodVoice(), turn: goodTurn(), webrtc: goodWebRtc() };
}
