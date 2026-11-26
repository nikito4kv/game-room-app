import type { AccessKeyCreateResponse, AccessKeysResponse } from "@/lib/api/platform";
import {
  emitAdminEvent,
  internalRoute,
  platformError,
  platformJson,
  readInternalJson,
} from "@/lib/platform/internalAuth";
import { createAccessKey, listAccessKeys, validateKeyCreate } from "@/lib/platform/accessKeys";

// /api/internal/keys — ключи клубов и коды (А6).
//   GET → AccessKeysResponse
//   POST AccessKeyCreateRequest → AccessKeyCreateResponse (секрет — один раз!)

export const GET = internalRoute("keys", async () => {
  const body: AccessKeysResponse = { keys: await listAccessKeys() };
  return platformJson(body);
});

export const POST = internalRoute("key_create", async (request) => {
  const checked = validateKeyCreate(await readInternalJson(request));
  if (!checked.ok) return platformError(400, "bad_key", checked.message);
  const body: AccessKeyCreateResponse = await createAccessKey(checked.value);
  void emitAdminEvent("key_create", { reason: `${body.key.type}: ${body.key.id}` });
  return platformJson(body);
});
