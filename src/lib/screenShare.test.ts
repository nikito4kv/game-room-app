import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SCREEN_AUDIO_PUBLISH,
  SCREEN_PRESETS,
  captureErrorText,
  describeCapture,
  detectOS,
  displayMediaOptions,
  isChromium,
  isScreenQuality,
  liveSwitch,
  pickScreenShareCodec,
  screenBitrate,
  screenDegradation,
  screenStartBitrateKbps,
  screenVideoPublishOptions,
  withStartBitrate,
} from "@/lib/screenShare";

// Окружение тестов — node (см. vitest.config), браузерных глобалов нет.
// Мокаем navigator / RTCRtpSender перед каждым кейсом.
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

const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const FIREFOX_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0";

afterEach(() => vi.unstubAllGlobals());

describe("detectOS", () => {
  it("Windows через userAgentData", () => {
    stubNavigator({ userAgentData: { platform: "Windows" }, userAgent: "" });
    expect(detectOS()).toBe("windows");
  });
  it("macOS через userAgent", () => {
    stubNavigator({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" });
    expect(detectOS()).toBe("macos");
  });
  it("iOS через userAgent", () => {
    stubNavigator({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" });
    expect(detectOS()).toBe("ios");
  });
  it("Linux через userAgent", () => {
    stubNavigator({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" });
    expect(detectOS()).toBe("linux");
  });
  it("SSR (нет navigator) → unknown", () => {
    stubNavigator(undefined);
    expect(detectOS()).toBe("unknown");
  });
});

describe("isChromium", () => {
  it("бренды Client Hints или Chrome/ в userAgent", () => {
    stubNavigator({ userAgentData: { brands: [{ brand: "Chromium" }] }, userAgent: "" });
    expect(isChromium()).toBe(true);
    stubNavigator({ userAgent: CHROME_WIN });
    expect(isChromium()).toBe(true);
  });
  it("Firefox — нет", () => {
    stubNavigator({ userAgent: FIREFOX_WIN });
    expect(isChromium()).toBe(false);
  });
});

describe("pickScreenShareCodec", () => {
  it("Chrome на Windows с H.264 → h264", () => {
    stubNavigator({ userAgentData: { platform: "Windows" }, userAgent: CHROME_WIN });
    stubH264(true);
    expect(pickScreenShareCodec()).toBe("h264");
  });
  it("Firefox на Windows → vp8, хотя H.264 заявлен (C-14)", () => {
    stubNavigator({ userAgent: FIREFOX_WIN });
    stubH264(true);
    expect(pickScreenShareCodec()).toBe("vp8");
  });
  it("Windows без H.264 или без RTCRtpSender → vp8", () => {
    stubNavigator({ userAgentData: { platform: "Windows" }, userAgent: CHROME_WIN });
    stubH264(false);
    expect(pickScreenShareCodec()).toBe("vp8");
    vi.stubGlobal("RTCRtpSender", undefined);
    expect(pickScreenShareCodec()).toBe("vp8");
  });
  it("macOS → vp8 даже при наличии h264", () => {
    stubNavigator({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/141.0" });
    stubH264(true);
    expect(pickScreenShareCodec()).toBe("vp8");
  });
  it("SSR → vp8", () => {
    stubNavigator(undefined);
    expect(pickScreenShareCodec()).toBe("vp8");
  });
});

describe("профили", () => {
  it("подписи без «на каждого зрителя» (C-8)", () => {
    for (const p of Object.values(SCREEN_PRESETS)) {
      expect(p.description).not.toMatch(/кажд/);
    }
    expect(SCREEN_PRESETS.max.description).toMatch(/1080p будет 1080p/);
  });

  it("isScreenQuality отсекает мусор из localStorage", () => {
    expect(isScreenQuality("max")).toBe(true);
    expect(isScreenQuality("ultra")).toBe(false);
    expect(isScreenQuality(null)).toBe(false);
  });
});

describe("displayMediaOptions", () => {
  it("потолок размера и кадров профиля, звук без своего эха (C-3)", () => {
    const o = displayMediaOptions("smooth");
    expect(o.video).toEqual({
      width: { max: 1920 },
      height: { max: 1080 },
      frameRate: { ideal: 60, max: 60 },
    });
    expect(o.audio).toMatchObject({
      restrictOwnAudio: true,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
    expect(o.selfBrowserSurface).toBe("exclude");
    expect(o.systemAudio).toBe("include");
  });

  it("текст — 15 к/с до 1440p", () => {
    expect(displayMediaOptions("text").video).toMatchObject({ height: { max: 1440 }, frameRate: { max: 15 } });
  });
});

describe("screenBitrate", () => {
  it("по профилю на «родном» размере", () => {
    expect(screenBitrate("light", 1280, 720)).toBe(3_500_000);
    expect(screenBitrate("smooth", 1920, 1080)).toBe(6_000_000);
    expect(screenBitrate("max", 2560, 1440)).toBe(8_000_000);
    expect(screenBitrate("text", 2560, 1440)).toBe(4_000_000);
  });

  it("«Максимум» на мониторе 1080p не тратит 8 Мбит/с", () => {
    expect(screenBitrate("max", 1920, 1080)).toBe(6_000_000);
    expect(screenBitrate("text", 1920, 1080)).toBe(3_000_000);
    expect(screenBitrate("smooth", 1280, 720)).toBe(3_500_000);
  });

  it("неизвестный размер — по профилю, профиль — потолок", () => {
    expect(screenBitrate("smooth", 0, 0)).toBe(6_000_000);
    expect(screenBitrate("light", 3440, 1440)).toBe(3_500_000);
  });
});

describe("разгон канала показа", () => {
  it("стартовая оценка — 40 % потолка верхнего слоя: выше порога 1080p (~1,5 Мбит/с), но не вся полоса", () => {
    expect(screenStartBitrateKbps("smooth", 1920, 1080)).toBe(2400);
    expect(screenStartBitrateKbps("light", 1280, 720)).toBe(1400);
    expect(screenStartBitrateKbps("max", 2560, 1440)).toBe(3200);
    expect(screenStartBitrateKbps("max", 1920, 1080)).toBe(2400);
    expect(screenStartBitrateKbps("text", 1920, 1080)).toBe(1200);
  });

  // Ответ сервера (как у LiveKit): аудио, видео показа (mid 1: H.264 с fmtp, VP8 без
  // fmtp, RTX), чужое видео (mid 2).
  const ANSWER = [
    "v=0",
    "o=- 1 2 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "a=mid:0",
    "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=10;useinbandfec=1",
    "m=video 9 UDP/TLS/RTP/SAVPF 125 96 97",
    "a=mid:1",
    "a=recvonly",
    "a=rtpmap:125 H264/90000",
    "a=fmtp:125 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
    "a=rtpmap:96 VP8/90000",
    "a=rtpmap:97 rtx/90000",
    "a=fmtp:97 apt=125",
    "m=video 9 UDP/TLS/RTP/SAVPF 125",
    "a=mid:2",
    "a=sendonly",
    "a=rtpmap:125 H264/90000",
    "a=fmtp:125 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
    "",
  ].join("\r\n");

  it("дописывает параметр только кодекам своей секции, RTX и чужое видео не трогает", () => {
    const out = withStartBitrate(ANSWER, "1", 2400).split("\r\n");
    expect(out).toContain(
      "a=fmtp:125 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f;x-google-start-bitrate=2400",
    );
    // VP8 без fmtp — своя строка сразу за rtpmap.
    expect(out[out.indexOf("a=rtpmap:96 VP8/90000") + 1]).toBe("a=fmtp:96 x-google-start-bitrate=2400");
    expect(out).toContain("a=fmtp:97 apt=125");
    // Секция mid 2 (последняя) — как была, и SDP по-прежнему кончается переводом строки.
    expect(out.slice(-3)).toEqual([
      "a=rtpmap:125 H264/90000",
      "a=fmtp:125 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
      "",
    ]);
    expect(out.filter((l) => l.includes("x-google")).length).toBe(2);
  });

  it("повторная правка и чужой mid ничего не меняют", () => {
    const once = withStartBitrate(ANSWER, "1", 2400);
    expect(withStartBitrate(once, "1", 2400)).toBe(once);
    expect(withStartBitrate(ANSWER, "7", 2400)).toBe(ANSWER);
    // Аудиосекция с тем же mid не видео — не трогаем.
    expect(withStartBitrate(ANSWER, "0", 2400)).toBe(ANSWER);
  });

  it("SDP с \\n вместо \\r\\n — тот же разделитель на выходе", () => {
    const lf = ANSWER.replaceAll("\r\n", "\n");
    const out = withStartBitrate(lf, "1", 1000);
    expect(out.includes("\r")).toBe(false);
    expect(out).toContain("a=fmtp:96 x-google-start-bitrate=1000");
  });
});

describe("screenVideoPublishOptions", () => {
  it("игры: дешёвый нижний слой 360p15 и плавность (C-1, C-6)", () => {
    const o = screenVideoPublishOptions("smooth", { width: 1920, height: 1080 });
    expect(o.simulcast).toBe(true);
    expect(o.screenShareEncoding).toEqual({ maxBitrate: 6_000_000, maxFramerate: 60 });
    expect(o.screenShareSimulcastLayers).toHaveLength(1);
    expect(o.screenShareSimulcastLayers?.[0]).toMatchObject({
      width: 640,
      height: 360,
      encoding: { maxBitrate: 400_000, maxFramerate: 15 },
    });
    expect(o.degradationPreference).toBe("maintain-framerate");
  });

  it("текст: без нижнего слоя, держим резкость", () => {
    const o = screenVideoPublishOptions("text", { width: 2560, height: 1440 });
    expect(o.simulcast).toBe(false);
    expect(o.screenShareSimulcastLayers).toBeUndefined();
    expect(o.degradationPreference).toBe("maintain-resolution");
  });

  it("слои — новый массив на каждый вызов (LiveKit сортирует на месте)", () => {
    const a = screenVideoPublishOptions("smooth", { width: 1920, height: 1080 });
    const b = screenVideoPublishOptions("smooth", { width: 1920, height: 1080 });
    expect(a.screenShareSimulcastLayers).not.toBe(b.screenShareSimulcastLayers);
  });
});

describe("SCREEN_AUDIO_PUBLISH", () => {
  it("стерео 128 кбит/с без DTX и RED — перекрывает голосовые настройки", () => {
    expect(SCREEN_AUDIO_PUBLISH).toMatchObject({
      audioPreset: { maxBitrate: 128_000 },
      forceStereo: true,
      dtx: false,
      red: false,
    });
  });
});

describe("смена профиля на лету", () => {
  const two: RTCRtpEncodingParameters[] = [
    { rid: "q", maxBitrate: 400_000, maxFramerate: 15, scaleResolutionDownBy: 3 },
    { rid: "h", maxBitrate: 6_000_000, maxFramerate: 60, scaleResolutionDownBy: 1 },
  ];
  const fullHd = { width: 1920, height: 1080, frameRate: 60 };

  it("«Игры» → «Лёгкий»: верхний слой уменьшается кодировщиком, захват не трогаем", () => {
    const r = liveSwitch(two, fullHd, "smooth", "light");
    expect(r.encodings[1]).toMatchObject({ rid: "h", scaleResolutionDownBy: 1.5, maxBitrate: 3_500_000, maxFramerate: 60 });
    expect(r.encodings[0]).toMatchObject({ rid: "q", scaleResolutionDownBy: 3, maxFramerate: 15 });
    expect(r.effective).toEqual({ width: 1280, height: 720, frameRate: 60 });
    expect(r.restart).toBeNull();
  });

  it("«Игры» → «Текст»: 15 к/с и битрейт текста; рамка 1440p упирается в захват 1080p", () => {
    const r = liveSwitch(two, fullHd, "smooth", "text");
    expect(r.encodings[1]).toMatchObject({ scaleResolutionDownBy: 1, maxBitrate: 3_000_000, maxFramerate: 15 });
    expect(r.effective).toEqual({ width: 1920, height: 1080, frameRate: 15 });
    // Захват упёрся в рамку «Игр» — экран, возможно, больше: честно советуем перезапуск.
    expect(r.restart).toBe("pixels");
  });

  it("маленький экран не упирается в рамку — перезапуск не нужен", () => {
    const laptop = { width: 1366, height: 768, frameRate: 60 };
    expect(liveSwitch(two, laptop, "smooth", "max").restart).toBeNull();
    expect(liveSwitch(two, fullHd, "smooth", "max").restart).toBe("pixels");
  });

  it("из «Текста»: кадров не хватает и нижнего слоя нет — нужен перезапуск", () => {
    const one: RTCRtpEncodingParameters[] = [{ maxBitrate: 4_000_000, maxFramerate: 15 }];
    const r = liveSwitch(one, { width: 2560, height: 1440, frameRate: 15 }, "text", "smooth");
    expect(r.encodings).toHaveLength(1);
    expect(r.encodings[0]).toMatchObject({ maxFramerate: 15 });
    expect(r.encodings[0].scaleResolutionDownBy).toBeCloseTo(4 / 3);
    // Сначала — кадры: 15 → 60 без нового захвата не поднять.
    expect(r.restart).toBe("frames");
    const sameFps = liveSwitch(one, { width: 2560, height: 1440, frameRate: 60 }, "text", "smooth");
    expect(sameFps.restart).toBe("layer");
  });

  it("исходные параметры не меняются", () => {
    liveSwitch(two, fullHd, "smooth", "light");
    expect(two[1].maxBitrate).toBe(6_000_000);
  });
});

describe("captureErrorText", () => {
  it("закрыли окно выбора — не ошибка, молчим", () => {
    expect(captureErrorText({ name: "NotAllowedError", message: "Permission denied" })).toBeNull();
  });

  it("запрет в системе и прочие сбои — понятный текст", () => {
    expect(captureErrorText({ name: "NotAllowedError", message: "Permission denied by system" })).toMatch(
      /настройках системы/,
    );
    expect(captureErrorText({ name: "NotReadableError" })).toMatch(/недоступен/);
    expect(captureErrorText({ name: "AbortError" })).toMatch(/Попробуйте ещё раз/);
  });
});

describe("screenDegradation", () => {
  it("игры держат кадры, текст — резкость", () => {
    expect(screenDegradation("max")).toBe("maintain-framerate");
    expect(screenDegradation("text")).toBe("maintain-resolution");
  });
});

describe("describeCapture", () => {
  it("размер и кадры", () => {
    expect(describeCapture(1920, 1080, 59.94)).toBe("1920×1080,\u00a060\u00a0к/с");
  });
});
