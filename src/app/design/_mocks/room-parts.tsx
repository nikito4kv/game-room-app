"use client";

// Части экрана комнаты для макетов. Это эталон раскладки для фазы 2: классы,
// размеры и порядок элементов берите отсюда. Данные — моковые, без LiveKit.

import { useRef, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  CountBadge,
  EmptyState,
  Icon,
  IconButton,
  Logo,
  Menu,
  MenuConfirm,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
  PopoverItem,
  Rumik,
  SignalBars,
  Slider,
  Switch,
  Tooltip,
  cn,
} from "@/components/ui";
import { RumikAvatar } from "@/components/ui/Avatar";
import {
  SEAT_FRAME_CLASS,
  SeatLabel,
  SeatStatusBadge,
  SpeakingBadge,
  TableArena,
  arenaSeatStyle,
} from "@/components/ui/TablePreview";
import { arenaLayout } from "@/components/ui/tableLayout";
import { REACTION_KINDS } from "@/lib/api/contract";
import { useMyPaint } from "@/lib/rumik/useMyRumik";
import { REACTION_VIEW } from "@/app/room/[code]/reactions/gesture";
import { GlyphToolbar, type ToolbarItem } from "@/app/room/[code]/reactions/ReactionButton";
import { InviteShare } from "@/app/room/[code]/header/InviteShare";
import { CHAT, PEOPLE, ROOM, personByName, type MockPerson } from "./data";

/* ------------------------------------------------------------------ Шапка */

export function RoomHeader({
  locked = false,
  host = true,
  inviteOpen = false,
}: {
  locked?: boolean;
  host?: boolean;
  inviteOpen?: boolean;
}) {
  return (
    <header className="relative z-[var(--gr-z-sticky)] flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 sm:px-4">
      <Logo variant="mark" height={26} title="" className="hidden shrink-0 text-ink sm:block" />
      <RoomTitleMenu locked={locked} host={host} />
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <ConnectionChip quality="excellent" ping={42} />
        {/* Только где есть Document PiP (Chrome/Edge) и окно широкое: узкое окно
            само стоит сбоку от игры. */}
        <IconButton icon="pip" label="Мини-комната" variant="ghost" tooltipSide="bottom" wrapperClassName="max-sm:hidden" />
        <InviteButton defaultOpen={inviteOpen} />
      </div>
    </header>
  );
}

function RoomTitleMenu({ locked, host }: { locked: boolean; host: boolean }) {
  return (
    <Menu
      label="Действия с комнатой"
      trigger={
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors duration-140 hover:bg-wash-2"
        >
          <span className="truncate font-brand text-[15px] font-semibold tracking-[-0.01em] text-ink sm:text-[17px]">
            {ROOM.title}
          </span>
          {locked && <Icon name="lock" size={15} className="shrink-0 text-caution-ink" />}
          <Icon name="chevron-down" size={16} className="shrink-0 text-ink-3" />
        </button>
      }
    >
      <MenuItem icon="link">Скопировать ссылку</MenuItem>
      <MenuItem icon="hash" hint={ROOM.code}>
        Скопировать код
      </MenuItem>
      <MenuItem icon="pip">Мини-комната</MenuItem>
      {host ? (
        <>
          <MenuSeparator />
          <MenuLabel>Вы хост</MenuLabel>
          <MenuItem icon="shield">Настройки комнаты</MenuItem>
          <MenuItem icon={locked ? "unlock" : "lock"} checked={locked} keepOpen>
            Закрыть вход
          </MenuItem>
        </>
      ) : (
        <>
          <MenuSeparator />
          <MenuItem icon="crown">Вернуть права хоста</MenuItem>
        </>
      )}
      <MenuSeparator />
      <MenuItem icon="leave" tone="danger">
        Выйти из комнаты
      </MenuItem>
    </Menu>
  );
}

function ConnectionChip({ quality, ping }: { quality: "excellent" | "poor"; ping: number }) {
  return (
    <Tooltip content={`Связь с сервером: ${quality === "excellent" ? "отличная" : "слабая"}, ${ping} мс`}>
      <span className="flex h-8 items-center gap-2 rounded-control px-2 text-label tabular-nums text-ink-3">
        <SignalBars quality={quality} label="" />
        <span className="sr-only">Связь с сервером:</span>
        <span className="max-sm:sr-only">{ping} мс</span>
      </span>
    </Tooltip>
  );
}

/** Главная кнопка шапки. Клик сразу копирует ссылку и открывает подтверждение. */
function InviteButton({ defaultOpen }: { defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={ref}
        variant="primary"
        icon="user-plus"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="max-sm:hidden"
      >
        Пригласить
      </Button>
      <IconButton
        icon="user-plus"
        label="Пригласить"
        variant="inverse"
        className="sm:hidden"
        onClick={() => setOpen((v) => !v)}
      />
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchor={ref}
        side="bottom"
        align="end"
        aria-label="Пригласить друзей"
        className="w-[min(340px,calc(100vw-16px))] p-3.5"
      >
        <InvitePanel />
      </Popover>
    </>
  );
}

