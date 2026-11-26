"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import { IconButton } from "@/components/ui/IconButton";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { Logo } from "@/components/ui/Logo";
import { Skeleton } from "@/components/ui/Spinner";
import { StateScreen } from "@/components/ui/StateScreen";
import { LEAD_PRODUCTS, type LeadMessage, type LeadThreadPublic } from "@/lib/api/platform";
import { getLeadThread, replyToLead } from "@/lib/client/api";
import { isAbortError, isApiError } from "@/lib/client/errors";
import { LEAD_FORM_LIMITS } from "@/lib/client/leadForm";
import { formatLeadTime, leadStatusText, tokenFromSearch } from "@/lib/client/leadThread";
import { findMyLeadToken, getMyLeads, leadLink, rememberMyLead } from "@/lib/client/myLeads";

/** Как часто проверяем новые ответы, пока страница открыта и видна. */
const POLL_MS = 30_000;

type Problem =
  /** В адресе нет токена и в этом браузере заявка не сохранена. */
  | { kind: "noToken" }
  /** Заявки нет или токен не подходит. */
  | { kind: "notFound" }
  /** Сеть, сервер, функция выключена — можно повторить. */
  | { kind: "error"; message: string };

type Load =
  | { status: "loading" }
  /** at — когда пришёл ответ (для «сегодня / вчера» у времени сообщений). */
  | { status: "ready"; thread: LeadThreadPublic; at: number }
  | { status: "problem"; problem: Problem };

const noSubscribe = () => () => {};

/**
 * Переписка по заявке: пузыри «вы / команда», статус, поле ответа. Обновляется
 * раз в 30 с и при возврате на вкладку. Токен — из ?t= или из «моих заявок»
 * этого браузера; открыли ссылку на новом устройстве — запоминаем и здесь.
 */
export default function RequestClient({ id }: { id: string }) {
  // Токен читаем только в браузере (undefined — ещё на сервере): адреса с ?t= там нет.
  const token = useSyncExternalStore(
    noSubscribe,
    () => tokenFromSearch(window.location.search) ?? findMyLeadToken(id),
    () => undefined,
  );
  const [fetched, setLoad] = useState<Load>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const load: Load = token === null ? { status: "problem", problem: { kind: "noToken" } } : fetched;

  const fetchThread = useCallback(
    (signal: AbortSignal, quiet: boolean) => {
      if (!token) return;
      getLeadThread(id, token, signal).then(
        (thread) => {
          setLoad({ status: "ready", thread, at: Date.now() });
          // Открыли по ссылке на этом устройстве впервые — запоминаем для метки в шапке.
          if (!getMyLeads().some((l) => l.id === id)) {
            rememberMyLead({
              id,
              t: token,
              url: `/request/${encodeURIComponent(id)}?t=${encodeURIComponent(token)}`,
              product: thread.product ?? null,
              createdAt: Date.parse(thread.createdAt) || Date.now(),
            });
          }
        },
        (err: unknown) => {
          if (isAbortError(err)) return;
          // Фоновое обновление не ломает уже показанную переписку.
          if (quiet) return;
          if (isApiError(err) && (err.code === "LEAD_NOT_FOUND" || err.status === 404 || err.code === "UNAUTHORIZED")) {
            setLoad({ status: "problem", problem: { kind: "notFound" } });
          } else {
            setLoad({
              status: "problem",
              problem: { kind: "error", message: isApiError(err) ? err.message : "Не получилось загрузить заявку" },
            });
          }
        },
      );
    },
    [id, token],
  );

  // Первая загрузка и «Попробовать снова».
  useEffect(() => {
    if (!token) return;
    const ctrl = new AbortController();
    fetchThread(ctrl.signal, false);
    return () => ctrl.abort();
  }, [token, reloadKey, fetchThread]);

  // Опрос раз в 30 с и при возврате на вкладку.
  const ready = load.status === "ready";
  useEffect(() => {
    if (!token || !ready) return;
    let ctrl: AbortController | null = null;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      ctrl?.abort();
      ctrl = new AbortController();
      fetchThread(ctrl.signal, true);
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      ctrl?.abort();
    };
  }, [token, ready, fetchThread]);

  return (
    <main className="mx-auto w-full max-w-[760px] flex-1 px-5 pb-16 pt-6 lg:pt-10">
      {load.status === "problem" ? (
        <ProblemScreen
          problem={load.problem}
          onRetry={() => {
            setLoad({ status: "loading" });
            setReloadKey((k) => k + 1);
          }}
        />
      ) : load.status === "loading" || !token ? (
        <ThreadSkeleton />
      ) : (
        <Thread
          thread={load.thread}
          at={load.at}
          token={token}
          onUpdate={(thread) => setLoad({ status: "ready", thread, at: Date.now() })}
        />
      )}
    </main>
  );
}

