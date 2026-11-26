"use client";

import { useId, useRef, useState } from "react";
import { Button, Icon, IconButton, Popover, Switch, TextField, cn, toast } from "@/components/ui";
import { SOUND_FILE_MAX_BYTES, SOUND_FILE_MAX_SEC, SOUND_MAX_PER_ROOM, SOUND_NAME_MAX } from "@/lib/api/contract";
import { getPlaybackContext } from "@/lib/audio/playback";
import { playBoardSound, setBoardEnabled } from "@/lib/audio/soundboard";
import { getBoardEnabled } from "@/lib/clientStorage";
import { ApiError, networkError } from "@/lib/client/errors";
import { removeRoomSound, uploadRoomSound } from "@/lib/client/api";
import { useRoomSession } from "../state/RoomSession";
import { useRoomConfig } from "../state/useRoomConfig";
import { useRoomMeta } from "../state/useRoomMeta";
import { refreshRoomSounds, useSoundCatalog, type CatalogSound } from "./catalog";
import { useSendSound } from "./useSendSound";

/**
 * Кнопка «Звуки» в доке (флаг soundboard): панель со всеми звуками комнаты —
 * готовый набор и свои, добавленные людьми (флаг soundboard_upload). Звуки — это
 * подписанные кнопки, а не значки: «Ба-дум-тсс» понятнее картинки. Нажали — звук
 * играет у вас сразу и уходит всем. Панель после нажатия не закрывается: звук
 * жмут подряд. Внизу — «Слышать звуки других» и «Добавить звук».
 */
export default function SoundButton() {
  const { flags } = useRoomConfig();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  if (!flags.soundboard) return null;
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
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchor={ref}
        triggerRef={ref}
        side="top"
        align="center"
        aria-label="Звуки для всех"
        data-testid="sounds-popover"
      >
        <SoundPanel canUpload={flags.soundboard_upload} />
      </Popover>
    </>
  );
}

/** Файл → base64 без префикса data:. */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Название по имени файла: без расширения и подчёркиваний, не длиннее SOUND_NAME_MAX. */
export function nameFromFile(fileName: string): string {
  const base = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...base].slice(0, SOUND_NAME_MAX).join("").trim();
}

