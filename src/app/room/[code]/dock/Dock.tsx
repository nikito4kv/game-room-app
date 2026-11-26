"use client";

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, Ref } from "react";
import { useRef } from "react";
import { useRoomContext } from "@livekit/components-react";
import { CountBadge, IconButton, cn, toast, type IconName, type IconButtonVariant } from "@/components/ui";
import type { MicState } from "@/lib/audio/voiceState";
import { formatKeyCode } from "@/lib/keys";
import { useDeafen } from "../audio/useDeafen";
import { useMic } from "../audio/useMic";
import { useIsSpeaking } from "../audio/useSpeaking";
import { useChatPanel } from "../chat/useChatPanel";
import ReactionButton from "../reactions/ReactionButton";
import SoundButton from "../sounds/SoundButton";
import { useScreenShareControl } from "../stage/useScreenShareControl";
import { bindsPref, showKeysPref } from "../state/prefs";
import { useRoomActions } from "../state/RoomActions";
import { useRoomLink } from "../state/RoomSession";
import { usePersistentState } from "../state/usePersistentState";
import DeviceMenu from "./DeviceMenu";

// label — постоянное имя кнопки (+ aria-pressed), hint — что случится по клику.
const MIC_UI: Record<MicState, { icon: IconName; variant: IconButtonVariant; hint: string }> = {
  on: { icon: "mic", variant: "soft", hint: "Выключить микрофон" },
  off: { icon: "mic-off", variant: "danger", hint: "Включить микрофон" },
  "ptt-idle": { icon: "radio", variant: "soft", hint: "Рация: удерживайте клавишу, чтобы говорить" },
  "ptt-talk": { icon: "radio", variant: "signal", hint: "Рация: вы в эфире" },
  forced: { icon: "mic-off", variant: "danger", hint: "Хост выключил ваш микрофон" },
};

const FORCED_REASON = "Хост выключил ваш микрофон. Включить его снова может только хост";

/** Касание рации короче этого — не «держал», а «ткнул»: подскажем, как говорить. */
const PTT_TAP_MS = 250;

/**
 * Нижний док: `[˄ Микрофон] [˄ Звук] | [Экран] [Чат] [Реакции] | [Настройки] [Выйти]`.
 * Плавает по центру зоны комнаты (без чата — ширину чата корень отдаёт в
 * --chat-w), на узком окне — полоса во всю ширину без зазоров между кнопками
 * (восемь кнопок: на узком они ужимаются до 44 и 40 px). Все действия — через
 * useRoomActions, те же, что у горячих клавиш. «Реакции» — без горячей
 * клавиши: любую клавишу можно занять своим биндом, конфликт не исключить.
 *
 * Док — область разметки «Управление» (<section> с подписью): скринридер
 * переходит к ней по ориентирам, axe не ругается на кнопки вне областей.
 * Неактивные кнопки (экран под запретом, микрофон у заглушённого) по нажатию
 * говорят причину тостом: на сенсорном экране подсказок при наведении нет.
 */
