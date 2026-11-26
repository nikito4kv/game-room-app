"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";
import { VideoTrack } from "@livekit/components-react";
import { RemoteVideoTrack } from "livekit-client";
import { Badge, Icon, IconButton, Popover, Slider, avatarColorIndex, cn } from "@/components/ui";
import { mergeRefs } from "@/components/ui/refs";
import { actionForKey, isTypingTarget } from "@/lib/room/hotkeys";
import {
  NO_ZOOM,
  clampZoom,
  formatZoom,
  panBy,
  wheelZoomFactor,
  zoomAt,
  zoomStep,
  type Box,
  type Zoom,
} from "@/lib/room/zoom";
import { PersonHead } from "../feed/PersonHead";
import { displayName } from "../participants/useAvatarColors";
import { bindsPref } from "../state/prefs";
import { useLatestRef } from "../state/useLatestRef";
import { usePersistentState } from "../state/usePersistentState";
import { useVolumes } from "../state/volumes";
import StreamStats from "./StreamStats";
import type { RemoteScreen, ScreenShares } from "./useScreenShares";

/** Через сколько мс неподвижной мыши прятать кнопки в полноэкранном режиме. */
const IDLE_MS = 2000;
/** Сколько мс держать кнопки после касания (телефон, планшет). */
const TOUCH_UI_MS = 3000;

const noSubscribe = () => () => {};
const subscribeFullscreen = (cb: () => void) => {
  document.addEventListener("fullscreenchange", cb);
  return () => document.removeEventListener("fullscreenchange", cb);
};
/** Во весь экран в комнате уходит только сцена — достаточно знать, что режим включён. */
const isFullscreen = () => document.fullscreenElement !== null;

const boxOf = (el: HTMLElement): Box => ({ width: el.clientWidth, height: el.clientHeight });

/**
 * Сцена показа экрана: чужой экран крупно, во всю зону комнаты. Видео вписано
 * «contain» в рамку 16:9 по меньшей стороне сцены; поверх — только scrim-кнопки
 * (полупрозрачный чёрный без blur). Видны при наведении и фокусе с клавиатуры,
 * во весь экран прячутся через 2 с неподвижной мыши. На сенсорном экране — по
 * касанию и на 3 с: иначе пять кнопок закрывают треть маленького видео.
 *
 * Зум колесом 1–5× к точке под курсором, перетаскивание при зуме, «+» / «−» /
 * «0», сброс двойным кликом и Esc. Двойной клик без зума и клавиша F — во весь
 * экран. Зум — transform слоя с видео: размер элемента для adaptiveStream не
 * меняется, а верхний слой и так приходит (pixelDensity: 2 в roomOptions).
 *
 * ref — на саму сцену: под её верхней плашкой встают тосты (useToastTop).
 */
