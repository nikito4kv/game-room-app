"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useConnectionState } from "@livekit/components-react";
import { ConnectionState, type Participant } from "livekit-client";
import { CHAT_MAX_LENGTH } from "@/lib/api/contract";
import { EmptyState, Icon, IconButton, avatarColorIndex, avatarColorVar, cn } from "@/components/ui";
import {
  formatChatTime,
  groupEntries,
  splitLinks,
  type ChatEntry,
  type ChatGroup,
} from "@/lib/client/chat";
import { PersonHead } from "../feed/PersonHead";
import { useRoomLink } from "../state/RoomSession";
import { useRoomConfig } from "../state/useRoomConfig";
import { useMyPermissions } from "../state/useRoomMeta";
import { useChatPanel, useChatView } from "./useChatPanel";

/**
 * Панель чата. Где стоит, решают её же классы (как в макете): ≥ 1024 — колонка
 * справа 360 px, 640–1023 — панель поверх комнаты справа, < 640 — секция под
 * списком участников. Закрыта — не рисуется (лента копится в ChatPanelProvider).
 */
export default function RoomChat() {
  const { open } = useChatPanel();
  if (!open) return null;
  return <OpenChat />;
}

function OpenChat() {
  const { close } = useChatPanel();
  const { entries, myIdentity, send, retry, firstUnreadId, focusTick, takeFocusRequest, authors } = useChatView();
  const connected = useConnectionState() === ConnectionState.Connected;
  const { reconnecting } = useRoomLink();
  const perms = useMyPermissions();
  // Чат выключен администрацией (флаг chat, А3): писать нельзя, читать — можно.
  const { flags } = useRoomConfig();
  const canChat = perms.canChat && flags.chat;
  const chatHint = flags.chat ? perms.chatHint : "Чат временно выключен администрацией";
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  // Лента прилипает к низу, только если человек уже у дна (иначе он читает выше).
  const stickRef = useRef(true);

  const groups = useMemo(
    () => groupEntries(entries, myIdentity, firstUnreadId),
    [entries, myIdentity, firstUnreadId],
  );

  const blocked = !connected || !canChat;
  const placeholder = !connected
    ? reconnecting
      ? "Переподключаемся…"
      : "Подключаемся…"
    : canChat
      ? "Написать всем в комнате"
      : "Сейчас писать нельзя";

  // Открыли — к первому непрочитанному (или в самый низ).
  useLayoutEffect(() => {
    const log = logRef.current;
    const divider = dividerRef.current;
    if (log && divider) log.scrollTop = Math.max(0, divider.offsetTop - 16);
    else if (log) log.scrollTop = log.scrollHeight;
    // Только при открытии: дальше ленту двигает автоскролл.
  }, []);

  // Фокус в поле — только если чат открыли руками (док, Enter, «Ответить»),
  // в том числе уже открытый. Показанный раскладкой чат фокус не забирает:
  // на телефоне это подняло бы клавиатуру сразу при входе.
  useLayoutEffect(() => {
    if (takeFocusRequest()) inputRef.current?.focus({ preventScroll: true });
  }, [focusTick, takeFocusRequest]);

  // Новое сообщение — вниз, если человек был у дна.
  useEffect(() => {
    const log = logRef.current;
    if (log && stickRef.current) log.scrollTop = log.scrollHeight;
  }, [entries]);

  const submit = () => {
    if (blocked || !draft.trim()) return;
    send(draft);
    setDraft("");
    stickRef.current = true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <aside
      // CHAT_PANEL_ATTR: по нему провайдер понимает, что фокус внутри чата.
      data-chat-panel=""
      aria-label="Чат комнаты"
      data-testid="chat-panel"
      onKeyDown={onKeyDown}
      className={cn(
        "flex flex-col bg-raised",
        "lg:w-[360px] lg:shrink-0 lg:border-l lg:border-line",
        "sm:max-lg:absolute sm:max-lg:inset-y-0 sm:max-lg:right-0 sm:max-lg:z-[var(--gr-z-drawer)] sm:max-lg:w-[min(400px,100%)] sm:max-lg:border-l sm:max-lg:border-line sm:max-lg:shadow-dialog",
        "max-sm:min-h-0 max-sm:flex-1 max-sm:border-t max-sm:border-line",
      )}
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line pl-4 pr-2">
        <h2 className="text-title text-ink">Чат</h2>
        {/* На узком чат — секция под списком: его не закрывают, а сворачивают. */}
        <IconButton
          icon="x"
          label="Закрыть чат"
          shortcut="Esc"
          size="sm"
          onClick={close}
          wrapperClassName="max-sm:hidden"
        />
        <IconButton
          icon="chevron-down"
          label="Свернуть чат"
          shortcut="Esc"
          size="sm"
          onClick={close}
          wrapperClassName="sm:hidden"
        />
      </header>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Сообщения"
        onScroll={() => {
          const el = logRef.current;
          if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
        }}
        className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
      >
        {groups.length === 0 ? (
          <EmptyState
            size="sm"
            icon="chat"
            title="Пока тихо"
            description={
              canChat ? "Напишите первым: сообщение увидят все в комнате." : "Сообщения появятся здесь."
            }
            className="my-auto"
          />
        ) : (
          groups.map((g) => (
            <div key={g.key}>
              {g.key === firstUnreadId && (
                <div
                  ref={dividerRef}
                  className="mb-4 flex items-center gap-3 text-caption font-medium text-alert-ink"
                >
                  <span className="h-px flex-1 bg-alert-ink/35" />
                  Новые
                  <span className="h-px flex-1 bg-alert-ink/35" />
                </div>
              )}
              <MessageGroup
                group={g}
                author={authors.get(g.from.identity)?.p ?? null}
                colorIndex={authors.get(g.from.identity)?.colorIndex ?? avatarColorIndex(g.from.name)}
                onRetry={retry}
              />
            </div>
          ))
        )}
      </div>

      <form
        className="shrink-0 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div
          className={cn(
            "flex items-end gap-2 rounded-card border border-line-strong bg-sunken p-1.5 pl-3 focus-within:border-focus",
            blocked && "opacity-60",
          )}
        >
          <textarea
            ref={inputRef}
            data-testid="chat-input"
            rows={1}
            maxLength={CHAT_MAX_LENGTH}
            value={draft}
            disabled={blocked}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter — отправить, Shift+Enter — новая строка; набор через IME не прерываем.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={placeholder}
            aria-label="Сообщение"
            className="max-h-32 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-body-lg text-ink outline-0 [field-sizing:content] placeholder:text-ink-3 focus-visible:outline-0 disabled:cursor-not-allowed"
          />
          <IconButton
            data-testid="chat-send"
            icon="send"
            label="Отправить"
            shortcut="Enter"
            variant="soft"
            size="sm"
            type="submit"
            disabled={blocked || !draft.trim()}
          />
        </div>
        {connected && chatHint && (
          <p className="mt-2 flex items-center gap-1.5 text-caption text-ink-3" role="status" data-testid="chat-blocked">
            <Icon name="chat-off" size={14} className="shrink-0" />
            {chatHint}
          </p>
        )}
      </form>
    </aside>
  );
}