export default function Dock({ ref }: { ref?: Ref<HTMLElement> }) {
  const [binds] = usePersistentState(bindsPref);
  const [showKeys] = usePersistentState(showKeysPref);
  const { deafened } = useDeafen();
  const screen = useScreenShareControl();
  const chat = useChatPanel();
  const actions = useRoomActions();

  const screenBlocked = !screen.enabled && !screen.allowed;
  const screenHint = screen.enabled
    ? "Остановить показ"
    : screen.allowed
      ? "Показать экран"
      : (screen.blockedReason ?? "Показ экрана недоступен");

  return (
    <section
      ref={ref}
      aria-label="Управление"
      className={cn(
        "flex items-center gap-1.5 bg-raised p-1.5",
        // Центр зоны комнаты: на широком экране — без открытого чата.
        "sm:absolute sm:bottom-5 sm:left-1/2 sm:z-[var(--gr-z-dock)] sm:-translate-x-1/2 sm:rounded-full sm:border sm:border-line sm:shadow-float",
        "lg:left-[calc((100%-var(--chat-w,0px))/2)]",
        "max-sm:shrink-0 max-sm:justify-around max-sm:gap-0 max-sm:border-t max-sm:border-line max-sm:px-2 max-sm:pb-[max(6px,env(safe-area-inset-bottom))]",
        // Восемь кнопок по 48 px не влезают в 390: на узком окне — по 44, а на самом узком — по 40.
        "max-sm:[&_button]:size-11 max-[380px]:[&_button]:size-10",
      )}
    >
      <div className="flex items-center rounded-full sm:bg-wash-1 sm:pl-1">
        <DeviceMenu kind="audioinput" />
        <MicButton micKey={formatKeyCode(binds.mic)} pttKey={formatKeyCode(binds.ptt)} showKeys={showKeys} />
      </div>
      <div className="flex items-center rounded-full sm:bg-wash-1 sm:pl-1">
        <DeviceMenu kind="audiooutput" />
        <IconButton
          data-testid="dock-deafen"
          icon={deafened ? "headphones-off" : "headphones"}
          label="Звук"
          hint={deafened ? "Включить звук" : "Выключить звук"}
          shortcut={formatKeyCode(binds.deafen)}
          showShortcut={showKeys}
          variant={deafened ? "danger" : "soft"}
          size="lg"
          shape="round"
          pressed={deafened}
          onClick={() => actions.toggleDeafen()}
        />
      </div>
      <span aria-hidden="true" className="mx-1 h-7 w-px bg-line max-sm:hidden" />
      <IconButton
        data-testid="dock-screen"
        icon={screen.enabled ? "screen-stop" : "screen-share"}
        label={screen.enabled || screen.allowed ? "Показ экрана" : `Показ экрана: ${screenHint}`}
        hint={screenHint}
        shortcut={formatKeyCode(binds.screen)}
        showShortcut={showKeys}
        variant={screen.enabled ? "inverse" : "soft"}
        size="lg"
        shape="round"
        pressed={screen.enabled}
        loading={screen.pending}
        disabled={screenBlocked}
        disabledReason={screenBlocked ? screenHint : undefined}
        onClick={() => actions.toggleScreenShare()}
      />
      <IconButton
        data-testid="dock-chat"
        icon="chat"
        label={!chat.open && chat.unread > 0 ? `Чат, непрочитанных: ${chat.unread}` : "Чат"}
        hint={chat.open ? "Закрыть чат" : "Открыть чат"}
        shortcut={formatKeyCode(binds.chat)}
        variant={chat.open ? "inverse" : "soft"}
        size="lg"
        shape="round"
        pressed={chat.open}
        badge={!chat.open && chat.unread > 0 ? <CountBadge count={chat.unread} /> : undefined}
        onClick={() => actions.toggleChat()}
      />
      <ReactionButton />
      <SoundButton />
      <span aria-hidden="true" className="mx-1 h-7 w-px bg-line max-sm:hidden" />
      <IconButton
        data-testid="dock-settings"
        icon="settings"
        label="Настройки"
        variant="ghost"
        size="lg"
        shape="round"
        onClick={() => actions.openSettings()}
      />
      <IconButton
        data-testid="dock-leave"
        icon="leave"
        label="Выйти из комнаты"
        variant="danger-ghost"
        size="lg"
        shape="round"
        onClick={() => actions.leave()}
      />
    </section>
  );
}

/** Клик пришёл от пальца или пера (а не от мыши или Enter с клавиатуры). */
function fromTouch(e: ReactMouseEvent): boolean {
  const native = e.nativeEvent;
  return typeof PointerEvent !== "undefined" && native instanceof PointerEvent && native.pointerType !== "mouse" && native.pointerType !== "";
}

