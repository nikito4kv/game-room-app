import { describe, expect, it } from "vitest";
import {
  DEFAULT_CAPTURE_SETTINGS,
  VOICE_PUBLISH_DEFAULTS,
  captureMatches,
  micCaptureDefaults,
  micRestartOptions,
  micTestConstraints,
  sanitizeCaptureSettings,
} from "./voiceOptions";
import type { DeviceInfo } from "./devices";
import { DEFAULT_VOICE_SETTINGS, sanitizeVoiceSettings } from "./worklet/protocol";

describe("настройки захвата", () => {
  it("по умолчанию: эхоподавление вкл, автогромкость браузера выкл; мусор — по умолчанию", () => {
    expect(DEFAULT_CAPTURE_SETTINGS).toEqual({ echoCancellation: true, autoGainControl: false });
    expect(sanitizeCaptureSettings(null)).toEqual(DEFAULT_CAPTURE_SETTINGS);
    expect(sanitizeCaptureSettings({ echoCancellation: "да", autoGainControl: true })).toEqual({
      echoCancellation: true,
      autoGainControl: true,
    });
  });

  // Как отдаёт Chrome на Windows (служебные записи + настоящие), и Firefox — без default.
  const chrome: DeviceInfo[] = [
    { kind: "audioinput", deviceId: "default", groupId: "g1", label: "По умолчанию - DualSense" },
    { kind: "audioinput", deviceId: "communications", groupId: "g1", label: "Оборудование - DualSense" },
    { kind: "audioinput", deviceId: "usb", groupId: "g1", label: "DualSense" },
    { kind: "audioinput", deviceId: "cam", groupId: "g2", label: "V380 FHD Camera" },
  ];
  const firefox: DeviceInfo[] = [{ kind: "audioinput", deviceId: "ff-1", groupId: "g", label: "Mic" }];

  it("перезапуск дорожки несёт всю обработку и устройство — всегда точно", () => {
    expect(micRestartOptions("usb", { echoCancellation: false, autoGainControl: true }, true, chrome)).toEqual({
      channelCount: 1,
      echoCancellation: false,
      autoGainControl: true,
      noiseSuppression: false,
      voiceIsolation: false,
      deviceId: { exact: "usb" },
    });
    // «Как в системе» в Chrome — точно запись default, а не «любимый» микрофон Chrome.
    expect(micRestartOptions("default", DEFAULT_CAPTURE_SETTINGS, true, chrome).deviceId).toEqual({ exact: "default" });
    // В Firefox записи default нет — без ограничения, браузер берёт системный.
    expect(micRestartOptions("default", DEFAULT_CAPTURE_SETTINGS, true, firefox).deviceId).toBeUndefined();
    // Выбранный пропал — системный; человек только что выбрал сам (strict) — точно он.
    expect(micRestartOptions("gone", DEFAULT_CAPTURE_SETTINGS, true, chrome).deviceId).toEqual({ exact: "default" });
    expect(micRestartOptions("gone", DEFAULT_CAPTURE_SETTINGS, true, chrome, true).deviceId).toEqual({ exact: "gone" });
    // Наш шумодав сломался — браузерный включается.
    expect(micRestartOptions("usb", DEFAULT_CAPTURE_SETTINGS, false, chrome)).toMatchObject({ noiseSuppression: true });
  });

  it("captureMatches: те же флаги и то же точное устройство — перезапуск не нужен", () => {
    const ours = micRestartOptions("usb", DEFAULT_CAPTURE_SETTINGS, true, chrome);
    expect(captureMatches({ ...ours } as MediaTrackConstraints, ours)).toBe(true);
    // LiveKit сам переоткрыл выдернутый микрофон с { deviceId: "default" } — флагов нет.
    expect(captureMatches({ deviceId: "default" }, ours)).toBe(false);
    expect(captureMatches(ours as MediaTrackConstraints, { ...ours, echoCancellation: false })).toBe(false);
  });

  it("captureMatches: открыт мягко или другой микрофон — перезапускаем точно", () => {
    const ours = micRestartOptions("usb", DEFAULT_CAPTURE_SETTINGS, true, chrome);
    // Так было до исправления: { ideal } — и Chrome открывал веб-камеру.
    expect(captureMatches({ ...ours, deviceId: { ideal: "usb" } } as MediaTrackConstraints, ours)).toBe(false);
    // LiveKit после захвата пишет в ограничения фактический микрофон строкой.
    expect(captureMatches({ ...ours, deviceId: "cam" } as MediaTrackConstraints, ours)).toBe(false);
    expect(captureMatches({ ...ours, deviceId: { exact: "cam" } } as MediaTrackConstraints, ours)).toBe(false);
    const system = micRestartOptions("default", DEFAULT_CAPTURE_SETTINGS, true, chrome);
    expect(captureMatches({ ...system, deviceId: { ideal: "default" } } as MediaTrackConstraints, system)).toBe(false);
    expect(captureMatches({ ...system } as MediaTrackConstraints, system)).toBe(true);
  });

  it("captureMatches: без точного устройства (Firefox) подходит любое — лишних перезапусков нет", () => {
    const ff = micRestartOptions("default", DEFAULT_CAPTURE_SETTINGS, true, firefox);
    // LiveKit дописывает { ideal: "default" }, а после захвата — фактический id строкой.
    expect(captureMatches({ ...ff, deviceId: { ideal: "default" } } as MediaTrackConstraints, ff)).toBe(true);
    expect(captureMatches({ ...ff, deviceId: "ff-1" } as MediaTrackConstraints, ff)).toBe(true);
  });
});