/**
 * Группа сообщений одного автора: голова (как его место за столом), имя его
 * цветом, время, строки. author — участник, если мы его застали (в том числе
 * уже вышедший): голова с его рисунком; не застали — только цвет.
 */
const MessageGroup = memo(function MessageGroup({
  group,
  author,
  colorIndex,
  onRetry,
}: {
  group: ChatGroup;
  author: Participant | null;
  colorIndex: number;
  onRetry: (id: string) => void;
}) {
  const first = group.entries[0];
  // Администрация сервиса: выделенная плашка, а не обычный участник. Подделать
  // нельзя — пометку system ставит только сервер.
  if (group.system) {
    return (
      <div className="rounded-card border border-caution/30 bg-caution-wash px-3 py-2.5" data-testid="chat-system">
        <div className="flex items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-caution text-on-caution">
            <Icon name="shield" size={14} />
          </span>
          <span className="text-body font-semibold text-ink">Администрация</span>
          <span className="text-caption text-ink-3">Game Room</span>
          <time
            className="ml-auto shrink-0 text-caption tabular-nums text-ink-3"
            dateTime={new Date(first.ts).toISOString()}
          >
            {formatChatTime(first.ts)}
          </time>
        </div>
        {group.entries.map((e) => (
          <Message key={e.id} entry={e} onRetry={onRetry} />
        ))}
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <PersonHead p={author} name={group.from.name} colorIndex={colorIndex} size="sm" surface="raised" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-body font-semibold" style={{ color: avatarColorVar(colorIndex) }}>
            {group.from.name}
          </span>
          <time className="shrink-0 text-caption tabular-nums text-ink-3" dateTime={new Date(first.ts).toISOString()}>
            {formatChatTime(first.ts)}
          </time>
        </div>
        {group.entries.map((e) => (
          <Message key={e.id} entry={e} onRetry={onRetry} />
        ))}
      </div>
    </div>
  );
});

function Message({ entry, onRetry }: { entry: ChatEntry; onRetry: (id: string) => void }) {
  const parts = useMemo(() => splitLinks(entry.text), [entry.text]);
  return (
    <p
      data-testid="chat-message"
      data-state={entry.state}
      className={cn(
        "mt-0.5 whitespace-pre-wrap text-body-lg [overflow-wrap:anywhere]",
        entry.state === "sent" ? "text-ink" : entry.state === "pending" ? "text-ink-2" : "text-ink-3",
      )}
    >
      {parts.map((part, i) =>
        part.kind === "link" ? (
          <a
            key={i}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
          >
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
      {entry.state === "failed" && (
        <span className="mt-1 flex items-start gap-1.5 text-caption text-alert-ink">
          <Icon name="alert-circle" size={14} className="mt-px shrink-0" />
          <span>
            Не отправлено{entry.error ? `: ${entry.error}` : ""} ·{" "}
            <button
              type="button"
              onClick={() => onRetry(entry.id)}
              className="font-medium underline underline-offset-2 hover:text-ink"
            >
              Повторить
            </button>
          </span>
        </span>
      )}
    </p>
  );
}
