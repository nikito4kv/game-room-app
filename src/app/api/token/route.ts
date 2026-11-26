import { NextResponse } from "next/server";
import {
  PROTOCOL_VERSION,
  type ApiError,
  type SoundId,
  type TokenResponse,
} from "@/lib/api/contract";
import type { RuntimeConfig } from "@/lib/api/platform";
import { checkNickname } from "@/lib/api/nickname";
import { identityForDevice, parseDeviceIdentity } from "@/lib/api/deviceIdentity";
import {
  createParticipantToken,
  getRoomService,
  getServerUrl,
  hashSeatSecret,
  normalizeRoomCode,
  seatSecretMatches,
  verifyPassword,
} from "@/lib/livekit";
import {
  bindSeat,
  casHost,
  loadJoinSnapshot,
  loadRoomMeta,
  rememberName,
  touchRoomState,
  updateRoomMeta,
  type RoomMetaPatch,
} from "@/lib/roomSecret";
import {
  clientIp,
  consumeLimit,
  joinLimit,
  passwordFailLimit,
  peekLimit,
} from "@/lib/ratelimit";
import {
  apiError,
  errorResponse,
  failureFrom,
  formatWait,
  invalidName,
  retryError,
  wrongPassword,
} from "@/lib/server/errors";
import { decideAdmission, takesHostOnJoin } from "@/lib/server/joinRules";
import { participantMetaFor, permissionFor } from "@/lib/server/permissions";
import { optionalString, readJsonObject } from "@/lib/server/request";
import { enterSoundAttributes, parseSoundId } from "@/lib/server/sounds";
import {
  ensureLiveKitRoom,
  listParticipantsOrEmpty,
  loadRoomMetaOrAdopt,
  roomCapacity,
  toPublicMeta,
} from "@/lib/server/roomSync";
import { findBlock, rememberParticipantIp } from "@/lib/platform/blocks";
import { emitEvent } from "@/lib/platform/events";
import { isFlagOn, joinsBlocked, loadRuntimeConfig, maintenanceMessage } from "@/lib/platform/runtimeConfig";
import { loadAdminEntryBlock, loadClosedRoom } from "@/lib/platform/roomAdmin";
import { emitFeatureOnce, emitSignal, emitSignalOnce } from "@/lib/platform/signals";

// POST /api/token — вход в комнату: проверки и выдача токена LiveKit.
// Контракт и порядок проверок — src/lib/api/contract.ts (TokenRequest/TokenResponse).
// identity = "u_" + device.id: место в комнате закреплено за устройством, ник — это
// name в токене.

type Joiner = {
  code: string;
  identity: string;
  name: string;
  /** secret устройства: по нему место в комнате узнаёт свой браузер (TOFU). */
  deviceSecret: string;
  password: string | undefined;
  hostKey: string | undefined;
  ip: string;
  cfg: RuntimeConfig;
  /** Звук входа из запроса; в токен попадает, только если соундборд включён для комнаты. */
  enterSound: SoundId | null;
};

