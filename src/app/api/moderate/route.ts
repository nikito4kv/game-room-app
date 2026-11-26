import { NextResponse } from "next/server";
import type { ParticipantInfo } from "livekit-server-sdk";
import {
  CHAT_POLICIES,
  HOST_HANDOVER_DELAY_SEC,
  KICK_BLOCK_SEC,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SCREEN_POLICIES,
  type ApiError,
  type ModerateResponse,
  type ModerationCommand,
  type RoomSettingsPatch,
} from "@/lib/api/contract";
import {
  hashPassword,
  normalizeRoomCode,
  verifyParticipantToken,
  verifyPassword,
} from "@/lib/livekit";
import {
  blockAfterKick,
  casHost,
  clearKick,
  loadAuth,
  loadBans,
  loadHostLeftAt,
  loadName,
  loadRoomFlags,
  loadRoomMeta,
  markHostLeft,
  setParticipantFlag,
  setPasswordHash,
  touchRoomState,
  updateRoomMeta,
  type ParticipantFlag,
  type RoomMetaPatch,
  type StoredRoomMeta,
} from "@/lib/roomSecret";
import { clientIp, consumeLimit, moderateLimit } from "@/lib/ratelimit";
import { apiError, errorResponse, failureFrom, retryError } from "@/lib/server/errors";
import { checkModeration, decideClaim, isModerationAction } from "@/lib/server/moderationRules";
import { optionalString, readJsonObject } from "@/lib/server/request";
import {
  listParticipantsOrEmpty,
  loadRoomMetaOrAdopt,
  mirrorRoomMeta,
  participantState,
  removeWithReason,
  screenBlockedFor,
  softMuteAll,
  stopScreenShare,
  syncParticipants,
} from "@/lib/server/roomSync";
import { emitFeatureOnce, emitSignal } from "@/lib/platform/signals";

// POST /api/moderate — действия хоста, владельца и «занять место хоста».
// Контракт — src/lib/api/contract.ts (ModerateRequest / ModerationCommand).
// Всё выполняет сервер ключами LiveKit: у клиента нет прав администратора комнаты,
// сам он ничего из этого сделать не может. Кто вызывает — по подписи его
// LiveKit-токена; кроме того, вызывающий должен быть сейчас в комнате.

type Caller = { identity: string; name: string };
type Ctx = {
  code: string;
  caller: Caller;
  meta: StoredRoomMeta;
  participants: ParticipantInfo[];
};
type Parsed = { ok: true; command: ModerationCommand } | { ok: false; error: ApiError };
type Result = { ok: true; body: ModerateResponse } | { ok: false; error: ApiError };

const done = (body: ModerateResponse = { ok: true }): Result => ({ ok: true, body });
const refuse = (error: ApiError): Result => ({ ok: false, error });
const bad = (message: string): Parsed => ({ ok: false, error: apiError("BAD_REQUEST", message) });

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body) return errorResponse(apiError("BAD_REQUEST"));

  const limit = await consumeLimit(moderateLimit(), clientIp(request));
  if (limit.limited) return errorResponse(retryError("RATE_LIMITED", limit.retryAfterSec));

  const code = normalizeRoomCode(body.code);
  if (!code) return errorResponse(apiError("ROOM_NOT_FOUND"));
  const token = optionalString(body.token);
  const verified = token ? await verifyParticipantToken(token, code) : null;
  if (!verified) return errorResponse(apiError("UNAUTHORIZED"));

  const parsed = parseCommand(body);
  if (!parsed.ok) return errorResponse(parsed.error);

  try {
    const [meta, participants] = await Promise.all([
      loadRoomMetaOrAdopt(code),
      listParticipantsOrEmpty(code),
    ]);
    if (!meta) return errorResponse(apiError("ROOM_NOT_FOUND"));
    const me = participants.find((p) => p.identity === verified.identity);
    if (!me) return errorResponse(apiError("NOT_IN_ROOM"));
    const caller = { identity: verified.identity, name: me.name || verified.name || me.identity };
    const result = await execute(parsed.command, { code, caller, meta, participants });
    if (!result.ok) return errorResponse(result.error);
    reportHostAction(code, caller.identity, parsed.command);
    await touchRoomState(code);
    return NextResponse.json(result.body);
  } catch (err) {
    console.error(`moderate: ${parsed.command.action} failed`, err);
    return errorResponse(failureFrom(err));
  }
}

/** Для админки: кики и баны хоста — сигналы low, любое действие хоста — feature. */
function reportHostAction(code: string, host: string, cmd: ModerationCommand): void {
  if (cmd.action === "kick" || cmd.action === "ban") {
    void emitSignal(cmd.action === "kick" ? "host_kick" : "host_ban", "low", {
      code,
      identity: cmd.target,
      detail: `хост ${host}`,
    });
  }
  if (cmd.action !== "bans") void emitFeatureOnce("host_action", code, host);
}