function SoundPanel({ canUpload }: { canUpload: boolean }) {
  const sounds = useSoundCatalog();
  const send = useSendSound();
  const { code, token, identity } = useRoomSession();
  const { amHost } = useRoomMeta();
  const [others, setOthers] = useState(getBoardEnabled);
  const [pending, setPending] = useState<{ file: File; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const switchId = useId();
  const roomCount = sounds.filter((s) => s.source === "room").length;

  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > SOUND_FILE_MAX_BYTES) {
      toast({
        id: "sound-add",
        tone: "caution",
        title: "Файл слишком большой",
        description: `До ${SOUND_FILE_MAX_BYTES / 1024} КБ — это около ${SOUND_FILE_MAX_SEC} секунд в mp3. Обрежьте звук.`,
        immediate: true,
      });
      return;
    }
    // Длину проверяем сами: сервер звук не декодирует. Заодно ловим «не аудио».
    const ctx = getPlaybackContext();
    try {
      const buf = await ctx?.decodeAudioData(await file.arrayBuffer());
      if (buf && buf.duration > SOUND_FILE_MAX_SEC + 0.2) {
        toast({
          id: "sound-add",
          tone: "caution",
          title: `Звук длиннее ${SOUND_FILE_MAX_SEC} секунд`,
          description: "Обрежьте его до самого смешного места.",
          immediate: true,
        });
        return;
      }
    } catch {
      toast({
        id: "sound-add",
        tone: "caution",
        title: "Не получилось прочитать файл",
        description: "Нужен mp3, ogg или wav.",
        immediate: true,
      });
      return;
    }
    setPending({ file, name: nameFromFile(file.name) || "Звук" });
  }

  async function add() {
    if (!pending || !pending.name.trim()) return;
    setBusy(true);
    try {
      await uploadRoomSound(code, token, pending.name, await toBase64(pending.file));
      await refreshRoomSounds(code, token).catch(() => undefined);
      setPending(null);
    } catch (err) {
      const error = err instanceof ApiError ? err : networkError();
      toast({ id: "sound-add", tone: "caution", title: error.message, immediate: true });
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: CatalogSound) {
    try {
      await removeRoomSound(code, token, s.id);
      await refreshRoomSounds(code, token).catch(() => undefined);
    } catch (err) {
      const error = err instanceof ApiError ? err : networkError();
      toast({ id: "sound-remove", icon: "info", title: error.message, immediate: true });
    }
  }

  return (
    <div className="flex w-[min(340px,calc(100vw-24px))] flex-col gap-3 p-1" data-testid="sound-panel">
      <ul className="grid max-h-72 grid-cols-2 gap-1.5 overflow-y-auto pr-0.5" aria-label="Звуки">
        {sounds.map((s) => {
          const removable = s.source === "room" && (s.by === identity || amHost);
          return (
            <li key={s.id} className="relative">
              <button
                type="button"
                data-testid={`sound-${s.id}`}
                onClick={() => send(s.id)}
                className={cn(
                  "flex h-10 w-full items-center gap-2 rounded-control border border-line bg-wash-1 px-2.5 text-left text-label text-ink",
                  "transition-colors duration-140 hover:bg-wash-2 active:bg-wash-3",
                  removable && "pr-8",
                )}
              >
                <Icon name="music" size={14} className="shrink-0 text-ink-3" />
                <span className="truncate">{s.name}</span>
              </button>
              {removable && (
                <button
                  type="button"
                  aria-label={`Убрать звук «${s.name}»`}
                  data-testid={`sound-remove-${s.id}`}
                  onClick={() => void remove(s)}
                  className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-item text-ink-3 hover:bg-wash-2 hover:text-ink"
                >
                  <Icon name="x" size={14} />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {pending ? (
        <div
          className="flex flex-col gap-2 rounded-card border border-line bg-sunken p-2.5"
          data-testid="sound-pending"
        >
          <TextField
            label="Название на кнопке"
            value={pending.name}
            maxLength={SOUND_NAME_MAX}
            onChange={(e) => setPending({ ...pending, name: e.target.value })}
            data-testid="sound-name"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPending(null)} disabled={busy}>
              Отмена
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={busy}
              disabled={!pending.name.trim()}
              onClick={() => void add()}
              data-testid="sound-add-confirm"
            >
              Добавить
            </Button>
          </div>
        </div>
      ) : (
        canUpload && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,.mp3,.ogg,.wav,.m4a"
              hidden
              data-testid="sound-file"
              onChange={(e) => {
                void pick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              icon="plus"
              className="self-start"
              disabled={roomCount >= SOUND_MAX_PER_ROOM}
              onClick={() => fileRef.current?.click()}
              data-testid="sound-add"
            >
              Добавить свой звук
            </Button>
            <p className="-mt-1 text-caption text-ink-3">
              {roomCount >= SOUND_MAX_PER_ROOM
                ? `В комнате уже ${SOUND_MAX_PER_ROOM} своих звуков. Уберите лишний.`
                : `mp3, ogg или wav, до ${SOUND_FILE_MAX_SEC} секунд. Звук увидят все в комнате, пока она открыта.`}
            </p>
          </>
        )
      )}

      <div className="flex items-center justify-between gap-3 border-t border-line pt-2.5">
        <label htmlFor={switchId} className="text-caption text-ink-2">
          Слышать звуки других
        </label>
        <Switch
          id={switchId}
          size="sm"
          checked={others}
          data-testid="sound-others"
          onCheckedChange={(next) => {
            setOthers(next);
            setBoardEnabled(next);
          }}
        />
      </div>
    </div>
  );
}

/** Для пробы в настройках: сыграть звук каталога у себя. */
export function previewSound(id: string): void {
  playBoardSound(id, "preview", { preview: true });
}