export default function ScreenShareStage({
  ref,
  screens,
  focused,
  colors,
}: {
  ref?: Ref<HTMLElement>;
  screens: ScreenShares;
  focused: RemoteScreen;
  colors: ReadonlyMap<string, number>;
}) {
  const stageRef = useRef<HTMLElement>(null);
  const setStageRef = useMemo(() => mergeRefs(stageRef, ref), [ref]);
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const infoRef = useRef<HTMLButtonElement>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const bottomBarRef = useRef<HTMLDivElement>(null);
  const [binds] = usePersistentState(bindsPref);
  const bindsRef = useLatestRef(binds);

  const [zoom, setZoom] = useState<Zoom>(NO_ZOOM);
  const zoomRef = useLatestRef(zoom);
  // Другой показ в фокусе — зум с прошлого не переносим.
  const [zoomFor, setZoomFor] = useState(focused.sid);
  if (zoomFor !== focused.sid) {
    setZoomFor(focused.sid);
    setZoom(NO_ZOOM);
  }

  const fullscreen = useSyncExternalStore(subscribeFullscreen, isFullscreen, () => false);
  const pipSupported = useSyncExternalStore(noSubscribe, () => document.pictureInPictureEnabled === true, () => false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<number | undefined>(undefined);
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const toggleFullscreen = useCallback(() => {
    setIdle(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void stageRef.current?.requestFullscreen().catch(() => {});
  }, []);

  const zoomBy = useCallback((direction: 1 | -1) => {
    const box = boxRef.current;
    if (box) setZoom((z) => zoomStep(z, direction, boxOf(box)));
  }, []);

  // Колесо — своим слушателем: в React onWheel пассивный, и preventDefault в нём
  // не остановит прокрутку страницы. Уменьшать без зума нечего — тогда колесо
  // остаётся странице (в узком окне сцена стоит в прокручиваемом списке).
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      const factor = wheelZoomFactor(e);
      if (factor < 1 && zoomRef.current.scale <= 1) return;
      e.preventDefault();
      const r = box.getBoundingClientRect();
      const point = { x: e.clientX - r.left, y: e.clientY - r.top };
      setZoom((z) => zoomAt(z, point, factor, boxOf(box)));
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [zoomRef]);

  // Рамка поменяла размер (окно, чат) — сдвиг зума поджимаем к новым краям.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(() => setZoom((z) => (z === NO_ZOOM ? z : clampZoom(z, boxOf(box)))));
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // Клавиши сцены. Пропускаем, если клавиша назначена действию (её ловит
  // useHotkeys), при модификаторах и при вводе текста.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      if (actionForKey(bindsRef.current, e.code)) return;
      switch (e.code) {
        case "KeyF":
          if (e.repeat) return;
          e.preventDefault();
          toggleFullscreen();
          return;
        case "Equal":
        case "NumpadAdd":
          e.preventDefault();
          zoomBy(1);
          return;
        case "Minus":
        case "NumpadSubtract":
          e.preventDefault();
          zoomBy(-1);
          return;
        case "Digit0":
        case "Numpad0":
        case "Escape":
          if (zoomRef.current === NO_ZOOM) return;
          e.preventDefault();
          setZoom(NO_ZOOM);
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bindsRef, zoomRef, toggleFullscreen, zoomBy]);

  // Во весь экран кнопки прячутся через 2 с неподвижной мыши. Таймер живёт,
  // только пока мышь двигается (и один раз — сразу после входа).
  useEffect(() => {
    if (!fullscreen) return;
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
    return () => window.clearTimeout(idleTimer.current);
  }, [fullscreen]);
  const wake = () => {
    if (!fullscreen) return;
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
  };

  // Касания (телефон, планшет): касание видео показывает кнопки на 3 с, второе
  // касание видео — прячет, как в видеоплеерах. Пока палец на кнопке или
  // ползунке, кнопки не прячутся; отсчёт заново — после отпускания. Таймер
  // живёт только пока кнопки видны.
  const [touchUi, setTouchUi] = useState(false);
  const touchTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(touchTimer.current), []);
  const armTouchHide = () => {
    window.clearTimeout(touchTimer.current);
    touchTimer.current = window.setTimeout(() => setTouchUi(false), TOUCH_UI_MS);
  };
  const onStagePointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === "mouse") return;
    if (fullscreen) {
      wake();
      return;
    }
    const target = e.target instanceof Node ? e.target : null;
    if (target && (topBarRef.current?.contains(target) || bottomBarRef.current?.contains(target))) {
      window.clearTimeout(touchTimer.current);
      return;
    }
    if (touchUi) {
      window.clearTimeout(touchTimer.current);
      setTouchUi(false);
      return;
    }
    setTouchUi(true);
    armTouchHide();
  };
  const onStagePointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== "mouse" && touchUi && !fullscreen) armTouchHide();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || zoom.scale <= 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    const box = boxOf(e.currentTarget);
    setZoom((z) => panBy(z, dx, dy, box));
  };
  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
  };

  const track = focused.ref.publication.track;
  const remoteVideo = track instanceof RemoteVideoTrack ? track : undefined;
  // Видео не перерисовываем на каждый шаг зума: элемент один, меняется только слой.
  const video = useMemo(
    () => (
      <VideoTrack ref={videoRef} trackRef={focused.ref} className="size-full object-contain" />
    ),
    [focused.ref],
  );

  const name = displayName(focused.participant);
  const zoomed = zoom !== NO_ZOOM;
  const shown = statsOpen || (fullscreen ? !idle : touchUi);
  const controls = cn(
    "transition-opacity duration-180",
    shown
      ? "opacity-100"
      : fullscreen
        ? "opacity-0"
        : // Фокус — только видимый (с клавиатуры): после касания кнопка тоже в
          // фокусе, и тогда кнопки висели бы, пока не тронешь другое.
          "opacity-0 group-hover/stage:opacity-100 group-has-[:focus-visible]/stage:opacity-100",
    // Невидимые кнопки не ловят касаний: первое касание — показать их, а не
    // нажать вслепую «Не смотреть».
    !shown && "pointer-coarse:pointer-events-none",
  );

  return (
    <section
      ref={setStageRef}
      data-testid="screen-stage"
      data-identity={focused.participant.identity}
      data-zoom={zoom.scale.toFixed(2)}
      aria-label={`Показ экрана: ${name}`}
      onPointerMove={wake}
      onPointerDown={onStagePointerDown}
      onPointerUp={onStagePointerUp}
      className={cn(
        "group/stage relative grid min-h-0 flex-1 place-items-center overflow-hidden rounded-panel bg-video [container-type:size]",
        "max-sm:aspect-video max-sm:flex-none max-sm:rounded-card [&:fullscreen]:rounded-none",
        fullscreen && idle && !statsOpen && "cursor-none",
      )}
    >
      {/* Как object-fit: contain — рамка 16:9 по меньшей стороне сцены. */}
      <div
        ref={boxRef}
        className={cn(
          "relative aspect-video w-[min(100cqw,calc(100cqh*16/9))] overflow-hidden",
          // При зуме палец двигает картинку, а не страницу.
          zoomed && (dragging ? "cursor-grabbing touch-none" : "cursor-grab touch-none"),
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => (zoomed ? setZoom(NO_ZOOM) : toggleFullscreen())}
      >
        <div
          className={cn("absolute inset-0 origin-top-left", zoomed && "will-change-transform")}
          style={zoomed ? { transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})` } : undefined}
        >
          {video}
        </div>
      </div>

      {/* Верх: «Эфир», кто показывает (или чей показ смотреть), масштаб.
          Полосы кнопок идут во всю ширину кадра, поэтому сами они прозрачны для
          мыши (pointer-events-none), а ловят её только кнопки: иначе колесо и
          перетаскивание не работали бы у верхнего и нижнего края картинки — там,
          где у игр миникарта и чат. */}
      <div
        ref={topBarRef}
        className="pointer-events-none absolute inset-x-0 top-0 z-[var(--gr-z-stage-ui)] flex items-start justify-between gap-2 p-3"
      >
        <div className={cn("flex min-w-0 items-center gap-2", controls)}>
          <Badge tone="signal" variant="solid" size="sm" caps>
            Эфир
          </Badge>
          {screens.remote.length > 1 ? (
            <div className="pointer-events-auto min-w-0">
              <StreamSwitcher screens={screens} focusedSid={focused.sid} colors={colors} />
            </div>
          ) : (
            <span className="flex h-7 min-w-0 items-center gap-1.5 rounded-full bg-[rgb(0_0_0/0.55)] pl-0.5 pr-3 text-label font-medium text-white">
              <PersonHead
                p={focused.participant}
                name={name}
                colorIndex={colors.get(focused.participant.identity) ?? avatarColorIndex(name)}
                size="xs"
              />
              <span className="truncate">{name}</span>
            </span>
          )}
        </div>
        {/* Масштаб виден всё время, пока картинка увеличена, — даже когда
            остальные кнопки спрятались: иначе не понять, что кадр приближен. */}
        {zoomed && (
          <div className="pointer-events-auto flex shrink-0 items-center gap-1 rounded-full bg-[rgb(0_0_0/0.55)] py-0.5 pl-3 pr-0.5 text-label font-medium tabular-nums text-white">
            {formatZoom(zoom.scale)}
            <button
              type="button"
              onClick={() => setZoom(NO_ZOOM)}
              className="h-7 rounded-full px-2.5 text-white/80 transition-colors duration-140 hover:bg-white/15 hover:text-white"
            >
              Сбросить
            </button>
          </div>
        )}
      </div>

      {/* Низ: громкость показа и управление просмотром. */}
      <div
        ref={bottomBarRef}
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-[var(--gr-z-stage-ui)] flex items-end justify-end gap-2 bg-[linear-gradient(to_top,rgb(0_0_0/0.62),transparent)] p-3 pt-10 [&>*]:pointer-events-auto",
          controls,
        )}
      >
        <StreamVolume identity={focused.participant.identity} />
        <IconButton
          ref={infoRef}
          data-testid="stage-stats"
          icon="info"
          label="Качество показа"
          variant="scrim"
          shape="round"
          pressed={statsOpen}
          onClick={() => setStatsOpen((v) => !v)}
        />
        <IconButton
          data-testid="stage-hide"
          icon="eye-off"
          label="Не смотреть показ"
          hint="Не смотреть: картинка и звук перестанут приходить"
          variant="scrim"
          shape="round"
          onClick={() => screens.hide(focused.sid)}
        />
        {pipSupported && (
          <IconButton
            icon="pip"
            label="Картинка в картинке"
            hint="Картинка в картинке: показ поверх всех окон"
            variant="scrim"
            shape="round"
            onClick={() => void videoRef.current?.requestPictureInPicture().catch(() => {})}
          />
        )}
        <IconButton
          icon={fullscreen ? "minimize" : "maximize"}
          label={fullscreen ? "Выйти из полноэкранного режима" : "Во весь экран"}
          shortcut="F"
          variant="scrim"
          shape="round"
          onClick={toggleFullscreen}
        />
      </div>

      <Popover
        open={statsOpen}
        onOpenChange={setStatsOpen}
        anchor={infoRef}
        triggerRef={infoRef}
        side="top"
        align="end"
        aria-label="Качество показа"
        focus="container"
        className="w-64 p-3"
      >
        {statsOpen && <StreamStats track={remoteVideo} />}
      </Popover>
    </section>
  );
}

/** Громкость показа — отдельно от голоса того, кто показывает (аудит C-4). */
function StreamVolume({ identity }: { identity: string }) {
  const { stream, voice, setStream } = useVolumes();
  const value = Math.round((stream[identity] ?? voice[identity] ?? 1) * 100);
  const lastRef = useRef(100);
  const toggleMute = () => {
    if (value > 0) {
      lastRef.current = value;
      setStream(identity, 0);
    } else {
      setStream(identity, lastRef.current / 100);
    }
  };
  return (
    <div className="flex h-10 items-center gap-1 rounded-full bg-[rgb(0_0_0/0.55)] pl-1 pr-3 text-white max-sm:pr-1">
      <IconButton
        icon={value === 0 ? "volume-off" : "volume"}
        label="Звук показа"
        hint={value === 0 ? "Включить звук показа" : "Выключить звук показа"}
        variant="scrim-ghost"
        size="sm"
        shape="round"
        onClick={toggleMute}
      />
      <Slider
        aria-label="Громкость показа"
        value={value}
        onValueChange={(v) => setStream(identity, v / 100)}
        max={200}
        marks={[100]}
        snap={4}
        showValue={false}
        formatValue={(v) => `${v}%`}
        variant="scrim"
        wrapperClassName="w-24 max-sm:hidden"
      />
    </div>
  );
}

/** Чей показ смотреть, если показывают двое и больше: порядок — по началу показа. */
function StreamSwitcher({
  screens,
  focusedSid,
  colors,
}: {
  screens: ScreenShares;
  focusedSid: string;
  colors: ReadonlyMap<string, number>;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = screens.remote.findIndex((s) => s.sid === focusedSid);
    const n = screens.remote.length;
    const next = (i + (e.key === "ArrowRight" ? 1 : n - 1)) % n;
    screens.focus(screens.remote[next].sid);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label="Чей показ смотреть"
      onKeyDown={onKeyDown}
      className="flex min-w-0 rounded-full bg-[rgb(0_0_0/0.55)] p-0.5"
    >
      {screens.remote.map((s, i) => {
        const on = s.sid === focusedSid;
        const name = displayName(s.participant);
        return (
          <button
            key={s.sid}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => screens.focus(s.sid)}
            className={cn(
              "flex h-7 min-w-0 items-center gap-1.5 rounded-full pl-0.5 pr-2.5 text-label font-medium transition-colors duration-140",
              on ? "bg-white text-black" : "text-white/80 hover:text-white",
            )}
          >
            <PersonHead
              p={s.participant}
              name={name}
              colorIndex={colors.get(s.participant.identity) ?? avatarColorIndex(name)}
              size="xs"
            />
            <span className="truncate">{name}</span>
            {s.hidden && <Icon name="eye-off" size={12} />}
          </button>
        );
      })}
    </div>
  );
}
