import { internalRoute, platformJson } from "@/lib/platform/internalAuth";
import { liveSnapshot } from "@/lib/platform/roomAdmin";

// GET /api/internal/live — все живые комнаты с участниками (LiveResponse).

export const GET = internalRoute("live", async () => platformJson(await liveSnapshot()));