function ProblemScreen({ problem, onRetry }: { problem: Problem; onRetry: () => void }) {
  const home = (
    <Link href="/" className={buttonClass({ variant: "ghost", block: true })}>
      На главную
    </Link>
  );
  if (problem.kind === "noToken") {
    return (
      <div className="grid place-items-center py-10">
        <StateScreen
          icon="link"
          title="Нужна полная ссылка"
          actions={
            <>
              <Link href="/pricing" className={buttonClass({ variant: "primary", size: "lg", block: true })}>
                Написать новую заявку
              </Link>
              {home}
            </>
          }
        >
          Переписка открывается только по личной ссылке, которую вы получили после отправки заявки. Откройте её
          целиком, вместе с частью после «?t=».
        </StateScreen>
      </div>
    );
  }
  if (problem.kind === "notFound") {
    return (
      <div className="grid place-items-center py-10">
        <StateScreen
          icon="search"
          tone="caution"
          title="Нет доступа к заявке"
          actions={
            <>
              <Link href="/pricing" className={buttonClass({ variant: "primary", size: "lg", block: true })}>
                Написать новую заявку
              </Link>
              {home}
            </>
          }
        >
          Ссылка неверная или неполная, или заявку удалили по просьбе. Проверьте, что скопировали ссылку целиком.
        </StateScreen>
      </div>
    );
  }
  return (
    <div className="grid place-items-center py-10">
      <StateScreen
        icon="wifi-off"
        tone="alert"
        title="Заявка не загрузилась"
        actions={
          <>
            <Button variant="primary" size="lg" block icon="refresh" onClick={onRetry}>
              Попробовать снова
            </Button>
            {home}
          </>
        }
      >
        {problem.message}
      </StateScreen>
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Загружаем заявку">
      <Skeleton className="h-9 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="mt-4 h-20 w-4/5 self-end rounded-panel" />
      <Skeleton className="h-16 w-3/5 rounded-panel" />
      <Skeleton className="mt-4 h-28 w-full" />
    </div>
  );
}

function Thread({
  thread,
  at,
  token,
  onUpdate,
}: {
  thread: LeadThreadPublic;
  at: number;
  token: string;
  onUpdate: (t: LeadThreadPublic) => void;
}) {
  const status = leadStatusText(thread.status);
  const now = new Date(at);
  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const product = LEAD_PRODUCTS[thread.product] ?? "Заявка";
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(leadLink(window.location.origin, thread.id, token));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-6" data-testid="lead-thread">
      <header className="flex flex-col gap-3">
        <p className="text-label text-ink-3">Ваша заявка · {product}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-balance font-brand text-display text-ink">Переписка с командой</h1>
          <Badge tone={status.tone === "neutral" ? "neutral" : status.tone} variant="soft">
            {status.label}
          </Badge>
        </div>
        <p className="max-w-[60ch] text-pretty text-body-lg text-ink-2">{status.hint}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-label text-ink-3">
          <span>Отправлена {formatLeadTime(thread.createdAt, now)}</span>
          <button
            type="button"
            onClick={() => void copyLink()}
            className="inline-flex items-center gap-1.5 rounded-item text-ink-2 underline underline-offset-4 hover:text-ink"
          >
            {copied ? "Ссылка скопирована" : "Скопировать личную ссылку"}
          </button>
        </div>
      </header>

      <ol className="flex flex-col gap-3" aria-label="Сообщения" aria-live="polite">
        {messages.map((m, i) => (
          <Bubble key={`${m.at}-${i}`} message={m} name={thread.name} now={now} />
        ))}
      </ol>

      <Composer id={thread.id} token={token} onUpdate={onUpdate} closed={thread.status === "closed"} />

      <p className="text-caption text-ink-3">
        Страница обновляется сама. Ответ команды появится здесь, а на остальных страницах сайта вверху будет метка «Есть
        ответ на заявку». Мы не просим оплату и пароли в переписке.
      </p>
    </div>
  );
}