/**
 * Кнопка микрофона — отдельно, потому что слушает «говорю ли я»: перерисовка
 * на каждую фразу не должна задевать весь док. Когда вас слышно в открытом
 * микрофоне и вы говорите — кольцо signal вокруг кнопки; пока связь
 * восстанавливается, его нет: вас всё равно не слышно (ревью М6).
 *
 * Рация на сенсорном экране — «нажми и держи»: пока палец на кнопке, вы в
 * эфире (mic.pttHold, как клавиша рации), а касание не выключает рацию.
 * Мышью и с клавиатуры кнопка, как и раньше, включает и выключает рацию.
 */
function MicButton({ micKey, pttKey, showKeys }: { micKey: string; pttKey: string; showKeys: boolean }) {
  const room = useRoomContext();
  const mic = useMic();
  const actions = useRoomActions();
  const { reconnecting } = useRoomLink();
  const speaking = useIsSpeaking(room.localParticipant);
  const ptt = mic.mode === "ptt";
  const ui = MIC_UI[mic.state];
  // Рацию можно держать, когда она включена и ничто не мешает.
  const holdable = ptt && (mic.state === "ptt-idle" || mic.state === "ptt-talk") && !mic.error;
  const holdRef = useRef<{ id: number; at: number } | null>(null);

  // Нет доступа, микрофон занят или не найден — кнопка предлагает попробовать снова.
  const hint = mic.error
    ? `${mic.error.title}. Нажмите, чтобы попробовать снова`
    : mic.state === "ptt-idle"
      ? `Рация: удерживайте ${pttKey}, чтобы говорить`
      : ui.hint;
  const label = mic.state === "forced" ? "Микрофон: хост выключил ваш микрофон" : ptt ? "Микрофон (рация)" : "Микрофон";

  const startHold = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!holdable || e.pointerType === "mouse" || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    holdRef.current = { id: e.pointerId, at: performance.now() };
    mic.pttHold(true);
  };
  // Отпустили, палец ушёл или браузер забрал жест — эфир закрывается (с той
  // же задержкой, что у клавиши). lostpointercapture приходит и после
  // pointerup — второй раз ничего не делаем.
  const endHold = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const hold = holdRef.current;
    if (!hold || hold.id !== e.pointerId) return;
    holdRef.current = null;
    mic.pttHold(false);
    if (e.type === "pointerup" && performance.now() - hold.at < PTT_TAP_MS) {
      // immediate — ответ на касание не ждёт в очереди за старыми тостами.
      toast({ id: "ptt-hint", icon: "radio", title: "Рация: держите кнопку, пока говорите", immediate: true });
    }
  };

  return (
    <IconButton
      data-testid="dock-mic"
      icon={mic.error ? "mic-off" : ui.icon}
      label={label}
      hint={hint}
      shortcut={ptt ? pttKey : micKey}
      // Рация ждёт клавишу — её буква видна всегда, иначе непонятно, что жать.
      showShortcut={showKeys || ptt}
      variant={mic.error ? "danger" : ui.variant}
      size="lg"
      shape="round"
      pressed={mic.state === "on" || mic.state === "ptt-talk"}
      disabled={mic.state === "forced" || mic.pending}
      disabledReason={mic.state === "forced" ? FORCED_REASON : undefined}
      className={cn(
        speaking &&
          mic.state === "on" &&
          !reconnecting &&
          "shadow-[0_0_0_2px_var(--gr-raised),0_0_0_4px_var(--gr-signal)]",
        // Палец держит рацию: странице не отдаём ни прокрутку, ни меню долгого нажатия.
        holdable && "touch-none [-webkit-touch-callout:none]",
      )}
      onPointerDown={startHold}
      onPointerUp={endHold}
      onPointerCancel={endHold}
      onLostPointerCapture={endHold}
      onContextMenu={holdable ? (e) => e.preventDefault() : undefined}
      onClick={(e) => {
        // Касание рации — это «держать», а не «включить/выключить рацию».
        if (holdable && fromTouch(e)) return;
        if (mic.error) mic.retry();
        else actions.toggleMic();
      }}
    />
  );
}
