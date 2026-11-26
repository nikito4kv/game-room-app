import { RemoteTrack, type RoomOptions } from "livekit-client";
import { micDeviceConstraint, type DeviceInfo } from "@/lib/audio/devices";
import { getPlaybackContext } from "@/lib/audio/playback";
import { VOICE_PUBLISH_DEFAULTS, micCaptureDefaults, type MicCaptureOptions } from "@/lib/audio/voiceOptions";
import { pickScreenShareCodec } from "@/lib/screenShare";

/**
 * Без вечного цикла на чужих дорожках. livekit-client на каждую чужую дорожку
 * запускает requestAnimationFrame, который на каждом кадре зовёт
 * getSynchronizationSources() — ради события TrackEvent.TimeSyncUpdate (сверка
 * кадров с метаданными для транскрипций и packet trailer). Мы его не слушаем, а
 * цикл был главной нагрузкой комнаты в тишине: ~12 мс/с главного потока при трёх
 * собеседниках, ~300 вызовов в секунду и перерисовка кадров, даже когда все
 * молчат (QA, фаза 3). Это FPS игры на соседнем мониторе.
 *
 * Выключаем при загрузке модуля: RoomClient импортирует его раньше, чем создаёт
 * Room, а дорожки появляются только после подключения. Если livekit-client
 * переименует метод, упадёт tsc, а если цикл переедет в другой метод — тест
 * roomOptions.test.ts («start() не запускает rAF»).
 */
RemoteTrack.prototype.registerTimeSyncUpdate = function registerTimeSyncUpdate() {};

/**
 * Полный RoomOptions для <LiveKitRoom>. Только сборка: голосовые параметры живут в
 * @/lib/audio/voiceOptions, параметры демонстрации — в @/lib/screenShare.
 * Строится на клиенте (зависит от navigator и localStorage), поэтому вызывать через
 * useMemo(…, []) — один раз, со стабильной ссылкой, иначе LiveKit пересоздаёт Room.
 *
 * webAudioMix: приём звука через общий контекст воспроизведения (@/lib/audio/playback).
 * Так громкость участника поднимается ВЫШЕ 100% (через gain, а не
 * HTMLMediaElement.volume, который на значении >1 падает), на чужую дорожку
 * встают наши узлы (уровень «говорит», громкость, лимитер — audio/RoomAudio), а
 * устройство вывода выбирается сразу для голосов, звуков интерфейса и «слышать
 * себя». Без Web Audio (и на сервере) — свой контекст LiveKit.
 *
 * adaptiveStream + dynacast: зритель получает слой под размер своего окна, а
 * свёрнутую/скрытую демонстрацию не получает вовсе; стример не кодирует слои,
 * которые никто не смотрит. pixelDensity: 2 — слой просим под двойной размер
 * сцены: сервер берёт наименьший слой не ниже 0,9 запроса, и с плотностью 1 на
 * обычных мониторах сцена получала бы нижний слой вместо 1080p (аудит C-1).
 * Мелкое (чужой показ не в фокусе, превью) по-прежнему берёт дешёвый 360p.
 *
 * backupCodec:false — осознанно. Запасной кодек LiveKit публикует, только когда
 * подключается зритель без H.264, и по умолчанию стример тогда целиком переходит
 * на программный VP8 — 1080p60 на процессоре во время игры, у всех зрителей.
 * Для компании на Chromium это хуже редкого чёрного экрана у зрителя без H.264
 * (Firefox декодирует H.264 через OpenH264, который ставит сам).
 *
 * voice — флаги захвата голоса (по умолчанию: наш шумодав, эхоподавление вкл,
 * браузерные автогромкость и шумодав выкл; см. micCaptureDefaults). devices —
 * известный список устройств: по нему выбранный микрофон просим точно (см.
 * micDeviceConstraint).
 */
export function buildRoomOptions({
  inputDeviceId,
  voice,
  devices = [],
}: { inputDeviceId?: string | null; voice?: MicCaptureOptions; devices?: DeviceInfo[] } = {}): RoomOptions {
  const playback = getPlaybackContext();
  return {
    webAudioMix: playback ? { audioContext: playback } : true,
    adaptiveStream: { pixelDensity: 2 },
    dynacast: true,
    audioCaptureDefaults: micCaptureDefaults(micDeviceConstraint(inputDeviceId, devices), voice),
    publishDefaults: {
      ...VOICE_PUBLISH_DEFAULTS,
      videoCodec: pickScreenShareCodec(),
      backupCodec: false,
    },
  };
}
