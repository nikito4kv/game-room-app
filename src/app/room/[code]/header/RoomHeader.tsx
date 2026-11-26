"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRoomContext } from "@livekit/components-react";
import {
  Button,
  Icon,
  IconButton,
  Logo,
  Menu,
  MenuItem,
  MenuSeparator,
  Popover,
  SignalBars,
  Tooltip,
} from "@/components/ui";
import { ClubBadge } from "@/components/platform/ClubBadge";
import { promptInstall, useCanInstall } from "@/lib/client/installPrompt";
import type { Recap } from "@/lib/room/recap";
import { linkHint, linkQuality } from "@/lib/room/ping";
import { useLinkQuality } from "../participants/ParticipantCircle";
import { openReport } from "../report/reportStore";
import { useRoomActions } from "../state/RoomActions";
import { useRoomConfig } from "../state/useRoomConfig";
import { useRoomSession } from "../state/RoomSession";
import { useRoomMeta } from "../state/useRoomMeta";
import {
  canShareInvite,
  copyCodeWithToast,
  copyInviteWithToast,
  copyText,
  inviteLink,
  inviteLinkShort,
  shareInvite,
} from "./invite";
import { InviteShare } from "./InviteShare";
import { GamesDialog } from "../games/GamesDialog";
import { RecapDialog } from "../recap/RecapDialog";
import { StatusDialog } from "../status/StatusDialog";
import { MeetingDialog } from "./MeetingDialog";
import { recapSnapshot } from "../recap/useRecapTracker";
import { useRttMs } from "./useRttMs";

/**
 * Шапка комнаты, 56 px. Слева знак (не ссылка: уходят только через «Выйти») и
 * название-меню, справа связь, мини-комната поверх игры и главная кнопка
 * «Пригласить». На узком окне — без знака, «Пригласить» становится иконкой.
 */
export default function RoomHeader({
  onOpenPip,
  hostItems,
}: {
  /** Открыть мини-комнату поверх игры; нет — браузер не умеет (кнопки нет). */
  onOpenPip?: () => void;
  /** Пункты хоста в меню названия (их даёт host/). */
  hostItems?: ReactNode;
}) {
  return (
    <header className="relative z-[var(--gr-z-sticky)] flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 sm:px-4">
      <Logo variant="mark" height={26} title="" className="hidden shrink-0 text-ink sm:block" />
      <RoomTitleMenu onOpenPip={onOpenPip} hostItems={hostItems} />
      <RoomClubBadge />
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <ConnectionChip />
        {onOpenPip && (
          <IconButton
            icon="pip"
            label="Мини-комната"
            hint="Мини-комната поверх игры"
            variant="ghost"
            tooltipSide="bottom"
            wrapperClassName="max-sm:hidden"
            onClick={onOpenPip}
          />
        )}
        <InviteButton />
      </div>
    </header>
  );
}

function RoomTitleMenu({ onOpenPip, hostItems }: { onOpenPip?: () => void; hostItems?: ReactNode }) {
  const { code } = useRoomSession();
  const { title, locked } = useRoomMeta();
  const { leave } = useRoomActions();
  const { flags } = useRoomConfig();
  const canInstall = useCanInstall();
  const [recap, setRecap] = useState<Recap | null>(null);
  const [games, setGames] = useState(false);
  const [status, setStatus] = useState(false);
  const [meeting, setMeeting] = useState(false);
  return (
    <>
      <Menu
        label="Действия с комнатой"
        trigger={
          <button
            type="button"
            data-testid="room-menu"
            className="flex min-w-0 items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors duration-140 hover:bg-wash-2"
          >
            <span className="truncate font-brand text-[15px] font-semibold tracking-[-0.01em] text-ink sm:text-[17px]">
              {title}
            </span>
            {locked && (
              <>
                <Icon name="lock" size={15} className="shrink-0 text-caution-ink" />
                <span className="sr-only">, вход закрыт</span>
              </>
            )}
            <Icon name="chevron-down" size={16} className="shrink-0 text-ink-3" />
          </button>
        }
      >
        <MenuItem icon="link" onSelect={() => void copyInviteWithToast(code)}>
          Скопировать ссылку
        </MenuItem>
        <MenuItem icon="hash" hint={code} onSelect={() => void copyCodeWithToast(code)}>
          Скопировать код
        </MenuItem>
        {onOpenPip && (
          <MenuItem icon="pip" onSelect={onOpenPip}>
            Мини-комната поверх игры
          </MenuItem>
        )}
        {flags.games && (
          <MenuItem icon="dice" onSelect={() => setGames(true)} data-testid="menu-games">
            Игры
          </MenuItem>
        )}
        {flags.statuses && (
          <MenuItem icon="gamepad" onSelect={() => setStatus(true)} data-testid="menu-status">
            Мой статус
          </MenuItem>
        )}
        {flags.calendar && (
          <MenuItem icon="calendar" onSelect={() => setMeeting(true)} data-testid="menu-meeting">
            Назначить встречу
          </MenuItem>
        )}
        {flags.recap && (
          <MenuItem icon="image" onSelect={() => setRecap(recapSnapshot(code, Date.now()))} data-testid="menu-recap">
            Итоги вечера
          </MenuItem>
        )}
        {flags.pwa && canInstall && (
          <MenuItem icon="download" onSelect={() => void promptInstall()} data-testid="menu-install">
            Установить как приложение
          </MenuItem>
        )}
        {hostItems}
        <MenuSeparator />
        {flags.reports && (
          <MenuItem icon="flag" onSelect={() => openReport(null)} data-testid="menu-report-room">
            Пожаловаться на комнату
          </MenuItem>
        )}
        <MenuItem icon="leave" tone="danger" onSelect={leave}>
          Выйти из комнаты
        </MenuItem>
      </Menu>
      <GamesDialog open={games} onOpenChange={setGames} />
      <StatusDialog open={status} onOpenChange={setStatus} />
      <MeetingDialog open={meeting} onOpenChange={setMeeting} link={inviteLink(code)} title={title} code={code} />
      <RecapDialog open={recap !== null} onOpenChange={(o) => !o && setRecap(null)} recap={recap} />
    </>
  );
}

