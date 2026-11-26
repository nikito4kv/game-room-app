import { notFound } from "next/navigation";
import { ErrorPreview } from "../_mocks/ErrorPreview";
import { EditorDemo } from "../_mocks/EditorDemo";
import { LandingMockV2 } from "../_mocks/LandingMockV2";
import { LandingMock } from "../_mocks/LandingMock";
import { LobbyMock } from "../_mocks/LobbyMock";
import { PipMock } from "../_mocks/PipMock";
import { RoomMock, type RoomVariant } from "../_mocks/RoomMock";
import { RumikShowcase } from "../_mocks/RumikShowcase";
import { LostScreen, StatesMock } from "../_mocks/StatesMock";
import type { MicState } from "../_mocks/room-parts";

// Полноэкранные макеты: /design/<экран>?параметры. Список с описаниями — на /design.
//   room?v=normal|alone|stage|stage-self|stage-two&chat=1&reconnecting=1&toasts=1
//        &mic=on|off|ptt-idle|ptt-talk|forced&deafened=1&keys=1&zoom=1&stats=1
//   settings · host?view=actions|kick|ban|room · landing · lobby?password=1
//   pip · states · lost · error (страница ошибки src/app/error.tsx)
//   rumik (маскот бренд-слоя: позы, глаза, цвета, рисунок, головы, жесты, песочница, правила декора)
//   editor (рисовалка Румика: hero и окно лобби, раскладки, клавиши); у всех ?theme=light

type Params = { [key: string]: string | string[] | undefined };

const VARIANTS: RoomVariant[] = ["normal", "alone", "stage", "stage-self", "stage-two"];
const MICS: MicState[] = ["on", "off", "ptt-idle", "ptt-talk", "forced"];

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function DesignScreen({
  params,
  searchParams,
}: {
  params: Promise<{ screen: string }>;
  searchParams: Promise<Params>;
}) {
  const { screen } = await params;
  const q = await searchParams;
  const flag = (k: string) => one(q[k]) === "1";
  const theme = one(q.theme) === "light" ? "light" : undefined;

  switch (screen) {
    case "landing-2":
      return <LandingMockV2 theme={theme} nick={flag("nick")} />;
    case "landing":
      return <LandingMock theme={theme} />;
    case "lobby":
      return <LobbyMock password={flag("password")} theme={theme} />;
    case "room": {
      const v = one(q.v) as RoomVariant | undefined;
      const mic = one(q.mic) as MicState | undefined;
      return (
        <RoomMock
          variant={v && VARIANTS.includes(v) ? v : "normal"}
          chat={flag("chat")}
          reconnecting={flag("reconnecting")}
          toasts={flag("toasts")}
          invite={flag("invite")}
          mic={mic && MICS.includes(mic) ? mic : "on"}
          deafened={flag("deafened")}
          showKeys={flag("keys")}
          zoomed={flag("zoom")}
          stats={flag("stats")}
          recap={flag("recap")}
          theme={theme}
        />
      );
    }
    case "settings":
      return <RoomMock settings theme={theme} />;
    case "host": {
      const view = one(q.view);
      if (view === "room") return <RoomMock roomSettings theme={theme} />;
      return <RoomMock participant={view === "kick" || view === "ban" ? view : "actions"} theme={theme} />;
    }
    case "pip":
      return <PipMock />;
    case "states":
      return <StatesMock />;
    case "lost":
      return <LostScreen />;
    case "error":
      return <ErrorPreview />;
    case "rumik":
      return <RumikShowcase theme={theme} />;
    case "editor":
      return <EditorDemo theme={theme} />;
    default:
      notFound();
  }
}
