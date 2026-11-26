import { listDevices } from "./deviceList";
import { MicProcessor } from "./micProcessor";
import { getPlaybackContext } from "./playback";
import { micTestConstraints, type CaptureSettings } from "./voiceOptions";
import type { VoiceSettings } from "./worklet/protocol";

/**
 * Проверка микрофона (как «Let's Check» в Discord) — слушаем то, что РЕАЛЬНО
 * уходит в эфир: тот же захват и та же цепочка обработки (шумодав, порог,
 * автогромкость, лимитер), что в комнате.
 *
 *  • startMicTest — до входа или без комнаты: свой захват с параметрами комнаты
 *    и свой MicProcessor с переданными настройками;
 *  • startMicTestFromProcessor — в комнате: слушаем выход MicProcessor комнаты,
 *    без второго захвата микрофона.
 *
 *   звук «как в эфире» → analyser (уровень)
 *                      ↘ (опц.) → вывод (loopback: «слышать себя»)
 *
 * Звучит через общий контекст воспроизведения — значит, «слышать себя» идёт в
 * выбранное устройство вывода, как и голоса друзей. Firefox не соединяет дорожку
 * с контекстом другой частоты — там свой контекст на частоте обработки.
 *
 * Обязательно вызвать stop() при закрытии — иначе останется гореть индикатор
 * микрофона ОС.
 */
export type MicTest = {
  /** Уровень 0..1 (RMS ×4 — тихий голос заметно двигает полоску). */
  level: () => number;
  /** Уровень в дБFS; −∞ — тишина или звук ещё не запущен (нет жеста на странице). */
  levelDb: () => number;
  /** «Слышать себя» — ровно то, что услышат друзья. */
  setLoopback: (on: boolean) => void;
  /**
   * Усиление. В startMicTest — ручное усиление цепочки теста. В
   * startMicTestFromProcessor ничего не делает: усиление уже в цепочке комнаты.
   */
  setGain: (value: number) => void;
  stop: () => Promise<void>;
  /**
   * Обработка, через которую идёт тест: порог, метрики (subscribeMeter),
   * калибровка (calibrate), настройки. null — тест без обработки (processing: false).
   */
  processor: MicProcessor | null;
  /** Настройки захваченного микрофона (deviceId, groupId); null — тест на выходе комнаты. */
  source: MediaTrackSettings | null;
};

export type MicTestOptions = {
  /** Настройки обработки, как в комнате; false — сырой микрофон без обработки. */
  processing?: Partial<VoiceSettings> | false;
  /** Эхоподавление и автогромкость браузера — как в комнате. */
  capture?: Partial<CaptureSettings>;
  /**
   * Браузерный шумодав — как у захвата комнаты: там он включён, только пока наш
   * не работает (useMicPipeline). Разные флаги на одном микрофоне Chrome не
   * держит: второй захват получил бы обработку первого.
   */
  browserNoiseSuppression?: boolean;
};

export async function startMicTest(
  deviceId?: string | null,
  gain = 1,
  options: MicTestOptions = {},
): Promise<MicTest> {
  const processing = options.processing ?? {};
  const ourNs = processing !== false && (processing.noiseSuppression ?? true);
  // Свежий список: по нему «Как в системе» — точно устройство по умолчанию, а не
  // «любимое» Chrome (см. micDeviceConstraint).
  const devices = await listDevices();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: micTestConstraints(
      deviceId,
      { ourNoiseSuppression: !options.browserNoiseSuppression, ...options.capture },
      devices,
    ),
  });
  const track = stream.getAudioTracks()[0];

  // Поток уже захвачен (горит индикатор микрофона ОС). Если что-то ниже упадёт,
  // обязательно освобождаем и поток, и обработку, и контекст.
  let processor: MicProcessor | null = null;
  const release = async () => {
    stream.getTracks().forEach((t) => t.stop());
    await processor?.destroy();
  };
  try {
    if (processing !== false) {
      processor = new MicProcessor(gain, ourNs, undefined, processing);
      await processor.start(track);
    }
    const p = processor;
    return monitor(p?.processedTrack ?? track, p?.sampleRate, {
      // С обработкой усиление уже в цепочке теста, без неё — в узле прослушивания.
      gain: p ? 1 : gain,
      setGain: (value, node) => {
        if (p) p.setGain(value);
        else node.gain.value = value;
      },
      release,
      processor: p,
      source: track.getSettings(),
    });
  } catch (err) {
    await release();
    throw err;
  }
}

