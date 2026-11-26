"use client";

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRoomContext } from "@livekit/components-react";
import type { Participant } from "livekit-client";
import type { ChatMessage } from "@/lib/api/contract";
import { avatarColorIndex, toast } from "@/components/ui";
import { playSfx } from "@/lib/audio/sfx";
import { roomTabTitle } from "@/lib/client/chat";
import { toastPerson } from "../feed/PersonHead";
import { avatarColorMap, usePeople } from "../participants/useAvatarColors";
import { useLatestRef } from "../state/useLatestRef";
import { useRoomMeta } from "../state/useRoomMeta";
import { useChatFeed, type ChatFeed } from "./useChatFeed";

/** Панель чата: открыта ли и сколько непрочитанных. Для дока, клавиш и шапки. */
export type ChatPanel = {
  open: boolean;
  /** Непрочитанные: пришли, пока панель закрыта или вкладка скрыта (вы в игре). */
  unread: number;
  /**
   * Открыть без звука и поставить фокус в поле — горячая клавиша, «Ответить» в
   * тосте. Если чат уже открыт — просто фокус в поле.
   */
  openPanel: () => void;
  /**
   * Показать молча и без фокуса: раскладка сама держит чат открытым (узкое
   * окно, чат под списком). Фокус в поле поднял бы клавиатуру на телефоне.
   */
  show: () => void;
  close: () => void;
  /** Открыть/закрыть со звуком — кнопка дока. */
  toggle: () => void;
};

/** Автор сообщений: участник и его цвет в комнате. */
export type ChatAuthor = { p: Participant; colorIndex: number };

/**
 * Лента для самой панели. firstUnreadId — над ним разделитель «Новые».
 * focusTick меняется на каждое «открыть с фокусом», takeFocusRequest() —
 * просили ли фокус в поле (один раз на просьбу). authors — все, кого видели в
 * комнате за этот вход, по identity (useAuthors).
 */
export type ChatView = ChatFeed & {
  firstUnreadId: string | null;
  focusTick: number;
  takeFocusRequest: () => boolean;
  authors: ReadonlyMap<string, ChatAuthor>;
};

const ChatPanelContext = createContext<ChatPanel | null>(null);
const ChatViewContext = createContext<ChatView | null>(null);

/** Атрибут корня панели (RoomChat): по нему понимаем, что фокус внутри чата. */
const CHAT_PANEL_ATTR = "data-chat-panel";

/** Тост «пришло сообщение · Ответить»: один на чат, гаснет, как только чат на экране. */
const INCOMING_TOAST = "chat-incoming";