/** Бейдж клуба рядом с названием, если комнату создали по ключу клуба. */
function RoomClubBadge() {
  const { meta } = useRoomMeta();
  if (!meta?.badge) return null;
  return <ClubBadge badge={meta.badge} className="max-sm:max-w-[7rem]" />;
}

/**
 * Связь с сервером: столбики (серые, пока всё хорошо) и пинг. Качество — худшее
 * из пинга и оценки LiveKit: она видит потери, которых пинг не покажет.
 */
function ConnectionChip() {
  const room = useRoomContext();
  const rtt = useRttMs();
  const quality = linkQuality(rtt, useLinkQuality(room.localParticipant));
  const hint = linkHint(quality, rtt);
  return (
    <Tooltip content={hint} side="bottom">
      <span className="flex h-8 items-center gap-2 rounded-control px-2 text-label tabular-nums text-ink-3">
        <SignalBars quality={quality} label="" />
        <span className="sr-only">{hint}</span>
        {rtt !== null && (
          <span aria-hidden="true" className="max-sm:hidden">
            {rtt} мс
          </span>
        )}
      </span>
    </Tooltip>
  );
}

/**
 * Главная кнопка шапки. Клик сразу копирует ссылку и открывает подтверждение:
 * поле со ссылкой, «Ещё раз» и код крупно — его удобно продиктовать. На
 * телефоне вместо этого — системное меню «Поделиться»: ссылку отправляют
 * прямо в Telegram, а не копируют и вставляют.
 */
function InviteButton() {
  const { code } = useRoomSession();
  const { title } = useRoomMeta();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(true);
  // Якорь — обёртка обеих кнопок: видна всегда одна, её и обводит рамка обёртки.
  const anchorRef = useRef<HTMLSpanElement>(null);
  const copyAndShow = () => {
    void copyText(inviteLink(code)).then(setCopied);
    setOpen(true);
  };
  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    if (canShareInvite()) {
      void shareInvite(code, title).then((r) => {
        if (r === "failed") copyAndShow();
      });
      return;
    }
    copyAndShow();
  };
  return (
    <>
      <span ref={anchorRef} className="inline-flex">
        <Button
          variant="primary"
          icon="user-plus"
          onClick={toggle}
          aria-expanded={open}
          data-testid="invite"
          className="max-sm:hidden"
        >
          Пригласить
        </Button>
        <IconButton
          icon="user-plus"
          label="Пригласить"
          variant="inverse"
          onClick={toggle}
          aria-expanded={open}
          wrapperClassName="sm:hidden"
        />
      </span>
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchor={anchorRef}
        triggerRef={anchorRef}
        side="bottom"
        align="end"
        aria-label="Пригласить друзей"
        className="w-[min(340px,calc(100vw-16px))] p-3.5"
      >
        <InvitePanel
          code={code}
          title={title}
          copied={copied}
          onCopyAgain={() => void copyText(inviteLink(code)).then(setCopied)}
        />
      </Popover>
    </>
  );
}

function InvitePanel({
  code,
  title,
  copied,
  onCopyAgain,
}: {
  code: string;
  title: string;
  copied: boolean;
  onCopyAgain: () => void;
}) {
  const { flags } = useRoomConfig();
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-label text-ink-2">
        <Icon
          name={copied ? "check-circle" : "link"}
          size={16}
          className={copied ? "text-signal-ink" : "text-caution-ink"}
        />
        {copied
          ? "Ссылка скопирована. Отправьте её друзьям: регистрация не нужна."
          : "Скопируйте ссылку и отправьте друзьям."}
      </p>
      <div className="flex items-center gap-2 rounded-control border border-line-strong bg-sunken py-1 pl-3 pr-1">
        <span className="min-w-0 flex-1 select-all truncate text-body text-ink-2">{inviteLinkShort(code)}</span>
        <Button size="sm" variant="secondary" icon="copy" onClick={onCopyAgain}>
          Ещё раз
        </Button>
      </div>
      {flags.invite_share && <InviteShare link={inviteLink(code)} title={title} code={code} />}
      <p className="flex items-baseline justify-between gap-3 text-caption text-ink-3">
        <span>Или продиктуйте код</span>
        <span className="font-brand text-[15px] font-semibold tracking-[0.18em] text-ink">{code}</span>
      </p>
    </div>
  );
}
