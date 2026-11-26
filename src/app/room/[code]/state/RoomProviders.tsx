"use client";

import type { ReactNode } from "react";
import { DeafenProvider } from "../audio/useDeafen";
import { AvatarSync } from "../avatar/AvatarSync";
import { MicProvider } from "../audio/useMic";
import { ChatPanelProvider } from "../chat/useChatPanel";
import ReactionFeed from "../reactions/ReactionFeed";
import SoundCatalogSync from "../sounds/SoundCatalogSync";
import { SettingsDialogProvider } from "../settings/useSettingsDialog";
import { ScreenShareProvider } from "../stage/useScreenShareControl";
import { StatusProvider } from "../status/useStatus";
import { RoomActionsProvider } from "./RoomActions";
import { RoomSessionProvider, type RoomSession } from "./RoomSession";
import { ModerationProvider } from "./useModeration";
import { VolumesProvider } from "./volumes";

/**
 * Все контексты комнаты. Живут внутри <LiveKitRoom>: микрофон и экран — это его
 * переключатели. Порядок важен — внутренние читают внешние: модерация берёт
 * сессию, действия — микрофон, звук, экран, настройки и чат. DOM почти не
 * добавляют: ReactionFeed — одна скрытая live-область для скринридера (реакции),
 * AvatarSync ничего не рисует.
 */
export default function RoomProviders({
  session,
  onLeave,
  children,
}: {
  session: RoomSession;
  onLeave: () => void;
  children: ReactNode;
}) {
  return (
    <RoomSessionProvider session={session}>
      <ReactionFeed />
      <SoundCatalogSync />
      <AvatarSync />
      <VolumesProvider>
        <DeafenProvider>
          <ModerationProvider>
            <MicProvider>
              <ScreenShareProvider>
                <SettingsDialogProvider>
                  <ChatPanelProvider>
                    <StatusProvider>
                      <RoomActionsProvider onLeave={onLeave}>{children}</RoomActionsProvider>
                    </StatusProvider>
                  </ChatPanelProvider>
                </SettingsDialogProvider>
              </ScreenShareProvider>
            </MicProvider>
          </ModerationProvider>
        </DeafenProvider>
      </VolumesProvider>
    </RoomSessionProvider>
  );
}