/**
 * Проверка в комнате: слушаем выход MicProcessor комнаты — то, что уже уходит
 * друзьям (после порога, автогромкости, усиления и лимитера). Микрофон второй раз
 * не захватывается; stop() закрывает только прослушивание.
 */
export async function startMicTestFromProcessor(processor: MicProcessor): Promise<MicTest> {
  const out = processor.processedTrack;
  if (!out) throw new Error("Обработка микрофона ещё не запущена");
  return monitor(out, processor.sampleRate, {
    gain: 1,
    setGain: () => {},
    release: async () => {},
    processor,
    source: null,
  });
}

function monitor(
  track: MediaStreamTrack,
  sampleRate: number | undefined,
  opts: {
    gain: number;
    setGain: (value: number, node: GainNode) => void;
    release: () => Promise<void>;
    processor: MicProcessor | null;
    source: MediaTrackSettings | null;
  },
): MicTest {
  const { ctx, source, own } = openMonitorSource(track, sampleRate);
  const stopWaking = wakeWhenAllowed(ctx);
  const gainNode = ctx.createGain();
  gainNode.gain.value = opts.gain;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(gainNode).connect(analyser);

  const data = new Float32Array(analyser.fftSize);
  const rms = () => {
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    return Math.sqrt(sum / data.length);
  };
  let loopbackOn = false;
  let stopped = false;

  return {
    level: () => Math.min(1, rms() * 4),
    levelDb: () => {
      const r = rms();
      return r > 0 ? 20 * Math.log10(r) : -Infinity;
    },
    setLoopback(on: boolean) {
      if (on === loopbackOn || stopped) return;
      if (on) gainNode.connect(ctx.destination);
      else gainNode.disconnect(ctx.destination);
      loopbackOn = on;
    },
    setGain: (value: number) => opts.setGain(value, gainNode),
    async stop() {
      if (stopped) return;
      stopped = true;
      stopWaking();
      source.disconnect();
      gainNode.disconnect();
      // Общий контекст живёт дальше (в нём голоса друзей), свой — закрываем.
      if (own) await ctx.close().catch(() => {});
      await opts.release();
    },
    processor: opts.processor,
    source: opts.source,
  };
}

/**
 * Источник для прослушивания: в общем контексте воспроизведения (звук пойдёт в
 * выбранный вывод), а если браузер не соединяет дорожку с контекстом другой
 * частоты (Firefox) — в своём контексте на частоте обработки.
 */
function openMonitorSource(
  track: MediaStreamTrack,
  sampleRate: number | undefined,
): { ctx: AudioContext; source: MediaStreamAudioSourceNode; own: boolean } {
  const shared = getPlaybackContext();
  const stream = new MediaStream([track]);
  if (shared) {
    try {
      return { ctx: shared, source: shared.createMediaStreamSource(stream), own: false };
    } catch {
      // другая частота в Firefox — ниже свой контекст
    }
  }
  const ctx = new AudioContext(sampleRate ? { sampleRate } : {});
  return { ctx, source: ctx.createMediaStreamSource(stream), own: true };
}

/**
 * Будим контекст, не дожидаясь: без жеста на странице resume() в Chrome не
 * отклоняется, а висит до клика — тогда тест не вернулся бы вовсе, а микрофон
 * уже захвачен. Пока контекст спит, уровень — тишина; первый клик или клавиша
 * его запускают. Возвращает отписку.
 */
function wakeWhenAllowed(ctx: AudioContext): () => void {
  if (ctx.state !== "suspended") return () => {};
  const wake = () => void ctx.resume().catch(() => {});
  const stop = () => {
    window.removeEventListener("pointerdown", wake, true);
    window.removeEventListener("keydown", wake, true);
    ctx.removeEventListener("statechange", onState);
  };
  const onState = () => {
    if (ctx.state !== "suspended") stop();
  };
  window.addEventListener("pointerdown", wake, true);
  window.addEventListener("keydown", wake, true);
  ctx.addEventListener("statechange", onState);
  wake();
  return stop;
}
