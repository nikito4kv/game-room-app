"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { PreviewParticipant, PreviewResponse, TokenResponse } from "@/lib/api/contract";
import {
  AvatarStack,
  Button,
  Card,
  Dialog,
  InlineAlert,
  LevelMeter,
  Logo,
  Rumik,
  Select,
  Skeleton,
  TablePreview,
  TextField,
  UiRoot,
  assignAvatarColors,
  avatarColorIndex,
  cn,
  glueShortWords,
} from "@/components/ui";
import { AnnouncementBar } from "@/components/platform/AnnouncementBar";
import { ClubBadge } from "@/components/platform/ClubBadge";
import { LazyRumikEditor } from "@/components/rumik/LazyRumikEditor";
import { PostcardButton } from "@/components/rumik/PostcardButton";
import { trackRumikEditor, trackRumikEditorOpened } from "@/lib/analytics/rumik";
import { formatCountdown } from "@/lib/client/joinScreens";
import { maintenanceText } from "@/lib/client/publicConfig";
import { usePublicConfig } from "@/lib/client/usePublicConfig";
import type { Refusal } from "@/lib/client/session";
import { useMyPaint } from "@/lib/rumik/useMyRumik";
import { formatKeyCode } from "@/lib/keys";
import { plural } from "@/lib/plural";
import { copyText, inviteLink } from "../header/invite";
import { bindsPref } from "../state/prefs";
import { lobbyMicHint } from "./lobbyTexts";
import SessionScreen from "./SessionScreen";
import { useCountdown } from "./useCountdown";
import { useLobby, type JoinCredentials, type Lobby as LobbyModel } from "./useLobby";
import { useLobbyDevices, type LobbyDevices } from "./useLobbyDevices";

