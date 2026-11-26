"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, ChoiceGroup, Dialog, Icon, InlineAlert } from "@/components/ui";
import { TextAreaField } from "@/components/marketing/TextAreaField";
import { REPORT_REASONS, type ReportReason } from "@/lib/api/platform";
import { sendReport } from "@/lib/client/api";
import { isApiError } from "@/lib/client/errors";
import { useRoomSession } from "../state/RoomSession";
import { closeReport, useReportState, type ReportTarget } from "./reportStore";

/** Комментарий к жалобе, символов (как на сервере). */
const NOTE_MAX = 500;

const REASONS = (Object.keys(REPORT_REASONS) as ReportReason[]).map((r) => ({ value: r, title: REPORT_REASONS[r] }));

/**
 * «Пожаловаться» (А2): на человека или на всю комнату. Причина, комментарий до
 * 500 символов, отправка с токеном участника — сервер сам приложит снимок чата.
 * После отправки — «Спасибо» и что делать прямо сейчас. Ставится один раз в
 * корне комнаты (окно живёт в top layer).
 */
export default function ReportDialog() {
  const { open, target, session } = useReportState();
  // Ушли из комнаты — окно не должно пережить её.
  useEffect(() => closeReport, []);
  return <ReportForm key={session} open={open} target={target} />;
}

function ReportForm({ open, target }: { open: boolean; target: ReportTarget }) {
  const { code, token } = useRoomSession();
  const [reason, setReason] = useState<ReportReason | "">("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState(false);
  const [done, setDone] = useState(false);
  const doneRef = useRef<HTMLDivElement>(null);
  const tooLong = [...note].length > NOTE_MAX;

  async function submit() {
    if (sending) return;
    if (!reason) {
      setReasonError(true);
      return;
    }
    if (tooLong) return;
    setSending(true);
    setError(null);
    try {
      await sendReport({
        code,
        token,
        reason,
        ...(target ? { targetIdentity: target.identity } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setDone(true);
      requestAnimationFrame(() => doneRef.current?.focus());
    } catch (err) {
      setError(isApiError(err) ? err.message : "Не получилось отправить жалобу. Попробуйте ещё раз");
    } finally {
      setSending(false);
    }
  }

  const title = done ? "Спасибо, жалоба отправлена" : target ? `Пожаловаться на ${target.name}` : "Пожаловаться на комнату";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeReport();
      }}
      title={title}
      description={
        done
          ? undefined
          : target
            ? "Администрация Game Room посмотрит последние сообщения чата и решит, что делать. Кто пожаловался, человек не узнает."
            : "Если в комнате нарушают правила, администрация Game Room посмотрит последние сообщения чата и решит, что делать."
      }
      size="md"
      dismissible={!sending}
      data-testid="report-dialog"
      footer={
        done ? (
          <Button variant="primary" onClick={closeReport}>
            Понятно
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={closeReport} disabled={sending}>
              Отмена
            </Button>
            <Button variant="danger" loading={sending} onClick={() => void submit()} data-testid="report-submit">
              Отправить жалобу
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div ref={doneRef} tabIndex={-1} role="status" className="flex flex-col gap-3 outline-none">
          <p className="flex items-start gap-2.5 text-body-lg text-ink">
            <Icon name="check-circle" size={20} className="mt-0.5 shrink-0 text-signal-ink" />
            Мы получили жалобу и разберёмся. Ответа ждать не нужно: если нарушение подтвердится, администрация примет меры.
          </p>
          <p className="text-body text-ink-2">
            {target
              ? "Если человек мешает прямо сейчас, заглушите его для себя в его панели или попросите хоста выгнать его."
              : "Если оставаться в комнате неприятно, просто выйдите — это всегда можно."}
          </p>
        </div>
      ) : (
        <form
          className="flex flex-col gap-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {error && (
            <InlineAlert tone="alert" title="Жалоба не ушла">
              {error}
            </InlineAlert>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-label font-medium text-ink-2">Что случилось</span>
            <ChoiceGroup
              label="Причина жалобы"
              value={reason as ReportReason}
              onValueChange={(v) => {
                setReason(v);
                setReasonError(false);
              }}
              columns={2}
              options={REASONS}
            />
            {reasonError && (
              <p className="flex items-start gap-1.5 text-caption text-alert-ink" role="alert">
                <Icon name="alert-circle" size={14} className="mt-px shrink-0" />
                Выберите причину
              </p>
            )}
          </div>
          <TextAreaField
            label="Подробности"
            hint="Необязательно. Что именно и когда — так разберёмся быстрее."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={NOTE_MAX}
            error={tooLong ? `Не больше ${NOTE_MAX} символов` : undefined}
          />
          <p className="text-caption text-ink-3">
            К жалобе приложатся последние сообщения чата комнаты. Голос не записывается.{" "}
            <Link href="/rules" target="_blank" rel="noopener" className="text-ink-2 underline underline-offset-4 hover:text-ink">
              Правила сервиса
            </Link>
          </p>
        </form>
      )}
    </Dialog>
  );
}