describe("micCaptureDefaults", () => {
  it("моно, эхоподавление вкл, браузерные автогромкость и шумодав выкл", () => {
    expect(micCaptureDefaults()).toEqual({
      channelCount: 1,
      echoCancellation: true,
      autoGainControl: false,
      noiseSuppression: false,
      voiceIsolation: false,
    });
  });

  it("наш шумодав недоступен — браузерный включается; флаги можно переопределить", () => {
    expect(micCaptureDefaults(undefined, { ourNoiseSuppression: false })).toMatchObject({
      noiseSuppression: true,
      voiceIsolation: true,
    });
    expect(micCaptureDefaults(undefined, { echoCancellation: false, autoGainControl: true })).toMatchObject({
      echoCancellation: false,
      autoGainControl: true,
    });
  });

  it("устройство — как передали", () => {
    expect(micCaptureDefaults({ exact: "usb" }).deviceId).toEqual({ exact: "usb" });
  });
});

describe("micTestConstraints", () => {
  const chrome: DeviceInfo[] = [
    { kind: "audioinput", deviceId: "default", groupId: "g1", label: "По умолчанию - DualSense" },
    { kind: "audioinput", deviceId: "usb", groupId: "g1", label: "DualSense" },
  ];

  it("выбранный микрофон — точно, даже если его нет в списке: тест слушает именно его", () => {
    expect(micTestConstraints("usb", {}, chrome).deviceId).toEqual({ exact: "usb" });
    expect(micTestConstraints("gone", {}, chrome).deviceId).toEqual({ exact: "gone" });
    expect(micTestConstraints("usb")).toMatchObject({ autoGainControl: false, noiseSuppression: false });
  });
  it("«Как в системе»: в Chrome — точно default, список неизвестен или Firefox — без deviceId", () => {
    expect(micTestConstraints("default", {}, chrome).deviceId).toEqual({ exact: "default" });
    expect(micTestConstraints(null, {}, chrome).deviceId).toEqual({ exact: "default" });
    expect(micTestConstraints("default").deviceId).toBeUndefined();
    expect(micTestConstraints(null).deviceId).toBeUndefined();
  });
});

describe("VOICE_PUBLISH_DEFAULTS", () => {
  it("Opus моно 64 кбит/с, DTX и RED", () => {
    expect(VOICE_PUBLISH_DEFAULTS).toMatchObject({
      audioPreset: { maxBitrate: 64_000 },
      dtx: true,
      red: true,
      forceStereo: false,
    });
  });
});

describe("sanitizeVoiceSettings", () => {
  it("пределы и мусор", () => {
    const s = sanitizeVoiceSettings({
      manualThresholdDb: -200,
      sensitivityDb: 40,
      gain: 7,
      gateMode: "loud" as never,
      autoGain: "yes" as never,
    });
    expect(s.manualThresholdDb).toBe(-70);
    expect(s.sensitivityDb).toBe(10);
    expect(s.gain).toBe(2);
    expect(s.gateMode).toBe(DEFAULT_VOICE_SETTINGS.gateMode);
    expect(s.autoGain).toBe(DEFAULT_VOICE_SETTINGS.autoGain);
  });

  it("частичное обновление поверх текущих", () => {
    const base = sanitizeVoiceSettings({ gateMode: "manual", gain: 1.5 });
    expect(sanitizeVoiceSettings({ gain: NaN }, base)).toMatchObject({ gateMode: "manual", gain: 1.5 });
  });
});
