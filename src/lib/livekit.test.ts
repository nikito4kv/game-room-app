import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccessToken, TokenVerifier, TrackSource, TwirpError } from "livekit-server-sdk";
import {
  createParticipantToken,
  generateHostKey,
  generateRoomCode,
  hashPassword,
  hashSeatSecret,
  isNotFoundError,
  normalizeRoomCode,
  seatSecretMatches,
  verifyParticipantToken,
  verifyPassword,
} from "@/lib/livekit";
import { permissionFor } from "@/lib/server/permissions";

describe("hashPassword / verifyPassword", () => {
  it("принимает верный пароль и отвергает неверный", async () => {
    const stored = await hashPassword("s3cret");
    expect(stored).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(await verifyPassword("s3cret", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });
  it("повреждённый хэш — отказ", async () => {
    expect(await verifyPassword("x", "deadbeef")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
  });
  it("разные соли — разные хэши одного пароля", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", b)).toBe(true);
  });
});

describe("секрет места", () => {
  it("sha256 и сравнение за постоянное время", () => {
    const h = hashSeatSecret("secret-1");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(seatSecretMatches("secret-1", h)).toBe(true);
    expect(seatSecretMatches("secret-2", h)).toBe(false);
    expect(seatSecretMatches("secret-1", "abc")).toBe(false);
  });
});

describe("коды и ключи", () => {
  it("код — 6 символов из алфавита без 0/O/1/I/L", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateRoomCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });
  it("normalizeRoomCode: верхний регистр, мусор — null", () => {
    expect(normalizeRoomCode(" k7qmp4 ")).toBe("K7QMP4");
    expect(normalizeRoomCode("ab:cd")).toBeNull();
    expect(normalizeRoomCode("")).toBeNull();
    expect(normalizeRoomCode(42)).toBeNull();
  });
  it("ключ владельца — 48 hex", () => {
    expect(generateHostKey()).toMatch(/^[0-9a-f]{48}$/);
  });
  it("isNotFoundError узнаёт «не найдено» LiveKit", () => {
    expect(isNotFoundError(new TwirpError("Not Found", "x", 404, "not_found"))).toBe(true);
    expect(isNotFoundError(new TwirpError("x", "y", 500))).toBe(false);
    expect(isNotFoundError(new Error("x"))).toBe(false);
  });
});

describe("токены", () => {
  const API_KEY = "devkey";
  // HS256 требует ключ ≥ 256 бит — берём заведомо длинный секрет.
  const API_SECRET = "test-secret-test-secret-test-secret-1234";
  const CODE = "ROOM01";
  const saved: Record<string, string | undefined> = {};

  beforeAll(() => {
    // Верификатор — ленивый синглтон: env должна стоять до первого вызова.
    for (const k of ["LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]) saved[k] = process.env[k];
    process.env.LIVEKIT_API_KEY = API_KEY;
    process.env.LIVEKIT_API_SECRET = API_SECRET;
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  async function mint(opts: { identity: string; room: string; ttl: number | string; secret?: string }) {
    const at = new AccessToken(API_KEY, opts.secret ?? API_SECRET, {
      identity: opts.identity,
      name: "Аня",
      ttl: opts.ttl,
    });
    at.addGrant({ roomJoin: true, room: opts.room });
    return at.toJwt();
  }

  it("verifyParticipantToken: срок игнорируется — это доказательство личности", async () => {
    const expired = await mint({ identity: "u_a", room: CODE, ttl: -60 });
    expect(await verifyParticipantToken(expired, CODE)).toEqual({ identity: "u_a", name: "Аня" });
  });

  it("чужая комната или подпись — null", async () => {
    expect(await verifyParticipantToken(await mint({ identity: "u_a", room: "OTHER1", ttl: "1h" }), CODE)).toBeNull();
    const forged = await mint({
      identity: "u_a",
      room: CODE,
      ttl: "1h",
      secret: "another-secret-another-secret-another-99",
    });
    expect(await verifyParticipantToken(forged, CODE)).toBeNull();
    expect(await verifyParticipantToken("мусор", CODE)).toBeNull();
  });

  it("createParticipantToken: ник, metadata и полные права из permissionFor", async () => {
    const permission = permissionFor(
      { screen: "host", chat: "all" },
      { isHost: false, forceMuted: false, chatMuted: false, screenAllowed: false },
    );
    const jwt = await createParticipantToken({
      room: CODE,
      identity: "u_a",
      name: "Аня",
      metadata: '{"forceMuted":false}',
      permission,
    });
    const claims = await new TokenVerifier(API_KEY, API_SECRET).verify(jwt);
    expect(claims.sub).toBe("u_a");
    expect(claims.name).toBe("Аня");
    expect(claims.metadata).toBe('{"forceMuted":false}');
    expect(claims.video).toMatchObject({
      roomJoin: true,
      room: CODE,
      canPublish: true,
      canPublishData: false,
      canSubscribe: true,
      canUpdateOwnMetadata: false,
    });
    // В JWT источники записаны строками — так их читает сервер LiveKit.
    expect(claims.video?.canPublishSources).toEqual(["microphone"]);
    expect(permission.canPublishSources).toEqual([TrackSource.MICROPHONE]);
  });
});