type JoinOutcome = { ok: true; response: TokenResponse } | { ok: false; error: ApiError };

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body) return errorResponse(apiError("BAD_REQUEST"));
  if (body.v !== PROTOCOL_VERSION) return errorResponse(apiError("CLIENT_OUTDATED"));
  const code = normalizeRoomCode(body.code);
  if (!code) {
    return errorResponse(
      typeof body.code === "string" && body.code.trim()
        ? apiError("ROOM_NOT_FOUND")
        : apiError("BAD_REQUEST", "Введите код комнаты"),
    );
  }

  const ip = clientIp(request);
  const publicIp = ip !== "local" ? ip : undefined;
  // Отказ входа — событие join_fail (код ошибки) для аналитики неудачных входов.
  const refuse = (error: ApiError) => {
    void emitEvent({ t: "join_fail", code, reason: error.code, ip: publicIp });
    return errorResponse(error);
  };

  const limit = await consumeLimit(joinLimit(), `${ip}:${code}`);
  if (limit.limited) {
    void emitSignalOnce(`join:${ip}`, 600, "rate_limited", "low", { code, ip, detail: "вход в комнату" });
    return refuse(retryError("RATE_LIMITED", limit.retryAfterSec));
  }

  const nick = checkNickname(body.name);
  if (!nick.ok) return errorResponse(invalidName(nick.reason));
  const device = parseDeviceIdentity(body.device);
  if (!device) {
    return errorResponse(apiError("BAD_REQUEST", "Неверные данные устройства — обновите страницу"));
  }
  const identity = identityForDevice(device.id);

  // Решения администрации — до всего остального: блок адреса или устройства и
  // закрытая комната. Владелец комнаты мимо них не проходит.
  const [block, closed, cfg] = await Promise.all([
    findBlock(ip, identity),
    loadClosedRoom(code).catch(() => null),
    loadRuntimeConfig(),
  ]);
  if (block) {
    void emitSignal("blocked_attempt", "medium", {
      code,
      identity,
      ip,
      detail: block.kind === "ip" ? "адрес заблокирован" : "устройство заблокировано",
    });
    return refuse(apiError("BLOCKED"));
  }
  if (closed) return refuse(apiError("ROOM_CLOSED", closed.message || undefined));

  let outcome: JoinOutcome;
  try {
    outcome = await join({
      code,
      identity,
      name: nick.name,
      deviceSecret: device.secret,
      password: optionalString(body.password),
      hostKey: optionalString(body.hostKey),
      ip,
      cfg,
      enterSound: parseSoundId(body, "enterSound"),
    });
  } catch (err) {
    console.error("token: join failed", err);
    return refuse(failureFrom(err));
  }
  if (!outcome.ok) return refuse(outcome.error);
  // Адрес вошедшего — на 48 ч, для блокировки «по участнику» из админки.
  await rememberParticipantIp(code, identity, ip);
  void emitEvent({
    t: "join",
    code,
    identity,
    ip: publicIp,
    vid: optionalString(body.vid)?.slice(0, 64),
    owner: outcome.response.isOwner ? "1" : "0",
    rules: optionalString(body.rulesVersion)?.slice(0, 40),
  });
  return NextResponse.json(outcome.response);
}

