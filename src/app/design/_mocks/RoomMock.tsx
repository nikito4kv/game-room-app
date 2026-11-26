"use client";

// Экран комнаты — макет. Раскладка (сверху вниз):
//   шапка 56px → [баннер связи] → { зона комнаты | чат 360px } → док.
// Зона комнаты меняет вид по своей ширине (container query, не по окну):
//   ≥ 560px — круглый стол (или сцена, если идёт показ);
//   < 560px — компактный список, как голосовой канал Discord.
// Док плавает по центру зоны комнаты (без чата); на узком экране — полоса
// во всю ширину внизу. В узком окне открытый чат встаёт под список.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Popover, Toaster, UiRoot, cn, toast } from "@/components/ui";
import type { Rect, Side } from "@/components/ui/floating";
import { RecapDialog } from "@/app/room/[code]/recap/RecapDialog";
import type { Recap } from "@/lib/room/recap";
import { ME, PEOPLE, type MockPerson } from "./data";
import {
  AloneCenter,
  ChatPanel,
  Dock,
  ParticipantList,
  ParticipantPanel,
  ParticipantRibbon,
  ReconnectBanner,
  RoomHeader,
  RoundTable,
  SeatRow,
  SelfShareCard,
  SelfShareCenter,
  Stage,
  TableCenter,
  type MicState,
} from "./room-parts";
import { RoomSettingsDialog, SettingsDialog } from "./SettingsDialog";
import { zoneLayout, type ZoneLayout } from "./layout";

/** Пример «Итогов вечера» для витрины: два с четвертью часа, пятеро, болтун и молчун. */
const SAMPLE_RECAP: Recap = {
  title: "Вечерняя катка",
  startedAt: new Date(2026, 9, 6, 20, 0).getTime(),
  durationMs: 135 * 60_000,
  people: 5,
  peak: 5,
  top: { identity: "tema", name: "Тёма", talkMs: 48 * 60_000 },
  quiet: { identity: "dania", name: "Даня Котов", talkMs: 3 * 60_000 },
  reactions: 37,
  sounds: 12,
  dice: 6,
};

export type RoomVariant = "normal" | "alone" | "stage" | "stage-self" | "stage-two";

export type RoomMockProps = {
  variant?: RoomVariant;
  chat?: boolean;
  reconnecting?: boolean;
  settings?: boolean;
  roomSettings?: boolean;
  /** Открыть панель участника (как хост) у места «Ника»; kick/ban — подтверждение. */
  participant?: "actions" | "kick" | "ban";
  invite?: boolean;
  mic?: MicState;
  deafened?: boolean;
  toasts?: boolean;
  showKeys?: boolean;
  zoomed?: boolean;
  stats?: boolean;
  /** Открыть «Итоги вечера» с примером. */
  recap?: boolean;
  theme?: "dark" | "light";
};

type PanelState = { p: MockPerson; at: Rect; side: Side; view: "actions" | "kick" | "ban" };

/**
 * Раскладка по размеру зоны. ResizeObserver срабатывает только при смене
 * размера — в покое ничего не считается. В DOM всегда одна раскладка.
 */
