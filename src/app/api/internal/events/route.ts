import type { EventsResponse } from "@/lib/api/platform";
import { internalRoute, platformJson } from "@/lib/platform/internalAuth";
import { readEvents } from "@/lib/platform/events";

// GET /api/internal/events?after=<id|0>&count=<≤1000> — события потока gr:ev строго
// после after (EventsResponse). last — id последнего отданного (null — новых нет).

export const GET = internalRoute("events", async (request) => {
  const q = new URL(request.url).searchParams;
  const body: EventsResponse = await readEvents(q.get("after"), Number(q.get("count") ?? 500));
  return platformJson(body);
});
