import {
  emitAdminEvent,
  internalRoute,
  platformError,
  platformJson,
} from "@/lib/platform/internalAuth";
import { revokeAccessKey } from "@/lib/platform/accessKeys";

// POST /api/internal/keys/<id>/revoke — отозвать ключ. Комнаты, уже созданные по
// нему, живут как жили; новые по нему не создаются.

type Ctx = { params: Promise<{ id: string }> };

export const POST = internalRoute<Ctx>("key_revoke", async (_request, { params }) => {
  const { id } = await params;
  if (!/^[\w-]{4,40}$/.test(id)) return platformError(404, "not_found", "Ключа нет");
  const key = await revokeAccessKey(id);
  if (!key) return platformError(404, "not_found", "Ключа нет");
  void emitAdminEvent("key_revoke", { reason: id });
  return platformJson(key);
});
