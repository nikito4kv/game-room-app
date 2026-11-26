import { describe, expect, it } from "vitest";
import {
  checkModeration,
  decideClaim,
  isModerationAction,
  type ModerationCheckInput,
} from "./moderationRules";

const base: ModerationCheckInput = {
  action: "kick",
  caller: "u_host",
  target: "u_guest",
  hostIdentity: "u_host",
  ownerIdentity: "u_owner",
  targetPresent: true,
  targetKnown: true,
};

describe("checkModeration", () => {
  it("хост может кикнуть гостя", () => {
    expect(checkModeration(base)).toBeNull();
  });

  it("не хост — NOT_HOST", () => {
    expect(checkModeration({ ...base, caller: "u_guest", target: "u_other" })?.code).toBe("NOT_HOST");
  });

  it("владелец неуязвим для кика, бана, мьюта и запрета чата", () => {
    for (const action of ["kick", "ban", "mute", "chatMute"] as const) {
      expect(checkModeration({ ...base, action, target: "u_owner" })?.code).toBe("TARGET_IS_OWNER");
    }
  });

  it("владельцу можно снять мьют, разрешить экран, остановить экран и передать права", () => {
    for (const action of ["unmute", "chatUnmute", "allowScreen", "stopScreen", "transfer"] as const) {
      expect(checkModeration({ ...base, action, target: "u_owner" })).toBeNull();
    }
  });

  it("к себе — нельзя кикнуть, забанить, заглушить, передать права", () => {
    for (const action of ["kick", "ban", "mute", "chatMute", "transfer"] as const) {
      expect(checkModeration({ ...base, action, target: "u_host" })?.code).toBe("TARGET_IS_SELF");
    }
  });

  it("цель: present — только присутствующий, known — и недавно вышедший", () => {
    const gone = { ...base, targetPresent: false, targetKnown: true };
    expect(checkModeration({ ...gone, action: "transfer" })?.code).toBe("TARGET_NOT_FOUND");
    expect(checkModeration({ ...gone, action: "stopScreen" })?.code).toBe("TARGET_NOT_FOUND");
    expect(checkModeration({ ...gone, action: "kick" })).toBeNull();
    expect(checkModeration({ ...gone, action: "ban" })).toBeNull();
    const stranger = { ...base, targetPresent: false, targetKnown: false };
    expect(checkModeration({ ...stranger, action: "ban" })?.code).toBe("TARGET_NOT_FOUND");
    expect(checkModeration({ ...stranger, action: "unban" })).toBeNull();
  });

  it("без цели там, где она нужна, — BAD_REQUEST", () => {
    expect(checkModeration({ ...base, target: null })?.code).toBe("BAD_REQUEST");
  });

  it("действия без цели", () => {
    for (const action of ["settings", "bans", "muteAll"] as const) {
      expect(checkModeration({ ...base, action, target: null })).toBeNull();
    }
  });

  it("claim и reclaim не требуют быть хостом", () => {
    expect(checkModeration({ ...base, action: "claim", caller: "u_guest", target: null })).toBeNull();
    expect(checkModeration({ ...base, action: "reclaim", caller: "u_owner", target: null })).toBeNull();
  });
});

describe("isModerationAction", () => {
  it("знает только свои действия", () => {
    expect(isModerationAction("kick")).toBe(true);
    expect(isModerationAction("lock")).toBe(false);
    expect(isModerationAction("toString")).toBe(false);
    expect(isModerationAction(1)).toBe(false);
  });
});

describe("decideClaim — пауза после ухода хоста", () => {
  const now = 1_000_000;
  const claim = { now, caller: "u_me", hostIdentity: "u_host", hostPresent: false };

  it("хост в комнате — HOST_PRESENT", () => {
    const d = decideClaim({ ...claim, hostPresent: true, vacantSince: now - 60_000 });
    expect(d).toMatchObject({ kind: "refuse", error: { code: "HOST_PRESENT" } });
  });

  it("хост ушёл 10 с назад — ждать ещё 20 с", () => {
    const d = decideClaim({ ...claim, vacantSince: now - 10_000 });
    expect(d).toMatchObject({
      kind: "refuse",
      error: { code: "HOST_HANDOVER_PENDING", retryAfterSec: 20 },
    });
  });

  it("прошло 30 с — можно занять", () => {
    expect(decideClaim({ ...claim, vacantSince: now - 30_000 })).toEqual({ kind: "grant" });
  });

  it("время ухода неизвестно — начать отсчёт", () => {
    expect(decideClaim({ ...claim, vacantSince: null })).toEqual({ kind: "startCountdown" });
  });

  it("хоста не было с создания комнаты — отсчёт от создания", () => {
    expect(decideClaim({ ...claim, hostIdentity: null, vacantSince: now - 5_000 })).toMatchObject({
      kind: "refuse",
      error: { code: "HOST_HANDOVER_PENDING" },
    });
    expect(decideClaim({ ...claim, hostIdentity: null, vacantSince: now - 31_000 })).toEqual({ kind: "grant" });
  });

  it("сам уже хост — нечего занимать", () => {
    expect(decideClaim({ ...claim, hostIdentity: "u_me", vacantSince: null })).toEqual({ kind: "already" });
  });
});