function Bubble({ message, name, now }: { message: LeadMessage; name: string; now: Date }) {
  const mine = message.from === "user";
  return (
    <li className={cn("flex max-w-[85%] flex-col gap-1", mine ? "self-end items-end" : "self-start items-start")} data-from={message.from}>
      <span className="flex items-center gap-1.5 px-1 text-caption text-ink-3">
        {!mine && <Logo variant="mark" height={14} title="" className="text-ink-2" />}
        <span className={cn(!mine && "font-medium text-ink-2")}>{mine ? name || "Вы" : "Команда Game Room"}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={message.at}>{formatLeadTime(message.at, now)}</time>
      </span>
      <p
        className={cn(
          "whitespace-pre-wrap rounded-panel px-4 py-2.5 text-body-lg [overflow-wrap:anywhere]",
          mine ? "rounded-br-key bg-wash-2 text-ink" : "rounded-bl-key border border-line bg-raised text-ink",
        )}
      >
        {message.text}
      </p>
    </li>
  );
}

function Composer({
  id,
  token,
  onUpdate,
  closed,
}: {
  id: string;
  token: string;
  onUpdate: (t: LeadThreadPublic) => void;
  closed: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const count = [...draft].length;
  const tooLong = count > LEAD_FORM_LIMITS.messageMax;

  async function send() {
    const text = draft.trim();
    if (!text || sending || tooLong) return;
    setSending(true);
    setError(null);
    try {
      const thread = await replyToLead(id, token, text);
      onUpdate(thread);
      setDraft("");
    } catch (err) {
      setError(isApiError(err) ? err.message : "Не получилось отправить. Попробуйте ещё раз");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd+Enter — отправить; просто Enter — новая строка (письмо, а не чат).
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <Card padding="md" className="flex flex-col gap-3">
      {closed && (
        <InlineAlert tone="info">Заявка закрыта, но написать всё ещё можно: мы увидим новое сообщение.</InlineAlert>
      )}
      {error && <InlineAlert tone="alert" title="Сообщение не ушло">{error}</InlineAlert>}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="lead-reply" className="text-label font-medium text-ink-2">
          Дописать
        </label>
        <div className="flex items-end gap-2 rounded-card border border-line-strong bg-sunken p-1.5 pl-3 focus-within:border-focus">
          <textarea
            ref={inputRef}
            id="lead-reply"
            data-testid="lead-reply"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Вопрос, уточнение, удобное время…"
            className="max-h-60 min-h-12 flex-1 resize-none bg-transparent py-1.5 text-body-lg text-ink outline-0 [field-sizing:content] placeholder:text-ink-3 focus-visible:outline-0"
          />
          <IconButton
            icon="send"
            label="Отправить"
            shortcut="Ctrl+Enter"
            variant="soft"
            type="submit"
            loading={sending}
            disabled={!draft.trim() || tooLong}
          />
        </div>
        <p className="flex justify-between gap-3 text-caption text-ink-3">
          <span>Ctrl+Enter — отправить</span>
          <span className={cn("tabular-nums", tooLong && "text-alert-ink")}>
            {count}/{LEAD_FORM_LIMITS.messageMax}
          </span>
        </p>
      </form>
    </Card>
  );
}
