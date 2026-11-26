"use client";

import { useEffect, useRef } from "react";
import { useRoomContext } from "@livekit/components-react";
import {
  ParticipantEvent,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type LocalVideoTrack,
  type RemoteParticipant,
} from "livekit-client";
import { parseEnterSoundAttribute, type ScreenPolicy } from "@/lib/api/contract";
import { avatarColorIndex, toast } from "@/components/ui";
import { isSfxEnabled, playSfx } from "@/lib/audio/sfx";
import { playBoardSound } from "@/lib/audio/soundboard";
import { reactionStore } from "../reactions/reactionStore";
import { displayName } from "../participants/useAvatarColors";
import type { ScreenShares } from "../stage/useScreenShares";
import { useRoomActions } from "../state/RoomActions";
import { useHostGrace } from "../state/useHostAutoClaim";
import { useLatestRef } from "../state/useLatestRef";
import { useRoomSession } from "../state/RoomSession";
import { useRoomMeta } from "../state/useRoomMeta";
import { toastPerson } from "./PersonHead";

/** Правила показа экрана словами — для гостей, когда хост их сменил. */
const SCREEN_POLICY_TITLE: Record<ScreenPolicy, string> = {
  all: "Показывать экран теперь могут все",
  host: "Показывать экран теперь может только хост",
  approved: "Показывать экран теперь можно по разрешению хоста",
};

/**
 * Мимолётные события комнаты — тостами (место выбирает useToastTop): вошёл,
 * вышел, начал показ экрана, сменился хост, закрыли или открыли вход, сменились
 * правила показа, компьютер не успевает кодировать свой показ. Ник — в
 * заголовке, событие — в описании, без склонений. Тот же id обновляет тост на
 * месте: вошёл-вышел-вошёл не множит строки.
 *
 * Звуки входа и выхода играют здесь же (у кого выбран свой звук входа —
 * он, из соундборда); звуки прав и замка — в useRoomSounds.
 */
export function useRoomToasts({
  colors,
  screens,
}: {
  /** identity → цвет аватара (useAvatarColors). */
  colors: ReadonlyMap<string, number>;
  /** Показы экрана на сцене: о показе, который уже крупно, тост не нужен. */
  screens: ScreenShares;
}): void {
  const room = useRoomContext();
  const { openSettings } = useRoomActions();
  // Свежие значения для обработчиков, которые не переподписываем на каждый рендер.
  const colorsRef = useLatestRef(colors);
  const openSettingsRef = useLatestRef(openSettings);
  // Первые секунды после входа комната «устаканивается»: metadata и чужие
  // показы приходят пачкой — это не события, о них не сообщаем.
  const graceOver = useHostGrace();

  useEffect(() => {
    // Голова Румика (или кружок без флага rumik_table) с рисунком человека: у
    // вышедшего атрибут с рисунком ещё на месте.
    const person = (p: RemoteParticipant) => {
      const name = displayName(p);
      return toastPerson(p, name, colorsRef.current.get(p.identity) ?? avatarColorIndex(name));
    };
    const onJoined = (p: RemoteParticipant) => {
      // Свой звук входа (соундборд) вместо обычного; выключили звуки других —
      // обычный, выключили звуки событий — никакой. Значок звука всплывает над вошедшим.
      const enter = parseEnterSoundAttribute(p.attributes);
      if (enter && isSfxEnabled() && playBoardSound(enter, p.identity)) reactionStore.show(p.identity, "sound");
      else playSfx("peer-join");
      toast({ id: `peer-${p.identity}`, title: displayName(p), description: "теперь в комнате", person: person(p) });
    };
    const onLeft = (p: RemoteParticipant) => {
      playSfx("peer-leave");
      toast({ id: `peer-${p.identity}`, title: displayName(p), description: "больше не в комнате", person: person(p) });
    };
    // LiveKit замечает, что кодировщик упирается в процессор
    // (qualityLimitationReason === "cpu"), — подсказать профиль полегче (C-6).
    const onCpu = (_track: LocalVideoTrack, pub: LocalTrackPublication) => {
      if (pub.source !== Track.Source.ScreenShare) return;
      toast({
        id: "screen-cpu",
        tone: "caution",
        title: "Компьютер не успевает кодировать",
        description: "Выберите профиль показа полегче.",
        action: { label: "Настройки", onClick: () => openSettingsRef.current("screen") },
      });
    };
    const local = room.localParticipant;
    room.on(RoomEvent.ParticipantConnected, onJoined);
    room.on(RoomEvent.ParticipantDisconnected, onLeft);
    local.on(ParticipantEvent.LocalTrackCpuConstrained, onCpu);
    return () => {
      room.off(RoomEvent.ParticipantConnected, onJoined);
      room.off(RoomEvent.ParticipantDisconnected, onLeft);
      local.off(ParticipantEvent.LocalTrackCpuConstrained, onCpu);
    };
  }, [room, colorsRef, openSettingsRef]);

  useScreenStartToasts(screens, graceOver);
  useRoomRuleToasts(graceOver);
}

