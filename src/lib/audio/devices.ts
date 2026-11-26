// Чистая логика устройств звука: какое устройство сейчас «по умолчанию», пропал
// ли выбранный микрофон, как назвать устройство человеку. Без обращения к
// браузеру — на вход список из enumerateDevices().

/** Минимум полей MediaDeviceInfo, нужный логике (удобно в тестах). */
export type DeviceInfo = Pick<MediaDeviceInfo, "deviceId" | "groupId" | "kind" | "label">;

/** Выбор «как в системе». В Chrome это настоящий deviceId, в Firefox — наш условный. */
export const DEFAULT_DEVICE = "default";

/** Служебные записи Chrome: «по умолчанию» и «для связи» — не настоящие устройства. */
const ALIASES = new Set([DEFAULT_DEVICE, "communications"]);

export function isAlias(deviceId: string): boolean {
  return ALIASES.has(deviceId);
}

/**
 * Устройство, которое сейчас стоит в системе по умолчанию. Chrome отдаёт его
 * отдельной записью «default», Firefox и Safari — первым в списке.
 */
export function findDefaultDevice<T extends DeviceInfo>(devices: T[], kind: MediaDeviceKind): T | undefined {
  const ofKind = devices.filter((d) => d.kind === kind);
  return ofKind.find((d) => d.deviceId === DEFAULT_DEVICE) ?? ofKind[0];
}

/**
 * «Подпись» устройства по умолчанию: меняется, когда Windows переключила
 * устройство по умолчанию (у записи «default» в Chrome при этом меняются
 * groupId и название, а deviceId остаётся «default»).
 */
export function defaultDeviceSignature(devices: DeviceInfo[], kind: MediaDeviceKind): string {
  const d = findDefaultDevice(devices, kind);
  return d ? `${d.deviceId}|${d.groupId}|${d.label}` : "";
}

/** Есть ли выбранное устройство в списке. «Как в системе» есть всегда, пока есть хоть что-то. */
export function isDeviceAvailable(deviceId: string, devices: DeviceInfo[], kind: MediaDeviceKind): boolean {
  const ofKind = devices.filter((d) => d.kind === kind);
  if (deviceId === DEFAULT_DEVICE) return ofKind.length > 0;
  return ofKind.some((d) => d.deviceId === deviceId);
}

/**
 * Какой микрофон просить у браузера — только точно (exact).
 *
 * Chrome на компьютере при мягком (ideal) или пустом deviceId выбирает микрофон
 * сам: страница передаёт ему все подходящие, а он берёт первый по своему рейтингу
 * «любимых» (media.audio_input.user_preference_ranking в профиле; его двигает
 * выбор в запросе разрешения и в настройках сайта) — просьба страницы теряется.
 * У автора первой в рейтинге стоит веб-камера (16 кГц): после любого
 * перезапуска дорожки вместо выбранного DualSense говорила она.
 *
 *  • выбран микрофон и он в списке — он;
 *  • «Как в системе» — запись «default»: в Chrome это устройство по умолчанию в
 *    Windows (его имя и стоит в пункте «Как в системе»). Где такой записи нет
 *    (Firefox, Safari), ограничения нет — браузер сам берёт системное;
 *  • выбранного в списке нет (выдернули) — как «Как в системе». strict — человек
 *    только что выбрал его сам: просим точно, не открылся — пусть узнает.
 *
 * devices — enumerateDevices(). Пустой или без deviceId (нет разрешения) — список
 * неизвестен: выбранный просим точно, «Как в системе» — без ограничения.
 */
export function micDeviceConstraint(
  choice: string | null | undefined,
  devices: DeviceInfo[],
  strict = false,
): ConstrainDOMString | undefined {
  const inputs = devices.filter((d) => d.kind === "audioinput" && d.deviceId);
  if (choice && choice !== DEFAULT_DEVICE) {
    if (strict || inputs.length === 0 || inputs.some((d) => d.deviceId === choice)) return { exact: choice };
  }
  return inputs.some((d) => d.deviceId === DEFAULT_DEVICE) ? { exact: DEFAULT_DEVICE } : undefined;
}

/**
 * Во что превратить выбор вывода для AudioContext.setSinkId. «Как в системе» —
 * в настоящее устройство за записью «default» (по groupId): строку «default»
 * Web Audio не принимает. Не нашли — пустая строка, это системный вывод по
 * спецификации. Так же делает LiveKit (DeviceManager.normalizeDeviceId), чтобы его
 * собственное переключение не спорило с нашим.
 */
export function resolveOutputSinkId(deviceId: string, devices: DeviceInfo[]): string {
  if (deviceId !== DEFAULT_DEVICE) return deviceId;
  const outputs = devices.filter((d) => d.kind === "audiooutput");
  const def = outputs.find((d) => d.deviceId === DEFAULT_DEVICE);
  if (!def) return "";
  const real = outputs.find((d) => !isAlias(d.deviceId) && d.groupId === def.groupId);
  return real?.deviceId ?? "";
}

/**
 * Название устройства для человека. У записи «default» Chrome пишет «Default -
 * Микрофон (HyperX)» (или «По умолчанию - …» в русской Windows) — приставку
 * убираем: это уже сказано пунктом «Как в системе». Пустое название (нет
 * разрешения) — запасное слово.
 */
export function deviceLabel(device: DeviceInfo | undefined, fallback: string): string {
  const label = device?.label.trim() ?? "";
  if (!label) return fallback;
  return label.replace(/^(Default|По умолчанию|Communications|Связь)\s*[-–—]\s*/i, "");
}

/** Варианты для выпадающего списка: «Как в системе (HyperX)» + настоящие устройства без служебных записей. */
export function deviceOptions(
  devices: DeviceInfo[],
  kind: MediaDeviceKind,
  fallback: string,
): { value: string; label: string }[] {
  const ofKind = devices.filter((d) => d.kind === kind);
  const def = findDefaultDevice(devices, kind);
  const defName = def ? deviceLabel(def, "") : "";
  const options = [{ value: DEFAULT_DEVICE, label: defName ? `Как в системе (${defName})` : "Как в системе" }];
  let n = 0;
  for (const d of ofKind) {
    if (isAlias(d.deviceId) || !d.deviceId) continue;
    n += 1;
    options.push({ value: d.deviceId, label: deviceLabel(d, `${fallback} ${n}`) });
  }
  return options;
}
