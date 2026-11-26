import type { RoomDetailResponse } from "@/lib/api/platform";
import { normalizeRoomCode } from "@/lib/livekit";
import { loadBans, loadRoomMeta } from "@/lib/roomSecret";
import { internalRoute, platformError, platformJson } from "@/lib/platform/internalAuth";
import { listReports } from "@/lib/platform/reports";
import { liveRoom, loadClosedRoom } from "@/lib/platform/roomAdmin";

// GET /api/internal/rooms/<code> — карточка комнаты (RoomDetailResponse): живое
// состояние из LiveKit, сохранённое в Redis (даже если комнаты в LiveKit уже нет),
// отметка «закрыта администрацией» и жалобы на эту комнату.

type Ctx = { params: Promise<{ code: string }> };

export const GET = internalRoute<Ctx>("room", async (_request, { params }) => {
  const code = normalizeRoomCode((await params).code);
  if (!code) return platformError(400, "bad_code", "Неверный код комнаты");
  const [room, meta, bans, closed, reports] = await Promise.all([
    liveRoom(code),
    loadRoomMeta(code),
    loadBans(code),
    loadClosedRoom(code),
    listReports({ status: "all", code, limit: 50 }).then((page) => page.reports),
  ]);
  const body: RoomDetailResponse = {
    room,
    stored: {
      exists: meta !== null,
      createdAt: meta?.createdAt ?? null,
      hostName: meta?.hostName ?? null,
      bans: bans.map((b) => ({ identity: b.identity, name: b.name === b.identity ? null : b.name })),
    },
    closed,
    reports,
  };
  return platformJson(body);
});
