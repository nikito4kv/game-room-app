import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteAudioTrack, RemoteTrack } from "livekit-client";
import type { DeviceInfo } from "@/lib/audio/devices";
import { buildRoomOptions } from "@/lib/roomOptions";

// Окружение тестов — node (см. vitest.config): мокаем navigator / RTCRtpSender.
function stubNavigator(nav: unknown) {
  vi.stubGlobal("navigator", nav);
}
function stubH264(supported: boolean) {
  vi.stubGlobal("RTCRtpSender", {
    getCapabilities: () => ({
      codecs: [{ mimeType: supported ? "video/H264" : "video/VP8" }],
    }),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("buildRoomOptions", () => {
  it("backupCodec:false, adaptiveStream с двойной плотностью и dynacast; кодек по ОС", () => {
    stubNavigator({
      userAgentData: { platform: "Windows", brands: [{ brand: "Chromium" }] },
      userAgent: "",
    });
    stubH264(true);
    const o = buildRoomOptions();
    expect(o.webAudioMix).toBe(true);
    // Двойная плотность — иначе сцена берёт нижний слой вместо 1080p (аудит C-1).
    expect(o.adaptiveStream).toEqual({ pixelDensity: 2 });
    expect(o.dynacast).toBe(true);
    expect(o.publishDefaults?.backupCodec).toBe(false);
    expect(o.publishDefaults?.videoCodec).toBe("h264");
  });
  it("голос моно, браузерные автогромкость и шумодав выкл; сохранённый микрофон — точно (exact)", () => {
    stubNavigator(undefined);
    const voice = {
      channelCount: 1,
      echoCancellation: true,
      autoGainControl: false,
      noiseSuppression: false,
      voiceIsolation: false,
    };
    expect(buildRoomOptions().audioCaptureDefaults).toEqual(voice);
    expect(buildRoomOptions({ inputDeviceId: null }).audioCaptureDefaults).toEqual(voice);
    // Мягко нельзя: Chrome отдал бы мягкую просьбу своему «любимому» микрофону.
    expect(buildRoomOptions({ inputDeviceId: "usb-mic" }).audioCaptureDefaults).toEqual({
      ...voice,
      deviceId: { exact: "usb-mic" },
    });
    // Список, который видело лобби: «Как в системе» в Chrome — точно запись default,
    // пропавший микрофон — тоже она.
    const devices: DeviceInfo[] = [
      { kind: "audioinput", deviceId: "default", groupId: "g", label: "По умолчанию - DualSense" },
      { kind: "audioinput", deviceId: "usb-mic", groupId: "g", label: "DualSense" },
    ];
    expect(buildRoomOptions({ inputDeviceId: "default", devices }).audioCaptureDefaults).toEqual({
      ...voice,
      deviceId: { exact: "default" },
    });
    expect(buildRoomOptions({ inputDeviceId: "gone", devices }).audioCaptureDefaults).toMatchObject({
      deviceId: { exact: "default" },
    });
    expect(buildRoomOptions({ inputDeviceId: "usb-mic", devices }).audioCaptureDefaults).toMatchObject({
      deviceId: { exact: "usb-mic" },
    });
    // Наш шумодав недоступен — браузерный включается обратно.
    expect(buildRoomOptions({ voice: { ourNoiseSuppression: false } }).audioCaptureDefaults).toMatchObject({
      noiseSuppression: true,
      voiceIsolation: true,
    });
  });
  it("приём звука — через общий контекст воспроизведения (громкость >100 %, свои узлы, один вывод)", () => {
    stubNavigator(undefined);
    class FakeAudioContext {
      state = "suspended";
    }
    vi.stubGlobal("window", { AudioContext: FakeAudioContext });
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const mix = buildRoomOptions().webAudioMix;
    expect(typeof mix).toBe("object");
    const ctx = (mix as { audioContext: unknown }).audioContext;
    expect(ctx).toBeInstanceOf(FakeAudioContext);
    // Один контекст на вкладку: повторная сборка опций отдаёт тот же.
    expect((buildRoomOptions().webAudioMix as { audioContext: unknown }).audioContext).toBe(ctx);
  });
  it("публикация голоса: Opus моно 64 кбит/с, DTX и RED", () => {
    stubNavigator(undefined);
    const p = buildRoomOptions().publishDefaults;
    expect(p?.audioPreset?.maxBitrate).toBe(64_000);
    expect(p?.dtx).toBe(true);
    expect(p?.red).toBe(true);
    expect(p?.forceStereo).toBe(false);
  });
});

// Сторож обновлений livekit-client: модуль roomOptions выключает вечный rAF на
// чужих дорожках. Если библиотека перенесёт цикл в другой метод, этот тест
// упадёт — тогда надо найти новое место и выключить его там.
describe("цикл TimeSyncUpdate livekit-client выключен", () => {
  it("метод, который мы глушим, в библиотеке есть, и start() им пользуется", () => {
    expect(typeof RemoteTrack.prototype.registerTimeSyncUpdate).toBe("function");
    expect(String(RemoteTrack.prototype.startMonitor)).toContain("registerTimeSyncUpdate");
  });
  it("старт чужой дорожки не запускает requestAnimationFrame, даже когда браузер умеет getSynchronizationSources", () => {
    vi.stubGlobal(
      "RTCRtpReceiver",
      class {
        getSynchronizationSources() {
          return [];
        }
      },
    );
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const media = {
      id: "m1",
      kind: "audio",
      enabled: true,
      readyState: "live",
      addEventListener() {},
      removeEventListener() {},
    } as unknown as MediaStreamTrack;
    const track = new RemoteAudioTrack(media, "TR_test", new RTCRtpReceiver());
    track.start();
    track.stop();
    expect(raf).not.toHaveBeenCalled();
  });
});