/**
 * «Тёма показывает экран · Смотреть» — только если новый показ НЕ попал на
 * сцену (крупно уже другой, выбранный вручную). Новый показ обычно сам
 * выходит на сцену, и тогда тост лишь закрыл бы её плашку «Эфир» (ревью М2).
 * Тост гаснет, как только показ вышел на сцену или закончился.
 */
function useScreenStartToasts(screens: ScreenShares, graceOver: boolean): void {
  const watchRef = useLatestRef(screens.watch);
  // Показы, о которых уже решили: сказали тостом или промолчали.
  const seenRef = useRef<Set<string>>(new Set());
  // sid показа → id его тоста.
  const toastedRef = useRef<Map<string, string>>(new Map());
  const focusedSid = screens.focused?.sid ?? null;

  useEffect(() => {
    const seen = seenRef.current;
    const toasted = toastedRef.current;
    const live = new Set(screens.remote.map((s) => s.sid));
    for (const s of screens.remote) {
      if (seen.has(s.sid)) continue;
      seen.add(s.sid);
      if (!graceOver || s.sid === focusedSid) continue;
      const id = `screen-${s.participant.identity}`;
      toasted.set(s.sid, id);
      toast({
        id,
        title: `${displayName(s.participant)} показывает экран`,
        icon: "screen-share",
        tone: "signal",
        action: { label: "Смотреть", onClick: () => watchRef.current(s.sid) },
      });
    }
    for (const [sid, id] of toasted) {
      if (live.has(sid) && sid !== focusedSid) continue;
      toast.dismiss(id);
      toasted.delete(sid);
    }
    for (const sid of seen) if (!live.has(sid)) seen.delete(sid);
  }, [screens.remote, focusedSid, graceOver, watchRef]);
}

/**
 * Права и правила комнаты (ревью М1): «Ника теперь хост» / «Вы теперь хост»,
 * «Вход закрыт» / «Вход открыт» — всем; «Показывать экран теперь может только
 * хост» — гостям (хост сам их и сменил). Раньше это было слышно только звуком —
 * с выключенными звуками новый хост и не знал, что получил права.
 *
 * Сравниваем с прошлым описанием комнаты, а не ловим событие: metadata
 * приходит целиком. Пока описания нет (вход, обрыв) — ничего не запоминаем,
 * иначе возвращение описания выглядело бы как смена хоста.
 */
function useRoomRuleToasts(graceOver: boolean): void {
  const room = useRoomContext();
  const { identity: me } = useRoomSession();
  const { meta, hostIdentity, locked, settings, amHost } = useRoomMeta();
  const prevRef = useRef<{ host: string | null; locked: boolean; screen: ScreenPolicy } | null>(null);

  useEffect(() => {
    if (!meta) return;
    const prev = prevRef.current;
    prevRef.current = { host: hostIdentity, locked, screen: settings.screen };
    if (!prev || !graceOver) return;

    if (hostIdentity && hostIdentity !== prev.host) {
      if (hostIdentity === me) {
        toast({ id: "room-host", icon: "crown", title: "Вы теперь хост", description: "Настройки комнаты открываются из меню названия" });
      } else {
        const p = room.getParticipantByIdentity(hostIdentity);
        const name = p ? displayName(p) : meta.hostName;
        if (name) toast({ id: "room-host", icon: "crown", title: `${name} теперь хост` });
      }
    }

    if (locked !== prev.locked) {
      toast(
        locked
          ? { id: "room-lock", icon: "lock", tone: "caution", title: "Вход закрыт", description: "Новые люди не смогут зайти" }
          : { id: "room-lock", icon: "unlock", title: "Вход открыт", description: "Новые люди снова могут зайти" },
      );
    }

    // Свой идущий показ хост мог как раз остановить новыми правилами — тогда
    // всё скажет тост «Хост остановил ваш показ экрана», второй не нужен.
    if (settings.screen !== prev.screen && !amHost && !room.localParticipant.isScreenShareEnabled) {
      toast({ id: "room-screen-policy", icon: "screen-share", title: SCREEN_POLICY_TITLE[settings.screen] });
    }
  }, [room, me, meta, hostIdentity, locked, settings.screen, amHost, graceOver]);
}
