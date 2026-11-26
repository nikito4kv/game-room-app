"use client";

import { useRef, useState } from "react";
import { VideoTrack, type TrackReference } from "@livekit/components-react";
import { Button, EmptyState, Icon, IconButton, Popover, Rumik, Spinner, Tooltip, cn } from "@/components/ui";
import { describeCapture } from "@/lib/screenShare";
import { copyInviteWithToast } from "../header/invite";
import { displayName } from "../participants/useAvatarColors";
import { useRoomSession } from "../state/RoomSession";
import type { RemoteScreen } from "./useScreenShares";
import { useScreenShareControl } from "./useScreenShareControl";

// Состояние комнаты в центре стола (и плашками над рядом или списком, где
// стола нет): переподключение, свой показ, скрытый чужой показ, «пока тут
// только вы», код.
//
// Центр стола под углом — контейнер `center` (TableArena): невысокий, поэтому
// по его высоте лишнее прячется (значок в круге, пояснение), а кнопки остаются
// внутри стола (#544). Вне стола (плашки, круглый стол) контейнера `center` нет
// — там всё видно, как раньше.

/** Спрятать в невысоком центре стола под углом (по высоте контейнера center). */
const SHORT = "[@container_center_(max-height:149px)]:hidden";
const TINY = "[@container_center_(max-height:119px)]:hidden";

// Запасной круглый стол (флаг rumik_table выключен): круг — 48 % от
// min(84cqmin, 600px) зоны, и его центр бывает уже кнопки. Там меряем зону —
// ближайший безымянный контейнер, обёртку стола (#544): ниже 570 px по меньшей
// стороне пояснение прячется, ниже 520 заголовок встаёт в две строки, а вместо
// кнопки с текстом — значок с подсказкой. У плашек над рядом и списком
// контейнера нет — там всё видно.
const ROUND_SHORT = "[@container_(max-width:569px)_or_(max-height:569px)]:hidden";
const ROUND_TINY = "[@container_(max-width:519px)_or_(max-height:519px)]:hidden";
const ROUND_TINY_ONLY = "hidden [@container_(max-width:519px)_or_(max-height:519px)]:inline-flex";
const ROUND_TINY_TITLE =
  "[@container_(max-width:519px)_or_(max-height:519px)]:inline-block [@container_(max-width:519px)_or_(max-height:519px)]:max-w-[6.5em]";

/** Обычный центр стола: код комнаты — его часто диктуют голосом. */
export function CodeCenter() {
  const { code } = useRoomSession();
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-label text-ink-3">код комнаты</span>
      <Tooltip content="Скопировать ссылку с кодом">
        <button
          type="button"
          data-testid="room-code"
          onClick={() => void copyInviteWithToast(code)}
          className="group flex items-center gap-2 rounded-control py-1 pl-3 pr-2 transition-colors duration-140 hover:bg-wash-2"
        >
          <span className="font-brand text-[20px] font-semibold tracking-[0.16em] text-ink">{code}</span>
          <Icon name="copy" size={16} className="text-ink-3 transition-colors duration-140 group-hover:text-ink" />
          <span className="sr-only">: скопировать ссылку-приглашение</span>
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * Связь прервалась. Если друзья и пропали с мест, то не потому, что ушли, —
 * поэтому не «Пока тут только вы» (ревью М6): так человек начал бы звать их
 * заново. Текст подходит и когда места ещё видны (LiveKit чинит связь сам).
 */
export function ReconnectingCenter() {
  return (
    <EmptyState
      size="sm"
      visual={
        <span className={cn("mb-1 grid size-10 place-items-center rounded-full bg-caution-wash text-caution-ink", TINY)}>
          <Spinner size={20} />
        </span>
      }
      title="Переподключаемся…"
      description={<span className={SHORT}>Всё вернётся само, нажимать ничего не нужно.</span>}
    />
  );
}

/**
 * В комнате только вы: позвать друзей. figure — белый Румик машет над текстом
 * (только у круглого стола: цвет в комнате значит человека, а он тут не
 * участник). За столом под углом Румика в центре нет — вы сами уже стоите у
 * стола Румиком. figure={false} — центр стола под углом (лишнее прячется по
 * высоте контейнера center), иначе — круглый стол или плашка (ROUND_*).
 */
export function AloneCenter({ figure = true }: { figure?: boolean }) {
  const { code } = useRoomSession();
  const copy = () => void copyInviteWithToast(code);
  return (
    <EmptyState
      size="sm"
      visual={
        figure ? (
          // Только у большого стола (зона ≥ 670×670, стол ≥ 560 px): в центре стола
          // поменьше, в ряду и списке Румик вылезал бы за круг или толкал места.
          <span className="mb-1 hidden [@container(min-width:670px)_and_(min-height:670px)]:block">
            <Rumik colors="white" pose="wave" size={64} />
          </span>
        ) : undefined
      }
      title={figure ? <span className={ROUND_TINY_TITLE}>Пока тут только вы</span> : "Пока тут только вы"}
      description={
        <span className={figure ? ROUND_SHORT : TINY}>Отправьте ссылку друзьям, они зайдут без регистрации.</span>
      }
      actions={
        <>
          <Button size="sm" variant="secondary" icon="link" onClick={copy} className={figure ? ROUND_TINY : undefined}>
            Скопировать ссылку
          </Button>
          {figure && (
            <span className={ROUND_TINY_ONLY}>
              <IconButton icon="link" label="Скопировать ссылку" variant="soft" size="sm" onClick={copy} />
            </span>
          )}
        </>
      }
    />
  );
}

/**
 * Свой показ. Себя крупно не рисуем: видеокарта во время игры занята, а показ
 * монитора с открытой комнатой даёт «зеркальный коридор» (аудит C-9). Превью —
 * маленькое и только по кнопке.
 */
function useSelfShareText() {
  const { capture } = useScreenShareControl();
  return capture && capture.width > 0
    ? `Друзья видят ${describeCapture(capture.width, capture.height, capture.frameRate)}`
    : "Друзья видят ваш экран";
}

function SelfShareActions({ local }: { local: TrackReference | null }) {
  const { stop, pending } = useScreenShareControl();
  const [preview, setPreview] = useState(false);
  const previewRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {local && (
        <Button
          ref={previewRef}
          size="sm"
          variant="secondary"
          icon="eye"
          aria-expanded={preview}
          onClick={() => setPreview((v) => !v)}
        >
          Превью
        </Button>
      )}
      <Button size="sm" variant="danger" icon="screen-stop" loading={pending} onClick={stop} data-testid="self-share-stop">
        Остановить
      </Button>
      {local && (
        <Popover
          open={preview}
          onOpenChange={setPreview}
          anchor={previewRef}
          triggerRef={previewRef}
          side="top"
          aria-label="Превью вашего показа"
          focus="container"
          className="p-1.5"
        >
          {/* Только пока открыто: своё видео не рисуем зря. */}
          {preview && (
            <VideoTrack
              trackRef={local}
              className="aspect-video w-[min(320px,calc(100vw-40px))] rounded-item bg-video object-contain"
            />
          )}
        </Popover>
      )}
    </div>
  );
}