export function InvitePanel() {
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-label text-ink-2">
        <Icon name="check-circle" size={16} className="text-signal-ink" />
        Ссылка скопирована. Отправьте её друзьям: регистрация не нужна.
      </p>
      <div className="flex items-center gap-2 rounded-control border border-line-strong bg-sunken py-1 pl-3 pr-1">
        <span className="min-w-0 flex-1 truncate text-body text-ink-2">{ROOM.link}</span>
        <Button size="sm" variant="secondary" icon="copy">
          Ещё раз
        </Button>
      </div>
      <InviteShare link={`https://${ROOM.link}`} title={ROOM.title} code={ROOM.code} />
      <p className="flex items-baseline justify-between gap-3 text-caption text-ink-3">
        <span>Или продиктуйте код</span>
        <span className="font-brand text-[15px] font-semibold tracking-[0.18em] text-ink">{ROOM.code}</span>
      </p>
    </div>
  );
}

/* ------------------------------------------------------- Круглый стол */


/**
 * Стол под углом: Румики одного размера стоят по эллипсу вокруг стола, свой —
 * внизу, ближе к зрителю; у дальних мест ник над головой. Центр стола — место
 * под состояние комнаты (код, «Пока тут только вы», свой показ). Размер — от
 * контейнера (cqw/cqh): стол ужимается, когда открыт чат, и выбирается по
 * высоте окна. Свой Румик — с рисунком из рисовалки (если есть).
 */
export function RoundTable({
  people,
  center,
  onSeatClick,
}: {
  people: MockPerson[];
  center?: ReactNode;
  onSeatClick?: (p: MockPerson, el: HTMLElement) => void;
}) {
  const paint = useMyPaint();
  const arena = arenaLayout(
    people.length,
    Math.max(
      0,
      people.findIndex((p) => p.me),
    ),
  );
  return (
    <TableArena center={center} className="w-[min(1100px,100cqw,calc(100cqh*16/11))]">
      <ul className="contents">
        {people.map((p, i) => {
          const s = arena.seats[i];
          return (
            <li key={p.id} className="absolute" style={arenaSeatStyle(s, arena.seatWidth)}>
              <Seat
                person={p}
                onClick={onSeatClick}
                labelAbove={s.labelAbove}
                look={s.look}
                paint={p.me ? paint : null}
              />
            </li>
          );
        })}
      </ul>
    </TableArena>
  );
}

/** Подпись участника для скринридера: имя и всё состояние одной фразой. */
export function personLabel(p: MockPerson): string {
  const parts = [p.name];
  if (p.me) parts.push("это вы");
  if (p.host) parts.push("хост");
  if (p.speaking) parts.push("говорит");
  if (p.status === "muted") parts.push("микрофон выключен");
  if (p.status === "deafened") parts.push("звук выключен");
  if (p.status === "forceMuted") parts.push("заглушён хостом");
  if (p.status === "ptt") parts.push("в режиме рации");
  if (p.streaming) parts.push("показывает экран");
  if (p.quality === "poor") parts.push(`слабая связь, ${p.ping} мс`);
  return parts.join(", ");
}

function PersonName({ p, className }: { p: MockPerson; className?: string }) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1 font-medium text-ink", className)}>
      {p.host && (
        <>
          <Icon name="crown" size={14} className="shrink-0 text-crown" />
          <span className="sr-only">хост,</span>
        </>
      )}
      <span className="truncate">{p.name}</span>
      {p.me && <span className="shrink-0 font-normal text-ink-3">· вы</span>}
    </span>
  );
}

/**
 * Место участника: Румик во весь рост. «Говорит» — обводка по силуэту, свечение
 * и значок с полосками у головы; мьют — значок у руки и перечёркнутое кольцо в
 * глазах; подпись одной строкой — корона, ник, «· вы», «Экран», связь.
 */
