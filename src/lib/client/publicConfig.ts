// Настройки сайта для браузера (GET /api/config, А3): разбор ответа с безопасными
// значениями по умолчанию. Сервер недоступен или ответил криво — всё работает как
// обычно (флаги по умолчанию, без объявлений и без обслуживания), а не ломается.
import {
  FEATURE_FLAGS,
  RULES_VERSION,
  type FeatureFlagName,
  type PublicConfigResponse,
} from "@/lib/api/platform";
import { parseAnnouncements } from "./announcements";
import { isScreenQualityCap } from "./screenCap";

const FLAG_NAMES = Object.keys(FEATURE_FLAGS) as FeatureFlagName[];

function defaultFlags(): Record<FeatureFlagName, boolean> {
  return Object.fromEntries(FLAG_NAMES.map((n) => [n, FEATURE_FLAGS[n].defaultOn])) as Record<FeatureFlagName, boolean>;
}

/** Как будто сервер ничего не ограничил. */
export const FALLBACK_PUBLIC_CONFIG: PublicConfigResponse = {
  flags: defaultFlags(),
  maxScreenQuality: "1440p",
  announcements: [],
  maintenance: { enabled: false, message: "", blockNewRooms: false, blockJoins: false },
  rulesVersion: RULES_VERSION,
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Ответ /api/config из сети → проверенный объект; чего нет или криво — по умолчанию. */
export function parsePublicConfig(raw: unknown): PublicConfigResponse {
  if (!isRecord(raw)) return FALLBACK_PUBLIC_CONFIG;
  const flags = defaultFlags();
  if (isRecord(raw.flags)) {
    for (const n of FLAG_NAMES) if (typeof raw.flags[n] === "boolean") flags[n] = raw.flags[n] as boolean;
  }
  const m = isRecord(raw.maintenance) ? raw.maintenance : {};
  const enabled = m.enabled === true;
  return {
    flags,
    maxScreenQuality: isScreenQualityCap(raw.maxScreenQuality) ? raw.maxScreenQuality : "1440p",
    announcements: parseAnnouncements(raw.announcements),
    maintenance: {
      enabled,
      message: typeof m.message === "string" ? m.message.trim() : "",
      // Запреты действуют только при включённом режиме обслуживания.
      blockNewRooms: enabled && m.blockNewRooms === true,
      blockJoins: enabled && m.blockJoins === true,
    },
    rulesVersion: typeof raw.rulesVersion === "string" && raw.rulesVersion ? raw.rulesVersion : RULES_VERSION,
  };
}

/** Текст обслуживания для человека: свой от администрации или общий. */
export function maintenanceText(cfg: PublicConfigResponse): string {
  return cfg.maintenance.message || "Сейчас идут технические работы. Попробуйте чуть позже.";
}

/** Можно ли сейчас создать комнату и, если нельзя, почему. */
export function createRoomBlock(cfg: PublicConfigResponse): string | null {
  if (cfg.maintenance.blockNewRooms) return maintenanceText(cfg);
  if (!cfg.flags.create_room) return "Создание новых комнат временно выключено. Войти в уже открытую комнату можно как обычно.";
  return null;
}