function parseCommand(body: Record<string, unknown>): Parsed {
  const action = body.action;
  if (!isModerationAction(action)) return bad("Неизвестное действие");
  switch (action) {
    case "bans":
    case "muteAll":
    case "claim":
      return { ok: true, command: { action } };
    case "reclaim":
      return { ok: true, command: { action, hostKey: optionalString(body.hostKey) } };
    case "settings":
      return parseSettings(body.settings);
    default: {
      const target = optionalString(body.target);
      if (!target) return bad("Не указан участник");
      return { ok: true, command: { action, target } };
    }
  }
}

function parseSettings(raw: unknown): Parsed {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad("Нет настроек");
  const s = raw as Record<string, unknown>;
  const settings: RoomSettingsPatch = {};
  if (s.screen !== undefined) {
    const screen = SCREEN_POLICIES.find((p) => p === s.screen);
    if (!screen) return bad("Неизвестный режим показа экрана");
    settings.screen = screen;
  }
  if (s.chat !== undefined) {
    const chat = CHAT_POLICIES.find((p) => p === s.chat);
    if (!chat) return bad("Неизвестный режим чата");
    settings.chat = chat;
  }
  for (const field of ["locked", "isPublic"] as const) {
    if (s[field] === undefined) continue;
    if (typeof s[field] !== "boolean") return bad("Настройка должна быть да или нет");
    settings[field] = s[field];
  }
  if (s.password !== undefined) {
    if (s.password !== null && typeof s.password !== "string") return bad("Неверный пароль");
    const password = typeof s.password === "string" ? s.password.trim() : "";
    if (password && (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH)) {
      return { ok: false, error: apiError("INVALID_PASSWORD") };
    }
    settings.password = password || null;
  }
  if (Object.keys(settings).length === 0) return bad("Нечего менять");
  return { ok: true, command: { action: "settings", settings } };
}

async function execute(cmd: ModerationCommand, ctx: Ctx): Promise<Result> {
  if (cmd.action === "claim") return claimHost(ctx);
  if (cmd.action === "reclaim") return reclaimHost(ctx, cmd.hostKey);

  const { code, caller, meta, participants } = ctx;
  const target = "target" in cmd ? cmd.target : null;
  const targetLive = target ? participants.find((p) => p.identity === target) : undefined;
  const targetKnown = !!target && !targetLive && (await loadName(code, target)) !== null;
  const refusal = checkModeration({
    action: cmd.action,
    caller: caller.identity,
    target,
    hostIdentity: meta.hostIdentity,
    ownerIdentity: meta.ownerIdentity,
    targetPresent: !!targetLive,
    targetKnown,
  });
  if (refusal) return refuse(refusal);

  // Флаг участника в Redis + сразу применить к нему права/metadata, если он здесь.
  const setFlag = async (flag: ParticipantFlag, identity: string, on: boolean) => {
    await setParticipantFlag(code, flag, identity, on);
    if (targetLive) await syncParticipants(code, [identity]);
  };

  switch (cmd.action) {
    case "kick":
      // Кик закрывает вход на KICK_BLOCK_SEC и снимает «членство»: иначе кикнутый
      // вернулся бы и в запертую комнату.
      await Promise.all([
        blockAfterKick(code, cmd.target, KICK_BLOCK_SEC),
        setParticipantFlag(code, "members", cmd.target, false),
      ]);
      if (targetLive) await removeWithReason(code, targetLive, "kick", KICK_BLOCK_SEC);
      return done();
    case "ban":
      await Promise.all([
        setParticipantFlag(code, "banned", cmd.target, true),
        setParticipantFlag(code, "members", cmd.target, false),
      ]);
      if (targetLive) await removeWithReason(code, targetLive, "ban");
      return done();
    case "unban":
      await Promise.all([
        setParticipantFlag(code, "banned", cmd.target, false),
        clearKick(code, cmd.target),
      ]);
      return done();
    case "bans":
      return done({ ok: true, bans: await loadBans(code) });
    case "mute":
    case "unmute":
      await setFlag("muted", cmd.target, cmd.action === "mute");
      return done();
    case "chatMute":
    case "chatUnmute":
      await setFlag("chatMuted", cmd.target, cmd.action === "chatMute");
      return done();
    case "allowScreen":
    case "disallowScreen":
      await setFlag("screenAllowed", cmd.target, cmd.action === "allowScreen");
      return done();
    case "muteAll": {
      // Себя и владельца не трогаем (владелец неуязвим для мьюта).
      const except = new Set([caller.identity]);
      if (meta.ownerIdentity) except.add(meta.ownerIdentity);
      await softMuteAll(code, except);
      return done();
    }
    case "stopScreen": {
      if (!targetLive) return refuse(apiError("TARGET_NOT_FOUND"));
      const [{ meta: fresh, flags }, screenBlocked] = await Promise.all([
        loadRoomFlags(code),
        screenBlockedFor(code),
      ]);
      const current = fresh ?? meta;
      await stopScreenShare(
        code,
        targetLive,
        current,
        participantState(cmd.target, current, flags, screenBlocked),
      );
      return done();
    }
    case "transfer": {
      const name = targetLive?.name || (await loadName(code, cmd.target)) || cmd.target;
      const res = await casHost(code, caller.identity, { identity: cmd.target, name });
      // Конфликт: пока шёл запрос, права ушли — вызывающий уже не хост.
      if (res === "conflict") return refuse(apiError("NOT_HOST"));
      if (res === "missing") return refuse(apiError("ROOM_NOT_FOUND"));
      await afterHostChange(code, [caller.identity, cmd.target]);
      return done();
    }
    case "settings":
      await applySettings(code, meta, cmd.settings);
      return done();
  }
}

