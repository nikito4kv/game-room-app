import { beforeEach, describe, expect, it, vi } from "vitest";

const track = vi.fn();
vi.mock("./posthogClient", async (orig) => ({ ...(await orig<typeof import("./posthogClient")>()), track }));

const { trackPostcard, trackRumikEditor, trackRumikEditorOpened } = await import("./rumik");

describe("события Румика", () => {
  beforeEach(() => track.mockClear());

  it("имена в стиле остальных событий (snake_case, существительное_глагол) и место", () => {
    trackRumikEditorOpened("lobby");
    trackRumikEditor("file_saved", "hero");
    trackRumikEditor("file_loaded", "lobby");
    trackPostcard("downloaded", "hero", "wave");
    trackPostcard("shared", "lobby", "sit");
    expect(track.mock.calls).toEqual([
      ["rumik_editor_opened", { place: "lobby" }],
      ["rumik_file_saved", { place: "hero" }],
      ["rumik_file_loaded", { place: "lobby" }],
      ["rumik_postcard_downloaded", { place: "hero", pose: "wave" }],
      ["rumik_postcard_shared", { place: "lobby", pose: "sit" }],
    ]);
  });

  it("«начал рисовать» — один раз за визит на каждом месте", () => {
    trackRumikEditor("paint_started", "hero");
    trackRumikEditor("paint_started", "hero");
    trackRumikEditor("paint_started", "lobby");
    trackRumikEditor("paint_started", "lobby");
    expect(track.mock.calls).toEqual([
      ["rumik_paint_started", { place: "hero" }],
      ["rumik_paint_started", { place: "lobby" }],
    ]);
  });

  it("сохранение файла считается каждый раз", () => {
    trackRumikEditor("file_saved", "hero");
    trackRumikEditor("file_saved", "hero");
    expect(track).toHaveBeenCalledTimes(2);
  });
});

describe("маяк рисовалки в поток событий сайта (/api/ev)", () => {
  const sent: Array<{ url: string; body: unknown }> = [];
  const store = new Map<string, string>();
  const stub = (pathname: string) => {
    vi.stubGlobal("window", { location: { pathname } });
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    vi.stubGlobal("navigator", {
      sendBeacon: (url: string, blob: Blob) => {
        void blob.text().then((t) => sent.push({ url, body: JSON.parse(t) }));
        return true;
      },
    });
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => {
    sent.length = 0;
    store.clear();
    vi.unstubAllGlobals();
  });

  it("то же событие уходит маяком: имя из белого списка, место, поза, номер браузера — без ника и комнаты", async () => {
    stub("/room/ABCDEF/join");
    trackRumikEditorOpened("lobby");
    trackPostcard("shared", "hero", "wave");
    await flush();
    const vid = store.get("gr:vid");
    expect(vid).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(sent).toEqual([
      { url: "/api/ev", body: { ev: "rumik_editor_opened", place: "lobby", vid } },
      { url: "/api/ev", body: { ev: "rumik_postcard_shared", place: "hero", pose: "wave", vid } },
    ]);
  });

  it("витрина дизайн-системы (/design) не считается; без window — только PostHog", async () => {
    stub("/design/landing");
    trackRumikEditor("file_saved", "hero");
    vi.unstubAllGlobals();
    trackRumikEditor("file_loaded", "hero");
    await flush();
    expect(sent).toEqual([]);
    expect(track).toHaveBeenCalledWith("rumik_file_loaded", { place: "hero" });
  });
});
