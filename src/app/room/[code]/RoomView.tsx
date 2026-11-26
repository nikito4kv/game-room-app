"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useConnectionState } from "@livekit/components-react";
import { ConnectionState, type Participant } from "livekit-client";
import { Toaster, UiRoot, cn, type Rect } from "@/components/ui";
import { AnnouncementBar } from "@/components/platform/AnnouncementBar";
import { panelSide, type PanelSide } from "@/lib/room/zoneLayout";
import RoomChat from "./chat/RoomChat";
import { useChatPanel } from "./chat/useChatPanel";
import Dock from "./dock/Dock";
import { useRoomToasts } from "./feed/useRoomToasts";
import { useGameFeed } from "./games/useGameFeed";
import { useToastTop } from "./feed/useToastTop";
import RoomHeader from "./header/RoomHeader";
import HostDialogs from "./host/HostDialogs";
import RoomMenuHostItems from "./host/RoomMenuHostItems";
import { useRumikTable } from "./participants/ParticipantCircle";
import ParticipantMenu from "./participants/ParticipantMenu";
import {
  RoundTable,
  SeatList,
  SeatRibbon,
  SeatRow,
  useZoneLayout,
  type SeatsModel,
} from "./participants/ParticipantStack";
import { avatarColorMap, usePeople } from "./participants/useAvatarColors";
import PipRoom from "./pip/PipRoom";
import { usePipWindow } from "./pip/usePipWindow";
import ReportDialog from "./report/ReportDialog";
import RoomBanners, { ConnectionBanner } from "./RoomBanners";
import SettingsModal from "./settings/SettingsModal";
import {
  AloneCenter,
  CodeCenter,
  HiddenStreamCard,
  HiddenStreamCenter,
  ReconnectingCenter,
  SelfShareCard,
  SelfShareCenter,
  SelfSharePill,
} from "./stage/RoomCenter";
import ScreenShareStage from "./stage/ScreenShareStage";
import { useScreenShareControl } from "./stage/useScreenShareControl";
import { useScreenShares } from "./stage/useScreenShares";
import { useRoomLink, useRoomSession } from "./state/RoomSession";
import { useRoomMeta } from "./state/useRoomMeta";
import { useVolumes } from "./state/volumes";

/** Открытая панель участника: у его места, наружу от стола. */
type PanelTarget = { p: Participant; anchor: Rect; side: PanelSide };

/** Карточка состояния над рядом и списком (там, где нет центра стола). */
const STATE_CARD = "rounded-card border border-dashed border-line-strong p-5";

/**
 * Экран комнаты — каркас «Эфира»: шапка → [полоса связи] → {зона | чат} → док.
 * Зона меняет вид по своему размеру: стол, ряд или список, а если кто-то
 * показывает экран — сцена с лентой участников. Данные каждая часть берёт из
 * контекстов комнаты сама. Мини-комната поверх игры рисуется сюда же порталом.
 *
 * Зона — <main tabIndex={-1} data-autofocus>: после входа на неё ставится
 * фокус (RoomBehavior), а не на кнопку дока — иначе Enter «написать в чат»
 * нажал бы эту кнопку.
 */
