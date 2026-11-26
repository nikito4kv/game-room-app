import type { BlocksResponse } from "@/lib/api/platform";
import {
  emitAdminEvent,
  internalRoute,
  platformError,
  platformJson,
  readInternalJson,
} from "@/lib/platform/internalAuth";
import { createBlock, listBlocks, removeBlock, validateBlockInput } from "@/lib/platform/blocks";

// /api/internal/blocks — блокировки адресов и устройств (А2).
//   GET                              → BlocksResponse
//   POST { kind, value, reason, note?, minutes, fromParticipant? } (BlockCreateRequest)
//        → { ok, block }. fromParticipant (kind=ip, value пустой) — IP участника из
//        памяти сайта; в ответе вместо адреса подпись «участник … в …».
//        IPv6 блокируется сетью /64.
//   DELETE ?kind=ip|device&value=…&reason=… → { ok, removed }

export const GET = internalRoute("blocks", async () => {
  const body: BlocksResponse = { blocks: await listBlocks() };
  return platformJson(body);
});

export const POST = internalRoute("block", async (request) => {
  const raw = await readInternalJson(request);
  const checked = validateBlockInput(raw);
  if (!checked.ok) return platformError(400, "bad_block", checked.message);
  const created = await createBlock(checked.value);
  if (!created.ok) {
    return platformError(404, "ip_unknown", "Адрес участника неизвестен: сайт помнит его 48 часов после входа");
  }
  const { block } = created;
  void emitAdminEvent(`block_${block.kind}`, {
    code: checked.value.fromParticipant?.code,
    identity: block.kind === "device" ? block.value : checked.value.fromParticipant?.identity,
    reason: checked.value.reason,
  });
  return platformJson({ ok: true, block });
});

export const DELETE = internalRoute("unblock", async (request) => {
  const q = new URL(request.url).searchParams;
  const kind = q.get("kind");
  const value = q.get("value")?.trim() ?? "";
  if ((kind !== "ip" && kind !== "device") || !value) {
    return platformError(400, "bad_request", "Нужны kind (ip или device) и value");
  }
  const removed = await removeBlock(kind, value);
  void emitAdminEvent(`unblock_${kind}`, {
    identity: kind === "device" ? value : undefined,
    reason: q.get("reason") ?? undefined,
  });
  return platformJson({ ok: true, removed });
});