/** Центр стола, когда вы показываете экран. */
export function SelfShareCenter({ local }: { local: TrackReference | null }) {
  const text = useSelfShareText();
  return (
    <div className="flex flex-col items-center gap-2.5" data-testid="self-share">
      <span className={cn("grid size-10 place-items-center rounded-full bg-signal text-on-signal", SHORT)}>
        <Icon name="screen-share" size={20} />
      </span>
      <div>
        <p className="text-title text-ink">Вы показываете экран</p>
        <p className={cn("mt-0.5 text-label tabular-nums text-ink-2", TINY)}>{text}</p>
      </div>
      <SelfShareActions local={local} />
    </div>
  );
}

/** Свой показ в узком или низком окне: плашка над списком или рядом. */
export function SelfShareCard({ local }: { local: TrackReference | null }) {
  const text = useSelfShareText();
  return (
    <div
      data-testid="self-share"
      className="flex w-full max-w-xl flex-wrap items-center gap-x-4 gap-y-3 rounded-card border border-signal/30 bg-signal-wash p-4"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-signal text-on-signal">
        <Icon name="screen-share" size={22} />
      </span>
      {/* Тексту — не уже 13rem: на узком окне кнопки уходят на свою строку,
          а не сжимают текст в столбик. */}
      <div className="min-w-[min(100%,13rem)] flex-1">
        <p className="text-title text-ink">Вы показываете экран</p>
        <p className="mt-0.5 text-label tabular-nums text-ink-2">
          {text}. Своё превью скрыто, чтобы не нагружать видеокарту.
        </p>
      </div>
      <SelfShareActions local={local} />
    </div>
  );
}

/** Свой показ, пока на сцене чужой: компактно в ленте под сценой. */
export function SelfSharePill() {
  const { stop, pending } = useScreenShareControl();
  return (
    <span
      data-testid="self-share"
      className="flex h-11 items-center gap-2 rounded-full border border-signal/30 bg-signal-wash py-1 pl-1.5 pr-1"
    >
      <span className="grid size-8 place-items-center rounded-full bg-signal text-on-signal">
        <Icon name="screen-share" size={16} />
      </span>
      <span className="text-label font-medium text-ink">Вы показываете экран</span>
      <Button size="sm" variant="danger" loading={pending} onClick={stop}>
        Остановить
      </Button>
    </span>
  );
}

function hiddenText(hidden: readonly RemoteScreen[]): string {
  const newest = hidden[hidden.length - 1];
  const name = displayName(newest.participant);
  return hidden.length > 1 ? `${name} и ещё ${hidden.length - 1} показывают экран` : `${name} показывает экран`;
}

/** Показ скрыт по «Не смотреть»: вернуть его на сцену. */
export function HiddenStreamCenter({ hidden, onWatch }: { hidden: readonly RemoteScreen[]; onWatch: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2.5" data-testid="hidden-stream">
      <span className={cn("grid size-10 place-items-center rounded-full bg-wash-2 text-ink-2", SHORT)}>
        <Icon name="monitor" size={20} />
      </span>
      <p className="text-title text-ink">{hiddenText(hidden)}</p>
      <Button size="sm" variant="secondary" icon="eye" onClick={onWatch}>
        Смотреть
      </Button>
    </div>
  );
}

/** То же плашкой — над рядом или списком. */
export function HiddenStreamCard({ hidden, onWatch }: { hidden: readonly RemoteScreen[]; onWatch: () => void }) {
  return (
    <div
      data-testid="hidden-stream"
      className="flex w-full max-w-xl items-center gap-3 rounded-card border border-line bg-raised p-3"
    >
      <Icon name="monitor" size={20} className="shrink-0 text-ink-2" />
      <p className="min-w-0 flex-1 text-body text-ink">{hiddenText(hidden)}</p>
      <Button size="sm" variant="secondary" icon="eye" onClick={onWatch}>
        Смотреть
      </Button>
    </div>
  );
}