/** «Тёма, Ника и Лёха уже тут» — ник не склоняем. */
function whoIsInside(names: string[]): string {
  if (names.length === 0) return "Пока внутри никого";
  if (names.length === 1) return `${names[0]} уже тут`;
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} и ${names[names.length - 1]} уже тут`;
  return `${names.slice(0, 3).join(", ")} и ещё ${names.length - 3} уже тут`;
}

/** Без имён (у комнаты пароль) — только сколько людей внутри. */
function countInside(n: number): string {
  if (n === 0) return "Пока внутри никого";
  return `Внутри ${n} ${plural(n, ["человек", "человека", "человек"])}`;
}

function guests(participants: PreviewParticipant[]) {
  const colors = assignAvatarColors(participants.map((p) => p.name));
  return participants.map((p, i) => ({ name: p.name, colorIndex: colors[i], host: p.isHost }));
}

/**
 * Свой цвет Румика, если войти сейчас: цвета раздаются по порядку входа, вы —
 * последний (assignAvatarColors), поэтому чужие цвета от вашего ника не меняются.
 */
function myColorIndex(name: string, participants: PreviewParticipant[] | null | undefined): number {
  if (!participants) return avatarColorIndex(name);
  return assignAvatarColors([...participants.map((p) => p.name), name]).at(-1) ?? avatarColorIndex(name);
}

const noSubscribe = () => () => {};

const readMicKey = () => formatKeyCode(bindsPref.get().mic);

/**
 * Лобби перед входом: куда зовут и кто внутри (слева), форма — ник, пароль,
 * микрофон с полосой уровня, вывод с «Проверить» и «Войти в комнату» (справа).
 * На узком экране — одна колонка, стол скрыт. Комнаты нет, выгнали, полна —
 * экраны вместо формы.
 */
export default function Lobby({
  code,
  notice,
  beforeJoin,
  onJoined,
}: {
  code: string;
  notice: Refusal | null;
  beforeJoin: () => void;
  onJoined: (join: TokenResponse, credentials: JoinCredentials, preview: PreviewResponse | null) => void;
}) {
  const devices = useLobbyDevices();
  const lobby = useLobby({
    code,
    notice,
    beforeJoin: () => {
      devices.save();
      beforeJoin();
    },
    onJoined,
  });
  // Форма живёт только на клиенте: ник, устройства и ключ владельца — из этого
  // браузера, а напечатанное в серверную разметку до гидратации React потерял бы
  // (или склеил с сохранённым ником).
  const hydrated = useSyncExternalStore(noSubscribe, () => true, () => false);
  const config = usePublicConfig(code);
  // Режим обслуживания закрыл вход: говорим сразу, до ника (сервер всё равно не пустит).
  const joinsClosed = config?.maintenance.blockJoins ? maintenanceText(config) : null;
  // Стол и стопка из Румиков (R3); флаг rumik_table выключен — прежние кружки с инициалами.
  const rumikTable = config?.flags.rumik_table !== false;
  // Рисовалка (R2): гость по ссылке лендинг не видит — лобби его единственное место
  // нарисовать себя. Без стола из Румиков рисунок никто не увидит — тогда и «Ваш Румик» не нужен.
  const rumikEditor = config?.flags.rumik_editor !== false && rumikTable;
  const myPaint = useMyPaint();

  if (lobby.screen) {
    return (
      <SessionScreen
        view={lobby.screen}
        code={code}
        title={lobby.preview.status === "ready" ? lobby.preview.room.title : undefined}
        onRetry={lobby.submit}
        retrying={lobby.busy}
      />
    );
  }

  const room = lobby.preview.status === "ready" ? lobby.preview.room : null;
  const people = room?.participants ? guests(room.participants) : [];
  const who = !room
    ? null
    : room.participants
      ? whoIsInside(room.participants.map((p) => p.name))
      : countInside(room.participantCount);
  // Внутри никого (обычно это сам создатель): вместо пустоты — стол с кодом, а
  // владельцу — «Пригласить», ради чего он сюда и пришёл.
  const empty = !!room && room.participantCount === 0;
  const invite = hydrated && empty && lobby.isOwner;
  // Ваше место за столом (макет: «Ваше место · вы»): ваш рисунок из этого браузера
  // или ваш цвет. Чужих рисунков в лобби нет сознательно: их видят только в комнате.
  const myName = lobby.name.trim();
  const myColor = myColorIndex(myName, room?.participants);
  // Место есть сразу, и на сервере: иначе после гидрации стол сменил бы размер
  // (пустой стол крупнее). Ник и цвет из браузера — только после гидрации.
  const seats = rumikTable
    ? [
        ...people,
        {
          name: (hydrated && myName) || "Ваше место",
          colorIndex: hydrated ? myColor : undefined,
          paint: myPaint,
          me: true,
        },
      ]
    : people;

  return (
    <UiRoot className="fixed inset-0 overflow-y-auto">
      <AnnouncementBar room={code} />
      <header className="mx-auto flex h-16 w-full max-w-[1040px] items-center px-5">
        <Link href="/" aria-label="Game Room, на главную" className="rounded-control">
          <Logo variant="lockup" height={26} className="text-ink" />
        </Link>
      </header>
      <main className="mx-auto grid w-full max-w-[1040px] items-center gap-8 px-5 pb-16 pt-4 lg:min-h-[calc(100dvh-64px-64px)] lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-14">
        <section className="flex min-w-0 flex-col" aria-busy={lobby.preview.status === "loading" || undefined}>
          {/* Создатель (есть ключ владельца) возвращается к себе — его никто не звал. */}
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-label text-ink-3">{lobby.isOwner ? "Ваша комната" : "Вас зовут в комнату"}</p>
            {room?.badge && <ClubBadge badge={room.badge} />}
          </div>
          {room ? (
            <h1 className="mt-2 text-balance font-brand text-display text-ink">{glueShortWords(room.title)}</h1>
          ) : lobby.preview.status === "loading" ? (
            <Skeleton className="mt-3 h-9 w-2/3" />
          ) : (
            <h1 className="mt-2 font-brand text-display tracking-[0.16em] text-ink">{code}</h1>
          )}
          {who && (
            <div className="mt-4 flex items-center gap-3">
              {people.length > 0 && (
                <AvatarStack people={people} size="sm" variant={rumikTable ? "rumik" : "initials"} />
              )}
              <p className="text-body text-ink-2" data-testid="lobby-who">
                {who}
              </p>
            </div>
          )}
          {/* На узком стола нет — «Пригласить» строкой под составом. */}
          {invite && (
            <div className="mt-4 flex flex-wrap items-center gap-3 lg:hidden">
              <InviteButton code={code} />
              <span className="text-label text-ink-3">
                Код <span className="font-brand tracking-[0.12em] text-ink-2">{code}</span>
              </span>
            </div>
          )}
          {(people.length > 0 || empty) && (
            <div className="mt-4 h-[440px] w-full max-w-[520px] [container-type:size] max-lg:hidden">
              <div className="grid h-full place-items-center">
                <TablePreview
                  people={seats}
                  variant={rumikTable ? "rumik" : "avatars"}
                  center={
                    people.length > 0 ? (
                      <span className="font-brand text-[15px] font-semibold tracking-[0.16em] text-ink-3">{code}</span>
                    ) : (
                      <EmptyTableCenter code={code} invite={invite} />
                    )
                  }
                />
              </div>
            </div>
          )}
        </section>

        <Card padding="lg" className="flex flex-col gap-5">
          {hydrated ? (
            <LobbyForm
              lobby={lobby}
              devices={devices}
              locked={!!room?.locked && !lobby.isOwner}
              joinsClosed={joinsClosed}
              rumikEditor={rumikEditor}
              myColor={myColor}
            />
          ) : (
            <FormSkeleton />
          )}
        </Card>
      </main>
    </UiRoot>
  );
}

/** Центр пустого стола: код для диктовки голосом и (владельцу) «Пригласить». */
function EmptyTableCenter({ code, invite }: { code: string; invite: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-caption text-ink-3">код комнаты</span>
      <span className="font-brand text-title font-semibold tracking-[0.16em] text-ink">{code}</span>
      {invite && <InviteButton code={code} className="mt-3" />}
    </div>
  );
}

/**
 * «Пригласить»: копирует ссылку на комнату. В лобби нет места для тостов,
 * поэтому ответ — на самой кнопке, пару секунд.
 */
function InviteButton({ code, className }: { code: string; className?: string }) {
  // null — не нажимали; true — скопировали; false — браузер не дал.
  const [copied, setCopied] = useState<boolean | null>(null);
  useEffect(() => {
    if (copied === null) return;
    const timer = window.setTimeout(() => setCopied(null), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy() {
    setCopied(await copyText(inviteLink(code)));
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        icon={copied ? "check" : "user-plus"}
        className={className}
        onClick={() => void copy()}
        data-testid="lobby-invite"
      >
        {copied ? "Ссылка скопирована" : "Пригласить"}
      </Button>
      <span role="status" className="sr-only">
        {copied === true
          ? "Ссылка на комнату скопирована. Отправьте её друзьям."
          : copied === false
            ? "Не получилось скопировать. Скопируйте адрес страницы."
            : ""}
      </span>
      {copied === false && (
        <span className="text-caption text-ink-3">Не получилось скопировать. Скопируйте адрес страницы.</span>
      )}
    </>
  );
}

/** Форма входа: ник, свой Румик, пароль, микрофон, звук и «Войти в комнату». */
function LobbyForm({
  lobby,
  devices,
  locked,
  joinsClosed,
  rumikEditor,
  myColor,
}: {
  lobby: LobbyModel;
  devices: LobbyDevices;
  locked: boolean;
  /** Текст обслуживания, если вход сейчас закрыт администрацией. */
  joinsClosed: string | null;
  /** Флаги rumik_editor и rumik_table: «Ваш Румик» и окно «Раскрасить». */
  rumikEditor: boolean;
  /** Цвет вашего Румика без рисунка. */
  myColor: number;
}) {
  const waitLeft = useCountdown(lobby.waitUntil);
  const micKey = useSyncExternalStore(noSubscribe, readMicKey, () => "M");
  const problem = lobby.problem;
  const playing = devices.outputTest === "playing";
  const [painting, setPainting] = useState(false);

  return (
    <>
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          lobby.submit();
        }}
      >
        {/* Сразу, до ника: новичок не должен заполнять форму, чтобы узнать, что его не пустят. */}
        {joinsClosed && (
          <InlineAlert tone="caution" title="Идут технические работы">
            {joinsClosed}
          </InlineAlert>
        )}
        {locked && (
          <InlineAlert tone="caution" icon="lock" title="Вход закрыт">
            Хост закрыл комнату для новых людей. Зайти могут только те, кто уже был внутри.
          </InlineAlert>
        )}

        <div className="flex flex-col gap-2">
          <TextField
            data-testid="join-nickname"
            label="Ваш ник"
            value={lobby.name}
            onChange={(e) => lobby.setName(e.target.value)}
            maxLength={24}
            autoComplete="nickname"
            autoFocus={!lobby.name}
            hint="Так вас увидят друзья"
            error={problem?.field === "name" ? problem.message : undefined}
          />
          {problem?.field === "name" && problem.suggestion && (
            <Button
              size="sm"
              variant="secondary"
              className="self-start"
              onClick={() => lobby.setName(problem.suggestion ?? "")}
            >
              Взять «{problem.suggestion}»
            </Button>
          )}
        </div>

        {rumikEditor && (
          <YourRumik
            colorIndex={myColor}
            onPaint={() => {
              setPainting(true);
              trackRumikEditorOpened("lobby");
            }}
          />
        )}

        {lobby.needsPassword && (
          <TextField
            data-testid="join-password"
            label="Пароль комнаты"
            type="password"
            autoComplete="current-password"
            value={lobby.password}
            onChange={(e) => lobby.setPassword(e.target.value)}
            autoFocus={!!lobby.name}
            hint="Спросите у того, кто позвал"
            error={problem?.field === "password" ? problem.message : undefined}
          />
        )}

        <div className="flex flex-col gap-2">
          <Select
            label="Микрофон"
            icon="mic"
            value={devices.micId}
            onChange={(e) => devices.setMicId(e.target.value)}
            options={devices.micOptions}
          />
          <LevelMeter getLevelDb={devices.getLevelDb} mode="off" size="sm" label="Уровень вашего микрофона" />
          {devices.micError ? (
            <InlineAlert
              tone="caution"
              title={devices.micError.title}
              action={
                <Button size="sm" variant="secondary" onClick={devices.retryMic}>
                  Повторить
                </Button>
              }
            >
              {lobbyMicHint(devices.micError.kind)}
            </InlineAlert>
          ) : (
            <p className="text-caption text-ink-3">Скажите что-нибудь: полоса должна двигаться.</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-2">
            {devices.outputSupported ? (
              <Select
                label="Звук"
                icon="headphones"
                value={devices.outId}
                onChange={(e) => devices.setOutId(e.target.value)}
                options={devices.outOptions}
                wrapperClassName="min-w-0 flex-1"
              />
            ) : (
              <p className="min-w-0 flex-1 pb-2.5 text-label text-ink-3">Звук пойдёт в устройство, выбранное в системе.</p>
            )}
            {/* Ширина не прыгает между «Проверить» и «Играет…». */}
            <Button
              variant="secondary"
              icon={playing ? "audio-lines" : "volume"}
              onClick={devices.testOutput}
              className="min-w-[8.25rem]"
              data-testid="lobby-test-sound"
            >
              {playing ? "Играет…" : "Проверить"}
            </Button>
          </div>
          {devices.outError ? (
            <p className="text-caption text-alert-ink">{devices.outError}</p>
          ) : (
            // Пока играет, видно саму кнопку («Играет…»); строка — для скринридера и для «не услышали?».
            <p role="status" className={cn("text-caption text-ink-3", devices.outputTest !== "played" && "sr-only")}>
              {devices.outputTest === "played"
                ? "Не услышали звук? Прибавьте громкость или выберите другое устройство."
                : playing
                  ? "Играет проверочный звук"
                  : ""}
            </p>
          )}
        </div>

        {problem?.field === "form" && <InlineAlert tone="alert">{problem.message}</InlineAlert>}

        <Button
          data-testid="join-submit"
          variant="primary"
          size="lg"
          icon="log-in"
          block
          type="submit"
          loading={lobby.busy}
          disabled={waitLeft > 0}
        >
          {waitLeft > 0 ? `Войти можно через ${formatCountdown(waitLeft)}` : locked ? "Попробовать войти" : "Войти в комнату"}
        </Button>
        <p className="-mt-2 text-center text-caption text-ink-3">
          Микрофон включится сразу.
          {/* На телефоне клавиатуры нет — про клавишу не говорим. */}
          <span className="pointer-coarse:hidden"> Выключить можно клавишей {micKey}.</span>
        </p>
        <p className="-mt-3 text-center text-caption text-ink-3" data-testid="rules-note">
          Входя, вы принимаете{" "}
          <Link href="/rules" target="_blank" rel="noopener" className="text-ink-2 underline underline-offset-4 hover:text-ink">
            правила Game Room
          </Link>
          .
        </p>
      </form>
      {/* Окно — вне <form>: Enter в поле рисовалки (цвет HEX) не должен отправлять вход. */}
      {rumikEditor && (
        // Рисунок сохраняется сам, поэтому вместо крестика — маленькая «Готово» в
        // шапке, как в макете (lobby.html, 08-editor-dialog.png). Esc и подложка закрывают как обычно.
        <Dialog
          open={painting}
          onOpenChange={setPainting}
          title="Ваш Румик"
          size="lg"
          data-testid="lobby-rumik-dialog"
          headerAction={
            <Button size="sm" variant="secondary" onClick={() => setPainting(false)}>
              Готово
            </Button>
          }
        >
          {painting && (
            <LazyRumikEditor
              variant="dialog"
              onEvent={(e) => trackRumikEditor(e, "lobby")}
              actions={<PostcardButton place="lobby" />}
            />
          )}
        </Dialog>
      )}
    </>
  );
}

/**
 * «Ваш Румик» рядом с ником: свой рисунок из этого браузера и «Раскрасить».
 * Необязательно и входу не мешает: без рисунка в комнате вы Румик своего цвета
 * (как за столом: цвет по нику), его и показываем.
 */
function YourRumik({ colorIndex, onPaint }: { colorIndex: number; onPaint: () => void }) {
  const paint = useMyPaint();
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-label font-medium text-ink-2">Ваш Румик</p>
      <div className="flex items-center gap-3.5 rounded-card border border-line-strong bg-sunken p-3">
        <Rumik
          colors={paint ? "white" : colorIndex}
          paint={paint ?? undefined}
          size={84}
          label={paint ? "Ваш Румик с рисунком" : "Ваш Румик без рисунка"}
        />
        <div className="flex min-w-0 flex-col items-start gap-2">
          <Button size="sm" variant="secondary" icon="brush" onClick={onPaint} data-testid="lobby-rumik-paint">
            Раскрасить
          </Button>
          <p className="text-caption text-ink-3">
            {paint ? "Поменять можно в любой момент." : "Можно не рисовать: без рисунка ваш Румик будет одного цвета."}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Форма до гидратации: те же места, чтобы карточка не прыгала. */
function FormSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
      <Skeleton className="h-12 w-full" />
    </div>
  );
}