/** После смены хоста: зеркало описания и права старого и нового хоста. */
async function afterHostChange(code: string, identities: string[]): Promise<void> {
  await mirrorRoomMeta(code);
  await syncParticipants(code, identities);
}

/** Занять свободное место хоста (после паузы HOST_HANDOVER_DELAY_SEC). */
async function claimHost({ code, caller, meta, participants }: Ctx): Promise<Result> {
  const now = Date.now();
  const hostPresent =
    meta.hostIdentity !== null && participants.some((p) => p.identity === meta.hostIdentity);
  // Хоста ещё не было — место свободно с создания комнаты.
  const vacantSince = meta.hostIdentity === null ? meta.createdAt : await loadHostLeftAt(code);
  const decision = decideClaim({
    now,
    caller: caller.identity,
    hostIdentity: meta.hostIdentity,
    hostPresent,
    vacantSince,
  });
  switch (decision.kind) {
    case "already":
      return done();
    case "refuse":
      return refuse(decision.error);
    case "startCountdown": {
      // Отметки ухода нет (вебхук потерялся) — отсчёт начинается сейчас. NX: если
      // параллельный запрос уже поставил отметку, считаем от неё.
      await markHostLeft(code, now, true);
      const since = (await loadHostLeftAt(code)) ?? now;
      return refuse(retryError("HOST_HANDOVER_PENDING", HOST_HANDOVER_DELAY_SEC - (now - since) / 1000));
    }
    case "grant": {
      const res = await casHost(code, meta.hostIdentity, caller);
      if (res === "missing") return refuse(apiError("ROOM_NOT_FOUND"));
      // Кто-то занял место раньше нас.
      if (res === "conflict") return refuse(apiError("HOST_PRESENT"));
      await afterHostChange(code, [caller.identity]);
      return done();
    }
  }
}

/** Владелец забирает права хоста себе — всегда, даже у присутствующего хоста. */
async function reclaimHost({ code, caller, meta }: Ctx, hostKey: string | undefined): Promise<Result> {
  // Владельца узнаём по identity (её закрепили вход с ключом и секрет устройства)
  // или по самому ключу.
  let owner = meta.ownerIdentity === caller.identity;
  if (!owner && hostKey) {
    const auth = await loadAuth(code);
    owner = !!auth && (await verifyPassword(hostKey, auth.hostKeyHash));
  }
  if (!owner) return refuse(apiError("NOT_OWNER"));

  if (meta.ownerIdentity !== caller.identity) {
    await updateRoomMeta(code, { ownerIdentity: caller.identity });
  }
  const previous = meta.hostIdentity;
  let expected = previous;
  // Сравнение-и-замена: если хоста поменяли между чтением и записью — перечитать.
  for (let attempt = 0; expected !== caller.identity; attempt++) {
    const res = await casHost(code, expected, caller);
    if (res === "ok") break;
    if (res === "missing") return refuse(apiError("ROOM_NOT_FOUND"));
    if (attempt >= 2) return refuse(apiError("SERVICE_UNAVAILABLE"));
    expected = (await loadRoomMeta(code))?.hostIdentity ?? null;
  }
  await afterHostChange(code, previous ? [caller.identity, previous] : [caller.identity]);
  return done();
}

/**
 * Настройки комнаты: поля описания — одной атомарной записью, пароль — в auth,
 * затем зеркало в LiveKit. Смена режима экрана меняет права у всех присутствующих:
 * у кого право отозвано, LiveKit сам остановит идущую демонстрацию.
 */
async function applySettings(
  code: string,
  meta: StoredRoomMeta,
  s: RoomSettingsPatch,
): Promise<void> {
  const patch: RoomMetaPatch = {};
  if (s.screen !== undefined) patch.screen = s.screen;
  if (s.chat !== undefined) patch.chat = s.chat;
  if (s.locked !== undefined) patch.locked = s.locked;
  if (s.isPublic !== undefined) patch.isPublic = s.isPublic;
  await updateRoomMeta(code, patch);
  if (s.password !== undefined) {
    await setPasswordHash(code, s.password ? await hashPassword(s.password) : null);
  }
  await mirrorRoomMeta(code);
  if (s.screen !== undefined && s.screen !== meta.settings.screen) await syncParticipants(code);
}