export default function RoomView() {
  const connected = useConnectionState() === ConnectionState.Connected;
  const { reconnecting } = useRoomLink();
  const { code } = useRoomSession();
  const chat = useChatPanel();
  const { title, hostIdentity } = useRoomMeta();
  const { mutes } = useVolumes();
  const share = useScreenShareControl();
  const screens = useScreenShares();
  const pip = usePipWindow(`${title} · Game Room`);

  const people = usePeople();
  const colors = useMemo(() => avatarColorMap(people), [people]);
  const rumik = useRumikTable();
  useRoomToasts({ colors, screens });
  useGameFeed({ colors });

  const rootRef = useRef<HTMLDivElement>(null);
  const zoneRef = useRef<HTMLElement>(null);
  const bannersRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const layout = useZoneLayout(zoneRef);
  useToastTop(
    { root: rootRef, zone: zoneRef, banners: bannersRef, stage: stageRef, list: listRef, dock: dockRef },
    `${layout}:${screens.focused ? "stage" : "seats"}`,
  );

  // Узкое окно (список): чат по умолчанию открыт секцией под списком — иначе
  // окно сбоку от игры на две трети пустое (решение 3, ревью М4). Один раз за
  // вход и без фокуса в поле: свернул — так и остаётся.
  const chatShownRef = useRef(false);
  const { open: chatOpen, show: showChat } = chat;
  useEffect(() => {
    if (layout !== "list" || chatShownRef.current) return;
    chatShownRef.current = true;
    if (!chatOpen) showChat();
  }, [layout, chatOpen, showChat]);

  const [panel, setPanel] = useState<PanelTarget | null>(null);
  const openPanel = useCallback((p: Participant, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const zone = zoneRef.current?.getBoundingClientRect();
    const mid = zone ? zone.left + zone.width / 2 : window.innerWidth / 2;
    setPanel({
      p,
      anchor: { x: r.left, y: r.top, width: r.width, height: r.height },
      side: panelSide(r.left + r.width / 2, mid),
    });
  }, []);
  const closePanel = useCallback(() => setPanel(null), []);

  const model: SeatsModel = { people, colors, hostIdentity, mutes, onOpen: openPanel };
  const hidden = screens.remote.filter((s) => s.hidden);
  const watchHidden = () => screens.watch();
  // Пока связь восстанавливается, друзья пропадают с мест не потому, что ушли:
  // «Пока тут только вы» и «Скопировать ссылку» тут врут (ревью М6).
  const alone = people.length <= 1 && !reconnecting;
  const lonelyReconnect = people.length <= 1 && reconnecting;

  // Состояние комнаты: в центре стола или плашкой над рядом и списком.
  const center = reconnecting ? (
    <ReconnectingCenter />
  ) : share.enabled ? (
    <SelfShareCenter local={screens.local} />
  ) : hidden.length > 0 ? (
    <HiddenStreamCenter hidden={hidden} onWatch={watchHidden} />
  ) : alone ? (
    // За столом под углом вы сами стоите Румиком — второй Румик в центре не нужен.
    <AloneCenter figure={!rumik} />
  ) : (
    <CodeCenter />
  );
  const card = share.enabled ? (
    <SelfShareCard local={screens.local} />
  ) : hidden.length > 0 ? (
    <HiddenStreamCard hidden={hidden} onWatch={watchHidden} />
  ) : null;
  const lonely = card ? null : alone ? <AloneCenter /> : lonelyReconnect ? <ReconnectingCenter /> : null;

  let zone;
  if (screens.focused) {
    zone = (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 max-sm:overflow-y-auto sm:p-4 sm:pb-24">
        <ScreenShareStage ref={stageRef} screens={screens} focused={screens.focused} colors={colors} />
        {layout === "list" ? (
          <>
            {share.enabled && <SelfShareCard local={screens.local} />}
            <SeatList ref={listRef} model={model} />
          </>
        ) : (
          <SeatRibbon model={model} lead={share.enabled ? <SelfSharePill /> : undefined} />
        )}
      </div>
    );
  } else if (layout === "table") {
    zone = (
      <div className="grid min-h-0 flex-1 place-items-center p-6 pb-28 [container-type:size]">
        <RoundTable model={model} center={center} />
      </div>
    );
  } else if (layout === "row") {
    zone = (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-6 pb-28">
        <SeatRow model={model} />
        {card}
        {lonely && <div className={cn("w-full max-w-md", STATE_CARD)}>{lonely}</div>}
      </div>
    );
  } else {
    zone = (
      <div className="min-h-0 flex-1 overflow-y-auto">
        {card && <div className="px-3 pt-3">{card}</div>}
        <SeatList ref={listRef} model={model} />
        {lonely && <div className={cn("mx-3 mt-2", STATE_CARD)}>{lonely}</div>}
      </div>
    );
  }

  return (
    <UiRoot
      ref={rootRef}
      data-testid="room"
      data-connected={connected}
      className="fixed inset-0 flex flex-col overflow-hidden [--gr-toast-top:68px]"
      style={{ "--chat-w": chat.open ? "360px" : "0px" } as CSSProperties}
    >
      <RoomHeader onOpenPip={pip.supported ? pip.open : undefined} hostItems={<RoomMenuHostItems />} />
      <ConnectionBanner />
      {/* Объявления администрации «в комнате» (техработы, новости) — полосой под шапкой. */}
      <AnnouncementBar room={code} />

      <div className="relative flex min-h-0 flex-1 max-sm:flex-col">
        <main
          ref={zoneRef}
          aria-label="Комната"
          tabIndex={-1}
          data-autofocus=""
          className={cn(
            "relative flex min-h-0 min-w-0 flex-1 flex-col focus-visible:outline-0",
            // Узкое окно с открытым чатом: чат — секцией под списком. Со сценой
            // зоне нужно больше: видео 16:9 во всю ширину плюс список под ним.
            chat.open && "max-sm:flex-none max-sm:overflow-y-auto",
            chat.open && (screens.focused ? "max-sm:max-h-[62%]" : "max-sm:max-h-[44%]"),
          )}
        >
          <div
            aria-busy={reconnecting || undefined}
            className={cn(
              "flex min-h-0 flex-1 flex-col transition-opacity duration-240",
              // Пока переподключаемся, комната «замирает»: данные устарели.
              reconnecting && "opacity-45",
            )}
          >
            <div ref={bannersRef} className="mx-auto w-full max-w-xl px-3 pt-3 empty:hidden">
              <RoomBanners />
            </div>
            {zone}
          </div>
        </main>
        <RoomChat />
      </div>

      <Dock ref={dockRef} />

      {panel && (
        <ParticipantMenu
          key={panel.p.identity}
          p={panel.p}
          anchor={panel.anchor}
          side={panel.side}
          onClose={closePanel}
        />
      )}
      <SettingsModal />
      <HostDialogs />
      <ReportDialog />
      <Toaster placement="top-left" />
      {pip.window &&
        createPortal(<PipRoom win={pip.window} title={title} onClose={pip.close} />, pip.window.document.body)}
    </UiRoot>
  );
}