async function join(j: Joiner): Promise<JoinOutcome> {
  const fail = (error: ApiError): JoinOutcome => ({ ok: false, error });
  const [liveRooms, snap] = await Promise.all([
    getRoomService().listRooms([j.code]),
    loadJoinSnapshot(j.code, j.identity),
  ]);
  const liveRoom = liveRooms[0] ?? null;
  if (!snap.auth) return fail(apiError("ROOM_NOT_FOUND"));
  const meta = snap.meta ?? (await loadRoomMetaOrAdopt(j.code, liveRoom));
  if (!meta) return fail(apiError("ROOM_NOT_FOUND"));

  // Владелец — тот, кто предъявил верный ключ. Он проходит без пароля, бана, кика и
  // замка: ключ — более сильный секрет, чем пароль комнаты.
  const owner = !!j.hostKey && (await verifyPassword(j.hostKey, snap.auth.hostKeyHash));

  // Запрет от администрации (выгнали или забанили в комнате) — и для владельца.
  const adminBlock = await loadAdminEntryBlock(j.code, j.identity);
  if (adminBlock?.banned) {
    return fail(apiError("BANNED", "Администрация сервиса закрыла вам вход в эту комнату"));
  }
  if (adminBlock && adminBlock.retryAfterSec > 0) {
    return fail({
      code: "KICKED",
      message: `Администрация выгнала вас из комнаты. Вернуться можно через ${formatWait(adminBlock.retryAfterSec)}`,
      retryAfterSec: adminBlock.retryAfterSec,
    });
  }

  // Пароль. Остаток попыток проверяется ДО сверки: при исчерпанном лимите не
  // проходит и верный пароль, иначе перебор шёл бы дальше под видом 429.
  if (snap.auth.passwordHash && !owner) {
    if (!j.password) return fail(apiError("PASSWORD_REQUIRED"));
    const left = await peekLimit(passwordFailLimit(), j.code);
    const bruteforce = () =>
      void emitSignalOnce(j.code, 600, "password_bruteforce", "high", {
        code: j.code,
        identity: j.identity,
        ip: j.ip,
      });
    if (left && left.remaining <= 0) {
      bruteforce();
      return fail(retryError("TOO_MANY_ATTEMPTS", left.retryAfterSec));
    }
    if (!(await verifyPassword(j.password, snap.auth.passwordHash))) {
      const spent = await consumeLimit(passwordFailLimit(), j.code);
      if (spent.limited) {
        bruteforce();
        return fail(retryError("TOO_MANY_ATTEMPTS", spent.retryAfterSec));
      }
      void emitSignal("password_fail", "low", { code: j.code, identity: j.identity, ip: j.ip });
      return fail(wrongPassword(spent.remaining));
    }
  }

  const participants = liveRoom ? await listParticipantsOrEmpty(j.code) : [];

  // Режим обслуживания «вход закрыт»: новых не пускаем, а «своих» (уже были в
  // комнате или сейчас в ней: обрыв, перезагрузка) и владельца — пускаем: идущие
  // разговоры не рвём.
  const present = participants.some((p) => p.identity === j.identity);
  if (joinsBlocked(j.cfg) && !owner && !snap.member && !present) {
    return fail(
      apiError(
        "MAINTENANCE",
        maintenanceMessage(j.cfg, "Вход в комнаты временно закрыт: идут технические работы. Попробуйте чуть позже"),
      ),
    );
  }
  // Лимит людей: ключ клуба или настройки продукта, но не больше лимита комнаты в LiveKit.
  const capacity = roomCapacity(meta, j.cfg);
  const hostPresent =
    meta.hostIdentity !== null && participants.some((p) => p.identity === meta.hostIdentity);
  const seatForeign = snap.seatHash !== null && !seatSecretMatches(j.deviceSecret, snap.seatHash);

  const refusal = decideAdmission({
    identity: j.identity,
    name: j.name,
    owner,
    seat: seatForeign ? "foreign" : "ok",
    banned: snap.banned,
    kickRemainingSec: snap.kickRemainingSec,
    locked: meta.locked,
    member: snap.member,
    isHost: meta.hostIdentity === j.identity,
    participants: participants.map((p) => ({ identity: p.identity, name: p.name })),
    maxParticipants: Math.min(liveRoom?.maxParticipants || capacity, capacity),
  });
  if (refusal) return fail(refusal);

  // Закрепляем место за устройством (TOFU). Гонка двух первых входов решается
  // атомарным HSETNX: проигравший сверяется с тем, что успело записаться.
  if (snap.seatHash === null) {
    const seat = await bindSeat(j.code, j.identity, hashSeatSecret(j.deviceSecret));
    if (!seat.bound && !(seat.storedHash && seatSecretMatches(j.deviceSecret, seat.storedHash))) {
      return fail(apiError("SEAT_TAKEN"));
    }
  }

  // Владелец и хост. Свободное место хоста владелец занимает сразу; ник хоста в
  // описании держим свежим (он виден в витрине).
  let metaChanged = false;
  const patch: RoomMetaPatch = {};
  if (owner && meta.ownerIdentity !== j.identity) patch.ownerIdentity = j.identity;
  if (meta.hostIdentity === j.identity && meta.hostName !== j.name) patch.hostName = j.name;
  if (Object.keys(patch).length > 0) {
    await updateRoomMeta(j.code, patch);
    metaChanged = true;
  }
  if (takesHostOnJoin({ owner, identity: j.identity, hostIdentity: meta.hostIdentity, hostPresent })) {
    // Конфликт значит, что хоста только что поменял кто-то другой — тогда не спорим.
    if ((await casHost(j.code, meta.hostIdentity, { identity: j.identity, name: j.name })) === "ok") {
      metaChanged = true;
    }
  }
  const current = metaChanged ? ((await loadRoomMeta(j.code)) ?? meta) : meta;
  await rememberName(j.code, j.identity, j.name);

  // Комнату, потерянную LiveKit (перезапуск), пересоздаём из Redis до выдачи токена;
  // заодно приводим её metadata к описанию в Redis.
  await ensureLiveKitRoom(j.code, current, liveRoom, capacity);

  const isHost = current.hostIdentity === j.identity;
  const state = {
    isHost,
    forceMuted: snap.forceMuted,
    chatMuted: snap.chatMuted,
    screenAllowed: snap.screenAllowed,
    // Флаг screen_share выключен — показ экрана недоступен никому в комнате.
    screenBlocked: !isFlagOn(j.cfg, "screen_share", j.code),
  };
  // Звук входа — только если соундборд включён для этой комнаты.
  const enterSound = isFlagOn(j.cfg, "soundboard", j.code) ? j.enterSound : null;
  const token = await createParticipantToken({
    room: j.code,
    identity: j.identity,
    name: j.name,
    metadata: JSON.stringify(participantMetaFor(state)),
    permission: permissionFor(current.settings, state),
    attributes: enterSoundAttributes(enterSound),
  });
  await touchRoomState(j.code);
  if (enterSound) void emitFeatureOnce("enter_sound", j.code, j.identity, enterSound);

  return {
    ok: true,
    response: {
      token,
      serverUrl: getServerUrl(),
      identity: j.identity,
      name: j.name,
      isHost,
      isOwner: owner || current.ownerIdentity === j.identity,
      room: toPublicMeta(current),
    },
  };
}