const PREVIEW_LENGTH = 140;
const preview = (text: string) =>
  text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1)}…` : text;

const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

/**
 * Чат комнаты: лента (useChatFeed), панель и непрочитанные. Лента живёт всегда,
 * даже когда панель закрыта: копит сообщения, считает непрочитанные, звенит и
 * показывает тост «Ответить». Заголовок вкладки — «(3) Название · Game Room»:
 * из игры по Alt-Tab видно, что написали. Два контекста — чтобы док не
 * перерисовывался на каждое сообщение.
 */
export function ChatPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const openRef = useLatestRef(open);
  // Первое непрочитанное с прошлого прочтения — станет разделителем «Новые».
  const pendingFirstRef = useRef<string | null>(null);
  // Куда вернуть фокус, когда чат закроют изнутри (Esc, крестик).
  const returnFocusRef = useRef<HTMLElement | null>(null);
  // Просьба поставить фокус в поле: открыли руками (док, Enter, «Ответить»).
  const focusRequestRef = useRef(false);
  const [focusTick, setFocusTick] = useState(0);
  const room = useRoomContext();
  const people = usePeople();
  const colors = useMemo(() => avatarColorMap(people), [people]);
  const colorsRef = useLatestRef(colors);
  const authors = useAuthors(people, colors);
  const { title } = useRoomMeta();

  const markRead = useCallback(() => {
    if (pendingFirstRef.current) setFirstUnreadId(pendingFirstRef.current);
    pendingFirstRef.current = null;
    setUnread(0);
  }, []);

  /** Чат на экране: тост о новом сообщении больше не нужен, всё прочитано. */
  const reveal = useCallback(() => {
    setOpen(true);
    toast.dismiss(INCOMING_TOAST);
    if (!isHidden()) markRead();
  }, [markRead]);

  const openPanel = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !active.closest(`[${CHAT_PANEL_ATTR}]`)) {
      returnFocusRef.current = active;
    }
    focusRequestRef.current = true;
    setFocusTick((n) => n + 1);
    reveal();
  }, [reveal]);

  const takeFocusRequest = useCallback(() => {
    const wanted = focusRequestRef.current;
    focusRequestRef.current = false;
    return wanted;
  }, []);

  const close = useCallback(() => {
    // Закрыли изнутри — фокус обратно туда, откуда открыли (обычно кнопка дока).
    const inside = document.activeElement?.closest(`[${CHAT_PANEL_ATTR}]`);
    setOpen(false);
    setFirstUnreadId(null);
    if (inside && returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
  }, []);

  const toggle = useCallback(() => {
    playSfx(openRef.current ? "chat-close" : "chat-open");
    if (openRef.current) close();
    else openPanel();
  }, [openRef, close, openPanel]);

  const openPanelRef = useLatestRef(openPanel);
  const onIncoming = useCallback(
    (m: ChatMessage) => {
      const panelOpen = openRef.current;
      if (panelOpen && !isHidden()) return; // видно сразу
      if (pendingFirstRef.current === null) pendingFirstRef.current = m.id;
      setUnread((n) => n + 1);
      playSfx("chat");
      if (!panelOpen) {
        // Один тост на чат: следующее сообщение обновляет его на месте.
        toast({
          id: INCOMING_TOAST,
          title: m.from.name,
          description: preview(m.text),
          // Автор мог уже уйти — тогда голова только его цвета, без рисунка.
          person: toastPerson(
            room.getParticipantByIdentity(m.from.identity) ?? null,
            m.from.name,
            colorsRef.current.get(m.from.identity) ?? avatarColorIndex(m.from.name),
          ),
          action: { label: "Ответить", onClick: () => openPanelRef.current() },
        });
      }
    },
    [openRef, colorsRef, openPanelRef, room],
  );
  const feed = useChatFeed(onIncoming);

  // Вернулись во вкладку с открытым чатом — всё прочитано.
  useEffect(() => {
    const onVisible = () => {
      if (!isHidden() && openRef.current) markRead();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [openRef, markRead]);

  // Заголовок вкладки; при выходе из комнаты — прежний.
  useEffect(() => {
    const original = document.title;
    return () => {
      document.title = original;
    };
  }, []);
  useEffect(() => {
    document.title = roomTabTitle(title, unread);
  }, [title, unread]);

  const panel = useMemo<ChatPanel>(
    () => ({ open, unread, openPanel, show: reveal, close, toggle }),
    [open, unread, openPanel, reveal, close, toggle],
  );
  const view = useMemo<ChatView>(
    () => ({ ...feed, firstUnreadId, focusTick, takeFocusRequest, authors }),
    [feed, firstUnreadId, focusTick, takeFocusRequest, authors],
  );
  return (
    <ChatPanelContext value={panel}>
      <ChatViewContext value={view}>{children}</ChatViewContext>
    </ChatPanelContext>
  );
}

/**
 * Все, кого видели в комнате за этот вход, по identity — с цветом, который был
 * у них в комнате. Вышедший остаётся: его сообщения в чате не меняют голову
 * (атрибут с рисунком у вышедшего участника на месте) и цвет. Вернулся — новый
 * участник вместо прежнего. Обновляется только на вход, выход и смену ника.
 */
function useAuthors(
  people: readonly Participant[],
  colors: ReadonlyMap<string, number>,
): ReadonlyMap<string, ChatAuthor> {
  const [seen, setSeen] = useState(() => ({ colors, authors: addAuthors(new Map(), people, colors) }));
  if (seen.colors !== colors) setSeen({ colors, authors: addAuthors(seen.authors, people, colors) });
  return seen.authors;
}

function addAuthors(
  prev: ReadonlyMap<string, ChatAuthor>,
  people: readonly Participant[],
  colors: ReadonlyMap<string, number>,
): ReadonlyMap<string, ChatAuthor> {
  const next = new Map(prev);
  for (const p of people) next.set(p.identity, { p, colorIndex: colors.get(p.identity) ?? 0 });
  return next;
}

export function useChatPanel(): ChatPanel {
  const value = use(ChatPanelContext);
  if (!value) throw new Error("useChatPanel: нет ChatPanelProvider выше по дереву");
  return value;
}

/** Лента и отправка — для самой панели чата. */
export function useChatView(): ChatView {
  const value = use(ChatViewContext);
  if (!value) throw new Error("useChatView: нет ChatPanelProvider выше по дереву");
  return value;
}
