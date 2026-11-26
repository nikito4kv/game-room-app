import { describe, expect, it } from "vitest";
import { RULES_VERSION } from "@/lib/api/platform";
import { FALLBACK_PUBLIC_CONFIG, createRoomBlock, maintenanceText, parsePublicConfig } from "./publicConfig";

describe("parsePublicConfig", () => {
  it("мусор — безопасные значения по умолчанию", () => {
    expect(parsePublicConfig(null)).toEqual(FALLBACK_PUBLIC_CONFIG);
    expect(parsePublicConfig("x")).toEqual(FALLBACK_PUBLIC_CONFIG);
    expect(FALLBACK_PUBLIC_CONFIG.flags.chat).toBe(true);
    expect(FALLBACK_PUBLIC_CONFIG.rulesVersion).toBe(RULES_VERSION);
  });

  it("берёт известные флаги, неизвестные и кривые пропускает", () => {
    const c = parsePublicConfig({ flags: { chat: false, reports: "no", magic: true }, maxScreenQuality: "720p" });
    expect(c.flags.chat).toBe(false);
    expect(c.flags.reports).toBe(true);
    expect("magic" in c.flags).toBe(false);
    expect(c.maxScreenQuality).toBe("720p");
    expect(parsePublicConfig({ maxScreenQuality: "8k" }).maxScreenQuality).toBe("1440p");
  });

  it("запреты обслуживания — только при включённом режиме", () => {
    const off = parsePublicConfig({ maintenance: { enabled: false, blockNewRooms: true, message: "x" } });
    expect(off.maintenance.blockNewRooms).toBe(false);
    const on = parsePublicConfig({ maintenance: { enabled: true, blockNewRooms: true, message: " Обновляемся " } });
    expect(on.maintenance).toEqual({ enabled: true, message: "Обновляемся", blockNewRooms: true, blockJoins: false });
  });
});

describe("createRoomBlock", () => {
  it("обслуживание — свой текст или общий; выключенный флаг — свой текст; иначе можно", () => {
    expect(createRoomBlock(FALLBACK_PUBLIC_CONFIG)).toBeNull();
    const m = parsePublicConfig({ maintenance: { enabled: true, blockNewRooms: true, message: "" } });
    expect(createRoomBlock(m)).toBe(maintenanceText(m));
    expect(maintenanceText(m)).toMatch(/технические работы/);
    expect(createRoomBlock(parsePublicConfig({ flags: { create_room: false } }))).toMatch(/временно выключено/);
  });
});