export function Seat({
  person: p,
  onClick,
  labelAbove = false,
  look,
  paint,
}: {
  person: MockPerson;
  onClick?: (p: MockPerson, el: HTMLElement) => void;
  /** Имя над головой — для дальних мест стола. */
  labelAbove?: boolean;
  look?: readonly [number, number];
  /** Рисунок Румика (PNG). */
  paint?: string | null;
}) {
  const muted = p.status === "muted" || p.status === "forceMuted";
  const body = (
    <>
      <Rumik
        colors={paint ? "white" : p.colorIndex}
        paint={paint ?? undefined}
        glow={p.speaking}
        eyes={muted ? "muted" : "normal"}
        look={look}
      />
      {p.speaking && <SpeakingBadge />}
      <SeatStatusBadge status={p.status ?? null} />
      <SeatLabel above={labelAbove} speaking={p.speaking}>
        <PersonName p={p} className="min-w-0" />
        {p.streaming && (
          <Badge tone="signal" size="sm" icon="monitor" caps>
            <span className="hidden @[760px]/arena:inline">Экран</span>
          </Badge>
        )}
        {p.quality === "poor" && <SignalBars quality="poor" label="" className="shrink-0" />}
      </SeatLabel>
    </>
  );
  const cls = cn(SEAT_FRAME_CLASS, "group rounded-card transition-colors duration-140");
  const content = <span aria-hidden="true" className="contents">{body}</span>;
  if (p.me || !onClick) {
    return (
      <div
        role="group"
        aria-label={personLabel(p)}
        data-testid="participant"
        data-identity={p.id}
        data-speaking={!!p.speaking}
        className={cls}
      >
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-label={personLabel(p)}
      data-testid="participant"
      data-identity={p.id}
      data-speaking={!!p.speaking}
      aria-haspopup="dialog"
      onClick={(e) => onClick?.(p, e.currentTarget)}
      className={cn(cls, "hover:bg-wash-1")}
    >
      {content}
    </button>
  );
}

/**
 * Низкое широкое окно (зона ниже 540px): стол не помещается — все в ряд, как
 * на диване. Румики во весь рост, подписи под ногами.
 */
export function SeatRow({
  people,
  onSeatClick,
}: {
  people: MockPerson[];
  onSeatClick?: (p: MockPerson, el: HTMLElement) => void;
}) {
  return (
    <ul className="flex flex-wrap items-start justify-center gap-x-4 gap-y-8">
      {people.map((p) => (
        <li key={p.id} className="w-28 pb-6">
          <Seat person={p} onClick={onSeatClick} />
        </li>
      ))}
    </ul>
  );
}

/** Центр стола в обычном состоянии: код комнаты — его часто диктуют голосом. */
export function TableCenter() {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-label text-ink-3">код комнаты</span>
      <Tooltip content="Скопировать ссылку с кодом">
        <button
          type="button"
          className="group flex items-center gap-2 rounded-control py-1 pl-3 pr-2 transition-colors duration-140 hover:bg-wash-2"
        >
          <span className="font-brand text-[20px] font-semibold tracking-[0.16em] text-ink">{ROOM.code}</span>
          <Icon name="copy" size={16} className="text-ink-3 transition-colors duration-140 group-hover:text-ink" />
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * Центр стола, когда в комнате только вы. Румика в центре нет: вы сами уже
 * стоите у стола Румиком. В невысоком центре пояснение прячется (как в RoomCenter).
 */
export function AloneCenter() {
  return (
    <EmptyState
      size="sm"
      title="Пока тут только вы"
      description={
        <span className="[@container_center_(max-height:119px)]:hidden">
          Отправьте ссылку друзьям, они зайдут без регистрации.
        </span>
      }
      actions={
        // Как в комнате: главная кнопка экрана — «Пригласить» в шапке.
        <Button variant="secondary" size="sm" icon="link">
          Скопировать ссылку
        </Button>
      }
    />
  );
}

/* --------------------------------------------- Компактный список (узко) */

export function ParticipantList({
  people,
  onRowClick,
}: {
  people: MockPerson[];
  onRowClick?: (p: MockPerson, el: HTMLElement) => void;
}) {
  const paint = useMyPaint();
  return (
    <ul className="flex flex-col gap-0.5 px-2 py-2">
      {people.map((p) => {
        const body = (
          <>
            <RumikAvatar
              name={p.name}
              colorIndex={p.colorIndex}
              paint={p.me ? paint : null}
              size="sm"
              speaking={p.speaking}
              status={p.status}
            />
            <PersonName p={p} className="flex-1 text-body font-medium text-ink" />
            {p.streaming && (
              <Badge tone="signal" size="sm" icon="monitor" caps>
                Экран
              </Badge>
            )}
            {p.quality === "poor" && <SignalBars quality="poor" />}
          </>
        );
        const cls = "flex h-12 w-full items-center gap-3 rounded-card px-2 text-left";
        return (
          <li key={p.id}>
            {p.me || !onRowClick ? (
              <div
                role="group"
                aria-label={personLabel(p)}
                data-testid="participant"
                data-identity={p.id}
                data-speaking={!!p.speaking}
                className={cls}
              >
                <span aria-hidden="true" className="contents">
                  {body}
                </span>
              </div>
            ) : (
              <button
                type="button"
                aria-label={personLabel(p)}
                data-testid="participant"
                data-identity={p.id}
                data-speaking={!!p.speaking}
                aria-haspopup="dialog"
                onClick={(e) => onRowClick(p, e.currentTarget)}
                className={cn(cls, "transition-colors duration-140 hover:bg-wash-1")}
              >
                <span aria-hidden="true" className="contents">
                  {body}
                </span>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------------------------- Док */

export type MicState = "on" | "off" | "ptt-idle" | "ptt-talk" | "forced";

export type DockProps = {
  mic: MicState;
  speaking?: boolean;
  deafened?: boolean;
  sharing?: boolean;
  chatOpen?: boolean;
  unread?: number;
  showKeys?: boolean;
  onToggleChat?: () => void;
  onOpenSettings?: () => void;
  /** false — без плавающего позиционирования (для витрины). */
  floating?: boolean;
};

// label — постоянное имя кнопки (+ aria-pressed), hint — что произойдёт по клику.
const MIC_UI: Record<MicState, { icon: "mic" | "mic-off" | "radio"; variant: "soft" | "danger" | "signal"; hint: string }> = {
  on: { icon: "mic", variant: "soft", hint: "Выключить микрофон" },
  off: { icon: "mic-off", variant: "danger", hint: "Включить микрофон" },
  "ptt-idle": { icon: "radio", variant: "soft", hint: "Рация: удерживайте, чтобы говорить" },
  "ptt-talk": { icon: "radio", variant: "signal", hint: "Рация: вы в эфире" },
  forced: { icon: "mic-off", variant: "danger", hint: "Хост выключил ваш микрофон" },
};

function DeviceMenu({ kind }: { kind: "input" | "output" }) {
  const devices =
    kind === "input"
      ? ["Микрофон (HyperX Cloud II)", "Realtek High Definition Audio", "Камера Logitech C920"]
      : ["Наушники (HyperX Cloud II)", "Динамики (Realtek)", "LG ULTRAGEAR (HDMI)"];
  return (
    <Menu
      label={kind === "input" ? "Выбор микрофона" : "Выбор вывода звука"}
      side="top"
      align="start"
      className="w-72"
      trigger={
        <IconButton
          icon="chevron-up"
          label={kind === "input" ? "Выбрать микрофон" : "Выбрать наушники"}
          size="split"
          variant="quiet"
          className="max-sm:hidden"
          tooltip={false}
        />
      }
    >
      <MenuLabel>{kind === "input" ? "Микрофон" : "Вывод звука"}</MenuLabel>
      {devices.map((d, i) => (
        <MenuItem key={d} checked={i === 0}>
          {d}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem icon="settings">Настройки звука</MenuItem>
    </Menu>
  );
}

const MOCK_SOUNDS = ["Ба-дум-тсс", "Та-дам", "Грустный тромбон", "Вайн бум", "Сверчки", "Аплодисменты", "Бонк", "Оу май"];

/**
 * «Реакции» в доке — как ReactionButton комнаты: поповер над кнопкой с 👍 🔥 😂 GG
 * в виде значков набора (не эмодзи ОС): стрелки, Home/End; после выбора поповер
 * не закрывается — очередь жмут подряд. В макете реакция никуда не уходит.
 */
function ReactionsButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const reactions: ToolbarItem[] = REACTION_KINDS.map((kind) => ({
    key: kind,
    glyph: REACTION_VIEW[kind].glyph,
    label: REACTION_VIEW[kind].label,
    onClick: () => {},
  }));
  return (
    <>
      <IconButton
        ref={ref}
        data-testid="dock-reactions"
        icon="smile-plus"
        label="Реакции"
        hint={open ? "Закрыть реакции" : "Реакции"}
        variant={open ? "inverse" : "soft"}
        size="lg"
        shape="round"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      <Popover open={open} onOpenChange={setOpen} anchor={ref} triggerRef={ref} side="top" align="center" aria-label="Реакции">
        <GlyphToolbar label="Отправить реакцию" items={reactions} testid="reaction" />
      </Popover>
    </>
  );
}

/**
 * «Звуки» в доке — как SoundButton комнаты: панель с подписанными кнопками (имя,
 * а не картинка), «Добавить свой звук» и «Слышать звуки других». В макете звук
 * никуда не уходит.
 */
function SoundsButton() {
  const [open, setOpen] = useState(false);
  const [others, setOthers] = useState(true);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton
        ref={ref}
        data-testid="dock-sounds"
        icon="music"
        label="Звуки"
        hint={open ? "Закрыть звуки" : "Звуки для всех"}
        variant={open ? "inverse" : "soft"}
        size="lg"
        shape="round"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      <Popover open={open} onOpenChange={setOpen} anchor={ref} triggerRef={ref} side="top" align="center" aria-label="Звуки для всех">
        <div className="flex w-[min(340px,calc(100vw-24px))] flex-col gap-3 p-1">
          <ul className="grid grid-cols-2 gap-1.5" aria-label="Звуки">
            {MOCK_SOUNDS.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  className="flex h-10 w-full items-center gap-2 rounded-control border border-line bg-wash-1 px-2.5 text-left text-label text-ink transition-colors duration-140 hover:bg-wash-2"
                >
                  <Icon name="music" size={14} className="shrink-0 text-ink-3" />
                  <span className="truncate">{name}</span>
                </button>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="secondary" icon="plus" className="self-start">
            Добавить свой звук
          </Button>
          <p className="-mt-1 text-caption text-ink-3">mp3, ogg или wav, до 8 секунд. Звук увидят все в комнате, пока она открыта.</p>
          <div className="flex items-center justify-between gap-3 border-t border-line pt-2.5">
            <span className="text-caption text-ink-2">Слышать звуки других</span>
            <Switch size="sm" checked={others} onCheckedChange={setOthers} aria-label="Слышать звуки других" />
          </div>
        </div>
      </Popover>
    </>
  );
}

/**
 * Нижний док. Плавает по центру зоны комнаты (не всего окна — справа может
 * быть чат); на узком экране — полоса во всю ширину. Состояния:
 * мьют/звук выкл — красная заливка, «передаёт» — signal, «включено и это
 * норма» (показ экрана, открытый чат) — инверсия.
 */
export function Dock({
  mic,
  speaking = false,
  deafened = false,
  sharing = false,
  chatOpen = false,
  unread = 0,
  showKeys = false,
  onToggleChat,
  onOpenSettings,
  floating = true,
}: DockProps) {
  const m = MIC_UI[mic];
  const ptt = mic === "ptt-idle" || mic === "ptt-talk";
  return (
    <div
      role="group"
      aria-label="Управление"
      className={cn(
        "flex items-center gap-1.5 bg-raised p-1.5",
        floating
          ? cn(
              // Центр зоны комнаты: на широком экране без открытого чата
              // (ширину чата корень отдаёт через --chat-w).
              "sm:absolute sm:bottom-5 sm:left-1/2 sm:z-[var(--gr-z-dock)] sm:-translate-x-1/2 sm:rounded-full sm:border sm:border-line sm:shadow-float",
              "lg:left-[calc((100%-var(--chat-w,0px))/2)]",
              "max-sm:justify-around max-sm:border-t max-sm:border-line max-sm:px-2 max-sm:pb-[max(6px,env(safe-area-inset-bottom))]",
              "max-sm:[&_button]:size-11 max-[380px]:[&_button]:size-10",
            )
          : "w-fit rounded-full border border-line shadow-raised",
      )}
    >
      <div className="flex items-center rounded-full sm:bg-wash-1 sm:pl-1">
        <DeviceMenu kind="input" />
        <IconButton
          data-testid="dock-mic"
          icon={m.icon}
          label={ptt ? "Микрофон (рация)" : "Микрофон"}
          hint={m.hint}
          shortcut={ptt ? "V" : "M"}
          showShortcut={showKeys || ptt}
          variant={m.variant}
          size="lg"
          shape="round"
          pressed={mic === "on" || mic === "ptt-talk"}
          disabled={mic === "forced"}
          className={cn(speaking && mic === "on" && "shadow-[0_0_0_2px_var(--gr-raised),0_0_0_4px_var(--gr-signal)]")}
        />
      </div>
      <div className="flex items-center rounded-full sm:bg-wash-1 sm:pl-1">
        <DeviceMenu kind="output" />
        <IconButton
          data-testid="dock-deafen"
          icon={deafened ? "headphones-off" : "headphones"}
          label="Звук выключен"
          hint={deafened ? "Включить звук" : "Выключить звук"}
          shortcut="D"
          showShortcut={showKeys}
          variant={deafened ? "danger" : "soft"}
          size="lg"
          shape="round"
          pressed={deafened}
        />
      </div>
      <span aria-hidden="true" className="mx-1 h-7 w-px bg-line max-sm:hidden" />
      <IconButton
        data-testid="dock-screen"
        icon={sharing ? "screen-stop" : "screen-share"}
        label="Показ экрана"
        hint={sharing ? "Остановить показ" : "Показать экран"}
        shortcut="S"
        showShortcut={showKeys}
        variant={sharing ? "inverse" : "soft"}
        size="lg"
        shape="round"
        pressed={sharing}
      />
      <IconButton
        data-testid="dock-chat"
        icon="chat"
        label={unread > 0 && !chatOpen ? `Чат, непрочитанных: ${unread}` : "Чат"}
        hint={chatOpen ? "Закрыть чат" : "Открыть чат"}
        shortcut="Enter"
        variant={chatOpen ? "inverse" : "soft"}
        size="lg"
        shape="round"
        pressed={chatOpen}
        onClick={onToggleChat}
        badge={!chatOpen && unread > 0 ? <CountBadge count={unread} /> : undefined}
      />
      <ReactionsButton />
      <SoundsButton />
      <span aria-hidden="true" className="mx-1 h-7 w-px bg-line max-sm:hidden" />
      <IconButton
        data-testid="dock-settings"
        icon="settings"
        label="Настройки"
        variant="ghost"
        size="lg"
        shape="round"
        onClick={onOpenSettings}
      />
      <IconButton data-testid="dock-leave" icon="leave" label="Выйти из комнаты" variant="danger-ghost" size="lg" shape="round" />
    </div>
  );
}

/* ---------------------------------------------------------------- Чат */

function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** Панель чата. Сообщения подряд от одного автора — одной группой. */
export function ChatPanel({ onClose }: { onClose?: () => void }) {
  const paint = useMyPaint();
  const groups: { who: string; time: string; items: (typeof CHAT)[number][] }[] = [];
  for (const m of CHAT) {
    const last = groups[groups.length - 1];
    if (last && last.who === m.who) last.items.push(m);
    else groups.push({ who: m.who, time: m.time, items: [m] });
  }
  return (
    <aside
      aria-label="Чат комнаты"
      className={cn(
        "flex flex-col bg-raised",
        // ≥1024 — колонка справа; 640–1023 — панель поверх комнаты; <640 —
        // секция под списком участников (узкое окно сбоку от игры).
        "lg:w-[360px] lg:shrink-0 lg:border-l lg:border-line",
        "sm:max-lg:absolute sm:max-lg:inset-y-0 sm:max-lg:right-0 sm:max-lg:z-[var(--gr-z-drawer)] sm:max-lg:w-[min(400px,100%)] sm:max-lg:border-l sm:max-lg:border-line sm:max-lg:shadow-dialog",
        "max-sm:min-h-0 max-sm:flex-1 max-sm:border-t max-sm:border-line",
      )}
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line pl-4 pr-2">
        <h2 className="text-title text-ink">Чат</h2>
        <IconButton icon="x" label="Закрыть чат" shortcut="Esc" size="sm" onClick={onClose} />
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <p className="mx-auto rounded-full bg-wash-1 px-3 py-1 text-caption text-ink-3">
          Видно сообщения с момента, как вы зашли
        </p>
        {groups.map((g, gi) => {
          const p = personByName(g.who);
          return (
            <div key={gi}>
              {gi === 5 && (
                <div className="mb-4 flex items-center gap-3 text-caption font-medium text-alert-ink">
                  <span className="h-px flex-1 bg-alert-ink/35" />
                  Новые
                  <span className="h-px flex-1 bg-alert-ink/35" />
                </div>
              )}
              <div className="flex gap-3" data-testid="chat-message">
                {/* Голова — как место за столом: свои сообщения с вашим рисунком. */}
                <RumikAvatar
                  name={g.who}
                  colorIndex={p?.colorIndex}
                  paint={p?.me ? paint : null}
                  size="sm"
                  surface="raised"
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-body font-semibold" style={{ color: `var(--gr-avatar-${p?.colorIndex ?? 0})` }}>
                      {g.who}
                    </span>
                    <time className="text-caption tabular-nums text-ink-3">{g.time}</time>
                  </div>
                  {g.items.map((m) => (
                    <p
                      key={m.id}
                      className={cn("mt-0.5 text-body-lg [overflow-wrap:anywhere]", m.failed ? "text-ink-3" : "text-ink")}
                    >
                      <Linkified text={m.text} />
                      {m.failed && (
                        <span className="mt-1 flex items-center gap-1.5 text-caption text-alert-ink">
                          <Icon name="alert-circle" size={14} />
                          Не отправлено ·
                          <button type="button" className="font-medium underline underline-offset-2 hover:text-ink">
                            Повторить
                          </button>
                        </span>
                      )}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <form className="shrink-0 border-t border-line p-3" onSubmit={(e) => e.preventDefault()}>
        <div className="flex items-end gap-2 rounded-card border border-line-strong bg-sunken p-1.5 pl-3 focus-within:border-focus">
          <textarea
            data-testid="chat-input"
            rows={1}
            maxLength={500}
            placeholder="Написать всем в комнате"
            aria-label="Сообщение"
            className="max-h-32 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-body-lg text-ink outline-0 focus-visible:outline-0"
          />
          <IconButton data-testid="chat-send" icon="send" label="Отправить" shortcut="Enter" variant="soft" size="sm" type="submit" />
        </div>
      </form>
    </aside>
  );
}

/* ------------------------------------------------- Сцена (показ экрана) */

/** Картинка «чужого экрана» для макета: закат над горами, яркие и тёмные места. */
export function FakeScreen({ className }: { className?: string }) {
  return (
    <div className={cn("isolate overflow-hidden bg-[#1b2a4a]", className)} aria-hidden="true">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#1d2b53_0%,#7b4b8a_38%,#f08a5d_62%,#ffd27a_74%)]" />
      <div className="absolute left-[62%] top-[44%] aspect-square w-[9%] rounded-full bg-[#fff1c1] opacity-90" />
      <div className="absolute inset-x-0 bottom-0 h-[46%] bg-[#3a2a52] [clip-path:polygon(0_55%,12%_30%,24%_48%,38%_12%,52%_44%,64%_22%,78%_50%,90%_28%,100%_46%,100%_100%,0_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-[30%] bg-[#1f1a33] [clip-path:polygon(0_40%,18%_20%,30%_44%,46%_16%,60%_40%,74%_24%,88%_48%,100%_30%,100%_100%,0_100%)]" />
    </div>
  );
}

export function Stage({
  twoStreams = false,
  zoomed = false,
  controlsShown = true,
  statsOpen = false,
}: {
  twoStreams?: boolean;
  zoomed?: boolean;
  controlsShown?: boolean;
  statsOpen?: boolean;
}) {
  const [stream, setStream] = useState<"tema" | "nika">("tema");
  const [volume, setVolume] = useState(80);
  const [stats, setStats] = useState(statsOpen);
  const infoRef = useRef<HTMLButtonElement>(null);
  const shown = controlsShown ? "opacity-100" : "opacity-0 group-hover/stage:opacity-100 group-focus-within/stage:opacity-100";
  return (
    <section
      data-testid="screen-stage"
      aria-label="Показ экрана: Тёма"
      className="group/stage relative grid min-h-0 flex-1 place-items-center overflow-hidden rounded-panel bg-video [container-type:size] max-sm:aspect-video max-sm:flex-none max-sm:rounded-card"
    >
      {/* Как object-fit: contain — вписываем 16:9 в сцену по меньшей стороне. */}
      <FakeScreen className="relative aspect-video w-[min(100cqw,calc(100cqh*16/9))]" />

      {/* Верх: кто показывает, выбор показа, зум */}
      <div className={cn("absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3 transition-opacity duration-180", shown)}>
        <div className="flex items-center gap-2">
          <Badge tone="signal" variant="solid" size="sm" caps>
            Эфир
          </Badge>
          {twoStreams ? (
            <div role="radiogroup" aria-label="Чей показ смотреть" className="flex rounded-full bg-[rgb(0_0_0/0.55)] p-0.5">
              {(["tema", "nika"] as const).map((id) => {
                const p = PEOPLE.find((x) => x.id === id)!;
                const on = stream === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setStream(id)}
                    className={cn(
                      "flex h-7 items-center gap-1.5 rounded-full pl-0.5 pr-2.5 text-label font-medium transition-colors",
                      on ? "bg-white text-[#0d0e11]" : "text-white/80 hover:text-white",
                    )}
                  >
                    <RumikAvatar name={p.name} colorIndex={p.colorIndex} size="xs" />
                    {p.name}
                  </button>
                );
              })}
            </div>
          ) : (
            <span className="flex h-7 items-center gap-1.5 rounded-full bg-[rgb(0_0_0/0.55)] pl-0.5 pr-3 text-label font-medium text-white">
              <RumikAvatar name="Тёма" colorIndex={PEOPLE[0].colorIndex} size="xs" />
              Тёма
            </span>
          )}
        </div>
        {zoomed && (
          <div className="flex items-center gap-1 rounded-full bg-[rgb(0_0_0/0.55)] py-0.5 pl-3 pr-0.5 text-label font-medium tabular-nums text-white">
            ×2,0
            <button type="button" className="h-7 rounded-full px-2.5 text-white/80 hover:bg-white/15 hover:text-white">
              Сбросить
            </button>
          </div>
        )}
      </div>

      {/* Низ: громкость показа и управление просмотром */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 flex items-end justify-end gap-2 bg-[linear-gradient(to_top,rgb(0_0_0/0.62),transparent)] p-3 pt-10 transition-opacity duration-180",
          shown,
        )}
      >
        <div className="flex h-10 items-center gap-1 rounded-full bg-[rgb(0_0_0/0.55)] pl-1 pr-3 text-white max-sm:pr-1">
          <IconButton icon={volume === 0 ? "volume-off" : "volume"} label="Звук показа" variant="scrim-ghost" size="sm" shape="round" />
          <Slider
            aria-label="Громкость показа"
            value={volume}
            onValueChange={setVolume}
            max={200}
            marks={[100]}
            snap={4}
            showValue={false}
            formatValue={(v) => `${v}%`}
            variant="scrim"
            wrapperClassName="w-24 max-sm:hidden"
          />
        </div>
        <IconButton ref={infoRef} icon="info" label="Качество показа" variant="scrim" shape="round" onClick={() => setStats((v) => !v)} />
        <IconButton icon="eye-off" label="Не смотреть показ" variant="scrim" shape="round" wrapperClassName="max-sm:hidden" />
        <IconButton icon="pip" label="Картинка в картинке" variant="scrim" shape="round" />
        <IconButton icon="maximize" label="Во весь экран" shortcut="F" variant="scrim" shape="round" />
      </div>
      <Popover
        open={stats}
        onOpenChange={setStats}
        anchor={infoRef}
        side="top"
        align="end"
        aria-label="Качество показа"
        focus="container"
        className="w-64 p-3"
      >
        <StreamStats />
      </Popover>
    </section>
  );
}

export function StreamStats() {
  const rows: [string, string][] = [
    ["Разрешение", "1920×1080"],
    ["Кадров", "60 к/с"],
    ["Поток", "6,1 Мбит/с"],
    ["Кодек", "H.264 · аппаратно"],
    ["Потери", "0,2%"],
  ];
  return (
    <div>
      <p className="mb-2 text-label font-semibold text-ink">Что приходит к вам</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-label">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-3">{k}</dt>
            <dd className="text-right font-code tabular-nums text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Лента участников под сценой. */
export function ParticipantRibbon({ people }: { people: MockPerson[] }) {
  const paint = useMyPaint();
  return (
    <ul className="flex flex-wrap items-center justify-center gap-2">
      {people.map((p) => (
        <li
          key={p.id}
          data-testid="participant"
          data-identity={p.id}
          data-speaking={!!p.speaking}
          className="flex h-11 items-center gap-2 rounded-full border border-line bg-raised py-1 pl-1 pr-3.5"
        >
          <RumikAvatar
            name={p.name}
            colorIndex={p.colorIndex}
            paint={p.me ? paint : null}
            size="sm"
            speaking={p.speaking}
            status={p.status}
            surface="raised"
          />
          <PersonName p={p} className="max-w-32 text-label font-medium text-ink" />
        </li>
      ))}
    </ul>
  );
}

/** Центр стола, когда вы показываете экран: своё превью скрыто (бережём видеокарту). */
export function SelfShareCenter() {
  return (
    <div className="flex flex-col items-center gap-2.5">
      {/* Как в RoomCenter: в невысоком центре стола значок и пояснение прячутся. */}
      <span className="grid size-10 place-items-center rounded-full bg-signal text-on-signal [@container_center_(max-height:149px)]:hidden">
        <Icon name="screen-share" size={20} />
      </span>
      <div>
        <p className="text-title text-ink">Вы показываете экран</p>
        <p className="mt-0.5 text-label text-ink-2 [@container_center_(max-height:119px)]:hidden">
          Друзья видят 1080p, 60 к/с
        </p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" icon="eye">
          Превью
        </Button>
        <Button size="sm" variant="danger" icon="screen-stop">
          Стоп
        </Button>
      </div>
    </div>
  );
}

/** Свой показ экрана в узком окне: плашка над списком. */
export function SelfShareCard() {
  return (
    <div className="flex w-full max-w-xl flex-wrap items-center gap-4 rounded-card border border-signal/30 bg-signal-wash p-4">
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-signal text-on-signal">
        <Icon name="screen-share" size={22} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-title text-ink">Вы показываете экран</p>
        <p className="mt-0.5 text-label text-ink-2">Друзья видят его в 1080p, 60 к/с. Своё превью скрыто, чтобы не нагружать видеокарту.</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" icon="eye">
          Превью
        </Button>
        <Button size="sm" variant="danger" icon="screen-stop">
          Остановить
        </Button>
      </div>
    </div>
  );
}

/* ----------------------------------------- Панель участника (по клику) */

export function ParticipantPanel({
  person: p,
  host,
  view = "actions",
  onView,
}: {
  person: MockPerson;
  host: boolean;
  view?: "actions" | "kick" | "ban";
  onView?: (v: "actions" | "kick" | "ban") => void;
}) {
  const [volume, setVolume] = useState(120);
  const [mutedForMe, setMutedForMe] = useState(false);
  if (view === "kick" || view === "ban") {
    return (
      <MenuConfirm
        // Ник не склоняем («Выгнать Ника?»): имя — в подлежащем, в описании.
        title={view === "kick" ? "Выгнать из комнаты?" : "Забанить в этой комнате?"}
        description={
          view === "kick"
            ? `${p.name} сможет вернуться через 5 минут.`
            : `${p.name} не сможет зайти, пока комната открыта. Снять бан можно в настройках комнаты.`
        }
        confirmLabel={view === "kick" ? "Выгнать" : "Забанить"}
        onConfirm={() => onView?.("actions")}
        onCancel={() => onView?.("actions")}
      />
    );
  }
  return (
    <div className="flex w-72 flex-col">
      <div className="flex items-center gap-3 px-2.5 pb-3 pt-2">
        <RumikAvatar name={p.name} colorIndex={p.colorIndex} size="md" status={p.status} surface="overlay" />
        <div className="min-w-0">
          <p className="truncate text-title text-ink">{p.name}</p>
          <p className="flex items-center gap-1.5 text-label text-ink-3">
            <SignalBars quality={p.quality} />
            {p.ping} мс{p.status === "muted" ? " · микрофон выключен" : ""}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-1 border-t border-line px-2.5 py-3">
        <Slider
          label="Громкость для вас"
          value={mutedForMe ? 0 : volume}
          onValueChange={setVolume}
          max={200}
          marks={[100]}
          snap={4}
          formatValue={(v) => `${v}%`}
          disabled={mutedForMe}
        />
        <div className="mt-1 flex items-center justify-between gap-3">
          <label htmlFor="mute-for-me" className="cursor-pointer text-body text-ink">
            Заглушить для себя
          </label>
          <Switch id="mute-for-me" size="sm" checked={mutedForMe} onCheckedChange={setMutedForMe} />
        </div>
      </div>
      {host && (
        <div className="flex flex-col border-t border-line pt-1.5">
          <MenuLabel>Вы хост</MenuLabel>
          <PopoverItem icon="crown">Сделать хостом</PopoverItem>
          <PopoverItem icon="mic-off">Выключить микрофон</PopoverItem>
          <PopoverItem icon="chat-off">Запретить чат</PopoverItem>
          <PopoverItem icon="screen-stop">Запретить показ экрана</PopoverItem>
          <div className="-mx-1.5 my-1.5 h-px bg-line" />
          <PopoverItem icon="user-x" tone="danger" onClick={() => onView?.("kick")}>
            Выгнать…
          </PopoverItem>
          <PopoverItem icon="ban" tone="danger" onClick={() => onView?.("ban")}>
            Забанить…
          </PopoverItem>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------- Баннер переподключения */

export function ReconnectBanner() {
  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-center gap-2.5 border-b border-caution/25 bg-caution-wash px-4 py-2 text-body text-ink"
    >
      <span className="size-2 rounded-full bg-caution" aria-hidden="true" />
      Связь прервалась. Переподключаемся…
      <span className="text-ink-3 max-sm:hidden">Вас пока не слышно</span>
    </div>
  );
}