function useZoneLayout(ref: RefObject<HTMLElement | null>): ZoneLayout {
  const [layout, setLayout] = useState<ZoneLayout>("table");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setLayout(zoneLayout(width, height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return layout;
}

/** Сторона панели участника: от места наружу, чтобы не закрывать стол. */
function panelFor(p: MockPerson, seat: HTMLElement, zone: HTMLElement | null, view: PanelState["view"]): PanelState {
  const r = seat.getBoundingClientRect();
  const z = zone?.getBoundingClientRect();
  const mid = z ? z.left + z.width / 2 : window.innerWidth / 2;
  const cx = r.left + r.width / 2;
  const side: Side = cx > mid + 40 ? "right" : cx < mid - 40 ? "left" : "bottom";
  return { p, at: { x: r.left, y: r.top, width: r.width, height: r.height }, side, view };
}

export function RoomMock({
  variant = "normal",
  chat: chatInitially = false,
  reconnecting = false,
  settings: settingsInitially = false,
  roomSettings: roomSettingsInitially = false,
  participant,
  invite = false,
  mic = "on",
  deafened = false,
  toasts = false,
  showKeys = false,
  zoomed = false,
  stats = false,
  recap = false,
  theme,
}: RoomMockProps) {
  const [chatOpen, setChatOpen] = useState(chatInitially);
  const [recapOpen, setRecapOpen] = useState(recap);
  const [settingsOpen, setSettingsOpen] = useState(settingsInitially);
  const [roomSettingsOpen, setRoomSettingsOpen] = useState(roomSettingsInitially);
  const [panel, setPanel] = useState<PanelState | null>(null);
  const zoneRef = useRef<HTMLDivElement>(null);
  const layout = useZoneLayout(zoneRef);

  const people = variant === "alone" ? [ME] : PEOPLE;
  // Свой показ — не сцена: смотреть самому себя незачем, стол остаётся,
  // а плашка «Вы показываете экран» встаёт в центр стола.
  const stage = variant === "stage" || variant === "stage-two";
  const selfShare = variant === "stage-self";

  // Демонстрация панели участника: открыть у места Ники после раскладки.
  useEffect(() => {
    if (!participant) return;
    const el = zoneRef.current?.querySelector<HTMLElement>('[data-identity="nika"]');
    if (!el) return;
    setPanel(panelFor(PEOPLE[1], el, zoneRef.current, participant));
  }, [participant]);

  useEffect(() => {
    if (!toasts) return;
    toast({ id: "join", title: "Ника", description: "теперь в комнате", person: { name: "Ника", colorIndex: PEOPLE[1].colorIndex }, duration: Infinity });
    toast({ id: "share", title: "Тёма показывает экран", icon: "screen-share", tone: "signal", action: { label: "Смотреть", onClick: () => {} }, duration: Infinity });
    toast({ id: "host", title: "Тёма теперь хост", icon: "crown", duration: Infinity });
  }, [toasts]);

  return (
    <UiRoot
      theme={theme}
      data-testid="room"
      className="fixed inset-0 flex flex-col overflow-hidden [--gr-toast-top:68px]"
      style={{ "--chat-w": chatOpen ? "360px" : "0px" } as CSSProperties}
    >
      <RoomHeader inviteOpen={invite} />
      {reconnecting && <ReconnectBanner />}
      <RecapDialog open={recapOpen} onOpenChange={setRecapOpen} recap={SAMPLE_RECAP} />

      <div className="relative flex min-h-0 flex-1 max-sm:flex-col">
        <main
          ref={zoneRef}
          className={cn(
            "relative flex min-h-0 min-w-0 flex-col",
            chatOpen ? "flex-1 max-sm:max-h-[44%] max-sm:flex-none max-sm:overflow-y-auto" : "flex-1",
          )}
        >
          {stage ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4 sm:pb-24">
              <Stage twoStreams={variant === "stage-two"} zoomed={zoomed} statsOpen={stats} />
              {layout === "list" ? (
                <ParticipantList people={PEOPLE} onRowClick={(p, el) => setPanel(panelFor(p, el, zoneRef.current, "actions"))} />
              ) : (
                <ParticipantRibbon people={PEOPLE} />
              )}
            </div>
          ) : (
            <div
              aria-busy={reconnecting || undefined}
              className={cn(
                "flex min-h-0 flex-1 flex-col transition-opacity duration-240",
                // Пока переподключаемся, комната «замирает»: данные устарели.
                reconnecting && "opacity-45",
              )}
            >
              {layout === "table" && (
                <div className="grid min-h-0 flex-1 place-items-center p-6 pb-28 [container-type:size]">
                  <RoundTable
                    people={people}
                    center={
                      variant === "alone" ? <AloneCenter /> : selfShare ? <SelfShareCenter /> : <TableCenter />
                    }
                    onSeatClick={(p, el) => setPanel(panelFor(p, el, zoneRef.current, "actions"))}
                  />
                </div>
              )}
              {layout === "row" && (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 p-6 pb-28">
                  <SeatRow people={people} onSeatClick={(p, el) => setPanel(panelFor(p, el, zoneRef.current, "actions"))} />
                  {selfShare && <SelfShareCard />}
                  {/* Как в RoomView: стола нет — «Пока тут только вы» плашкой под рядом. */}
                  {variant === "alone" && (
                    <div className="w-full max-w-md rounded-card border border-dashed border-line-strong p-5">
                      <AloneCenter />
                    </div>
                  )}
                </div>
              )}
              {layout === "list" && (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {selfShare && (
                    <div className="p-3 pb-0">
                      <SelfShareCard />
                    </div>
                  )}
                  <ParticipantList people={people} onRowClick={(p, el) => setPanel(panelFor(p, el, zoneRef.current, "actions"))} />
                  {variant === "alone" && (
                    <div className="mx-3 mt-2 rounded-card border border-dashed border-line-strong p-5">
                      <AloneCenter />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
        {chatOpen && <ChatPanel onClose={() => setChatOpen(false)} />}
      </div>

      <Dock
        mic={mic}
        speaking={mic === "on" && variant !== "alone"}
        deafened={deafened}
        sharing={selfShare}
        chatOpen={chatOpen}
        unread={3}
        showKeys={showKeys}
        onToggleChat={() => setChatOpen((v) => !v)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <Popover
        open={!!panel}
        onOpenChange={(o) => {
          if (!o) setPanel(null);
        }}
        anchor={panel?.at ?? { x: 0, y: 0, width: 0, height: 0 }}
        side={panel?.side ?? "bottom"}
        align={panel?.side === "bottom" ? "center" : "start"}
        offset={4}
        aria-label={panel ? `Участник ${panel.p.name}` : undefined}
      >
        {panel && (
          <ParticipantPanel
            person={panel.p}
            host
            view={panel.view}
            onView={(view) => setPanel((s) => (s ? { ...s, view } : s))}
          />
        )}
      </Popover>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <RoomSettingsDialog open={roomSettingsOpen} onOpenChange={setRoomSettingsOpen} />
      <Toaster placement="top-left" />
    </UiRoot>
  );
}
