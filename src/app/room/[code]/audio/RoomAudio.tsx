"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  AudioTrack,
  StartAudio,
  useRoomContext,
  useTracks,
  type TrackReference,
} from "@livekit/components-react";
import { RemoteAudioTrack, RoomEvent, Track, TrackEvent, type Room } from "livekit-client";
import { buttonClass, toast } from "@/components/ui";
import {
  DEFAULT_DEVICE,
  defaultDeviceSignature,
  deviceLabel,
  findDefaultDevice,
  isDeviceAvailable,
} from "@/lib/audio/devices";
import {
  getPlaybackContext,
  outputSelectionSupported,
  peekPlaybackContext,
  switchOutput,
} from "@/lib/audio/playback";
import { DUCK_GAIN, streamDuck } from "@/lib/audio/ducking";
import { createRemoteChain, type RemoteChain } from "@/lib/audio/remoteChain";
import { remoteLevels } from "@/lib/audio/speaking";
import { trackVolume } from "@/lib/room/volume";
import { screenDuckPref } from "../state/prefs";
import { useLatestRef } from "../state/useLatestRef";
import { usePersistentState } from "../state/usePersistentState";
import { useRoomConfig } from "../state/useRoomConfig";
import { useVolumes } from "../state/volumes";
import { useDeafen } from "./useDeafen";
import { outputDevicePref } from "./voicePrefs";

/**
 * Чужой звук: голоса и звук демонстраций. Рисуем сами (а не <RoomAudioRenderer>),
 * чтобы у каждой дорожки была своя громкость и свои узлы (@/lib/audio/remoteChain):
 * уровень для «говорит», громкость до 200 % без хрипа и без «проскока» на 100 %.
 *
 * Громкость: master × личная (trackVolume из @/lib/room/volume); у звука
 * демонстрации своя карта stream. «Звук выкл» — громкость 0, а подписка остаётся
 * живой: так кольца «говорит» у других продолжают гореть (уровень меряется до
 * громкости), а при снятии звук возвращается мгновенно, без переподписки.
 *
 * Пока кто-то говорит, звук демонстраций тише (DUCK_GAIN) — флаг screen_ducking
 * и своя настройка во вкладке «Экран» (@/lib/audio/ducking).
 *
 * <StartAudio> обязателен: без штатного рендерера разблокировку звука браузером
 * делаем сами — кнопка видна, только пока браузер его не пустил.
 */
export default function RoomAudio() {
  const room = useRoomContext();
  const volumes = useVolumes();
  const { deafened } = useDeafen();
  const ducked = useStreamDucked();
  useOutputDevice(room);

  // Микрофоны и звук демонстраций; только подписанные и только чужие.
  const tracks = useTracks([Track.Source.Microphone, Track.Source.ScreenShareAudio], {
    onlySubscribed: true,
  }).filter((t) => !t.participant.isLocal);
  const chained = usesPlaybackContext(room);

  return (
    <>
      {tracks.map((t) => (
        <RemoteAudio
          key={t.publication.trackSid}
          trackRef={t}
          chained={chained}
          voice={t.source === Track.Source.Microphone}
          volume={
            deafened
              ? 0
              : t.source === Track.Source.ScreenShareAudio
                ? trackVolume(volumes, t.participant.identity, "stream") * (ducked ? DUCK_GAIN : 1)
                : trackVolume(volumes, t.participant.identity, "voice")
          }
        />
      ))}
      <StartAudio
        label="Включить звук"
        className={buttonClass({
          variant: "primary",
          size: "lg",
          className: "fixed bottom-24 left-1/2 z-[var(--gr-z-toast)] -translate-x-1/2 shadow-float",
        })}
      />
    </>
  );
}

const noDuck = () => () => {};
const notDucked = () => false;

/**
 * Приглушать ли сейчас звук демонстраций: флаг комнаты и своя настройка; выключено —
 * на речь не подписываемся вовсе (в тишине ничего не тикает).
 */
function useStreamDucked(): boolean {
  const { flags } = useRoomConfig();
  const [on] = usePersistentState(screenDuckPref);
  const enabled = flags.screen_ducking && on;
  return useSyncExternalStore(
    enabled ? streamDuck.subscribe : noDuck,
    enabled ? streamDuck.get : notDucked,
    notDucked,
  );
}

/**
 * LiveKit играет звук в нашем общем контексте (buildRoomOptions) — значит, можно
 * ставить свои узлы. Иначе (нет Web Audio) — громкость средствами LiveKit.
 */
