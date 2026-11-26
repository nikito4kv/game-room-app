// Маяк /api/ev: события рисовалки Румика (RumikBeacon) рядом с посещениями страниц.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeRedis } from "@/lib/server/testFakes";

const h = vi.hoisted(() => ({ redis: null as unknown, consume: vi.fn() }));
vi.mock("@/lib/redis", () => ({ getRedis: () => h.redis, getRedisRaw: () => h.redis }));
vi.mock("@/lib/ratelimit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ratelimit")>()),
  consumeLimit: (...args: unknown[]) => h.consume(...args),
}));

import { RUMIK_EVENTS, type StoredEvent } from "@/lib/api/platform";
import { readEvents, settleEvents } from "@/lib/platform/events";
import { beaconLimit } from "@/lib/ratelimit";
import { POST } from "./route";

const send = (body: unknown, ip = "7.7.7.7") =>
  POST(
    new Request("http://app.test/api/ev", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "x-real-ip": ip },
    }),
  );
const allEvents = async (): Promise<StoredEvent[]> => {
  await settleEvents();
  return (await readEvents(null, 1000)).events;
};

beforeEach(() => {
  h.redis = new FakeRedis();
  h.consume.mockReset().mockResolvedValue({ limited: false, remaining: 5 });
});

describe("POST /api/ev — события рисовалки", () => {
  it("каждое имя из белого списка пишется событием rumik: место, поза, номер браузера; без IP", async () => {
    for (const ev of Object.keys(RUMIK_EVENTS)) {
      expect((await send({ ev, place: "hero", vid: "v1234567890123456" })).status).toBe(204);
    }
    expect((await send({ ev: "rumik_postcard_shared", place: "lobby", pose: "waveL" })).status).toBe(204);
    const ev = await allEvents();
    expect(ev.map((e) => e.t === "rumik" && e.name)).toEqual([...Object.keys(RUMIK_EVENTS), "rumik_postcard_shared"]);
    expect(ev[0]).toMatchObject({ t: "rumik", name: "rumik_editor_opened", place: "hero", vid: "v1234567890123456" });
    expect(ev.at(-1)).toMatchObject({ place: "lobby", pose: "waveL" });
    for (const e of ev) expect(e).not.toHaveProperty("ip");
    for (const e of ev) expect(e).not.toHaveProperty("path");
  });

  it("мусор — 204 и ничего не пишется, лимит не тратится", async () => {
    const junk: unknown[] = [
      { ev: "rumik_hacked", place: "hero" },
      { ev: "constructor", place: "hero" },
      { ev: "rumik_paint_started", place: "room" },
      { ev: "rumik_paint_started", place: "toString" },
      { ev: "rumik_paint_started" },
      { ev: "rumik_postcard_downloaded", place: "hero", pose: "<script>" },
      { ev: "rumik_postcard_downloaded", place: "hero", pose: 5 },
      { ev: "rumik_postcard_downloaded", place: "hero", pose: "a".repeat(13) },
      { ev: ["rumik_paint_started"], place: "hero" },
      // С полем ev это не страница, даже если path есть.
      { ev: "nope", path: "/" },
      "[]",
      "не json",
    ];
    for (const body of junk) expect((await send(body)).status).toBe(204);
    expect(await allEvents()).toEqual([]);
    expect(h.consume).not.toHaveBeenCalled();
  });

  it("тот же лимит, что у страниц (по IP): сверх — молча отбрасывается", async () => {
    h.consume.mockResolvedValueOnce({ limited: true, retryAfterSec: 30 });
    expect((await send({ ev: "rumik_paint_started", place: "hero" }, "8.8.8.8")).status).toBe(204);
    expect(h.consume).toHaveBeenCalledWith(beaconLimit(), "8.8.8.8");
    expect(await allEvents()).toEqual([]);
    await send({ ev: "rumik_paint_started", place: "hero" }, "8.8.8.8");
    await send({ path: "/pricing" }, "8.8.8.8");
    expect(h.consume.mock.calls.every(([l]) => l === beaconLimit())).toBe(true);
    expect((await allEvents()).map((e) => e.t)).toEqual(["rumik", "page"]);
  });
});