function usesPlaybackContext(room: Room): boolean {
  const mix = room.options.webAudioMix;
  return typeof mix === "object" && !!mix.audioContext && mix.audioContext === peekPlaybackContext();
}

function RemoteAudio({
  trackRef,
  volume,
  voice,
  chained,
}: {
  trackRef: TrackReference;
  volume: number;
  /** Голос (микрофон), а не звук демонстрации: только он зажигает «говорит». */
  voice: boolean;
  chained: boolean;
}) {
  const track = trackRef.publication.track;
  const identity = trackRef.participant.identity;
  const chainRef = useRef<RemoteChain | null>(null);
  const volumeRef = useLatestRef(volume);

  useEffect(() => {
    const ctx = getPlaybackContext();
    if (!chained || !ctx || !(track instanceof RemoteAudioTrack)) return;
    const chain = createRemoteChain(ctx, volumeRef.current, voice);
    chainRef.current = chain;
    track.setWebAudioPlugins(chain.nodes);
    // Заглушённую дорожку уровни не опрашивают: там нули, а таймер будил бы
    // вкладку 20 раз в секунду, даже когда все молчат кнопкой.
    const analyser = chain.analyser;
    const onMuted = () => analyser && remoteLevels.setActive(identity, analyser, false);
    const onUnmuted = () => analyser && remoteLevels.setActive(identity, analyser, true);
    if (analyser) {
      remoteLevels.add(identity, analyser, !track.isMuted);
      track.on(TrackEvent.Muted, onMuted).on(TrackEvent.Unmuted, onUnmuted);
    }
    return () => {
      if (analyser) {
        track.off(TrackEvent.Muted, onMuted).off(TrackEvent.Unmuted, onUnmuted);
        remoteLevels.remove(identity, analyser);
      }
      track.setWebAudioPlugins([]);
      chain.dispose();
      chainRef.current = null;
    };
  }, [track, chained, voice, identity, volumeRef]);

  useEffect(() => {
    chainRef.current?.setVolume(volume);
  }, [volume]);

  // Со своими узлами громкость LiveKit держим на 1 — громкость в нашей цепочке.
  return <AudioTrack trackRef={trackRef} volume={chained ? 1 : volume} />;
}

/**
 * Устройство вывода: сохранённое — при входе; выдернули — системное (с тостом),
 * вставили обратно — возвращаем; «как в системе», а Windows сменила устройство
 * по умолчанию — переезжаем (контекст привязан к конкретному устройству и сам
 * не переедет). В Firefox и Safari выбора нет — звук идёт в системный вывод.
 */
function useOutputDevice(room: Room) {
  useEffect(() => {
    if (!outputSelectionSupported()) return;
    let alive = true;
    let lastSignature: string | null = null;
    let fallback = false;
    const check = async (initial: boolean) => {
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      // Без разрешения устройства скрыты (пустые deviceId) — судить нельзя.
      if (!alive || !devices.some((d) => d.kind === "audiooutput" && d.deviceId)) return;
      const chosen = outputDevicePref.get();
      const here = chosen === DEFAULT_DEVICE || isDeviceAvailable(chosen, devices, "audiooutput");
      const signature = defaultDeviceSignature(devices, "audiooutput");
      const systemName = deviceLabel(findDefaultDevice(devices, "audiooutput"), "системный вывод");
      const apply = (id: string) =>
        switchOutput(id, room).catch(() => switchOutput(DEFAULT_DEVICE, room).catch(() => {}));
      const lost = (title: string) =>
        toast({ id: "output-device", tone: "caution", icon: "headphones", title, description: `Звук идёт в «${systemName}»` });
      if (initial) {
        fallback = !here;
        await apply(here ? chosen : DEFAULT_DEVICE);
        if (!here) lost("Сохранённое устройство вывода не найдено");
      } else if (!here) {
        if (!fallback) {
          fallback = true;
          await apply(DEFAULT_DEVICE);
          lost("Устройство вывода отключено");
        }
      } else if (fallback && chosen !== DEFAULT_DEVICE) {
        fallback = false;
        await apply(chosen);
        toast({ id: "output-device", icon: "headphones", title: "Устройство вывода снова подключено" });
      } else if ((chosen === DEFAULT_DEVICE || fallback) && lastSignature !== null && signature !== lastSignature) {
        await apply(DEFAULT_DEVICE);
      }
      lastSignature = signature;
    };
    void check(true);
    const onChange = () => void check(false);
    room.on(RoomEvent.MediaDevicesChanged, onChange);
    return () => {
      alive = false;
      room.off(RoomEvent.MediaDevicesChanged, onChange);
    };
  }, [room]);
}
