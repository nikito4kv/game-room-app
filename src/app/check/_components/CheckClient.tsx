"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import { TEST_FILES } from "../_lib/constants";
import { parseVoiceUrl, resolveTurnHost } from "../_lib/hosts";
import { collectNetInfo } from "../_lib/netinfo";
import {
  presentFile,
  presentHost,
  presentHttps,
  presentRelay,
  presentSrflx,
  presentTurn,
  presentWs,
} from "../_lib/present";
import { EMPTY_MANUAL, buildReport } from "../_lib/report";
import { runCheck } from "../_lib/run";
import type {
  CheckResults,
  FileResult,
  ManualFields,
  NetInfo,
  TurnResult,
  Verdict,
  VoiceResult,
  WebRtcResult,
} from "../_lib/types";
import { buildVerdict } from "../_lib/verdict";
import { ResultRow, type RowState } from "./ResultRow";
import { TrafficLight } from "./TrafficLight";

type Phase = "idle" | "running" | "done";
type Pending<T> = "pending" | "running" | T;

type Finished = { results: CheckResults; verdict: Verdict; net: NetInfo; at: Date; tzOffsetMinutes: number };

const CONNECTION_OPTIONS = [
  { value: "", label: "Не выбрано" },
  { value: "wired", label: "Проводной интернет" },
  { value: "wifi", label: "Wi-Fi" },
  { value: "mobile", label: "Мобильный интернет" },
];
const VPN_OPTIONS = [
  { value: "", label: "Не знаю" },
  { value: "no", label: "Нет, был выключен" },
  { value: "yes", label: "Да, был включён" },
];

function initialFiles(): Pending<FileResult>[] {
  return TEST_FILES.map(() => "pending");
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card padding="md" className="min-w-0">
      <h2 className="text-title text-ink">{title}</h2>
      {hint && <p className="mt-0.5 text-label text-ink-3">{hint}</p>}
      <ul className="mt-2 divide-y divide-line">{children}</ul>
    </Card>
  );
}

const noSubscribe = () => () => {};

/**
 * Экран проверки связи. Один запуск: сайт (тестовые файлы), сервер голоса, WebRTC.
 * Всё считается в браузере и нигде не сохраняется; итог человек копирует сам.
 */
export function CheckClient({ voiceUrl, turnDomain }: { voiceUrl: string | null; turnDomain: string | null }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [files, setFiles] = useState<Pending<FileResult>[]>(initialFiles);
  const [voice, setVoice] = useState<Pending<VoiceResult>>("pending");
  const [turn, setTurn] = useState<Pending<TurnResult>>("pending");
  const [webrtc, setWebrtc] = useState<Pending<WebRtcResult>>("pending");
  const [finished, setFinished] = useState<Finished | null>(null);
  const [manual, setManual] = useState<ManualFields>(EMPTY_MANUAL);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  // Адрес страницы известен только в браузере: на сервере и при гидратации пусто.
  const pageUrl = useSyncExternalStore(noSubscribe, () => window.location.origin + window.location.pathname, () => "");
  const siteHost = useSyncExternalStore(noSubscribe, () => window.location.host, () => "");

  const abortRef = useRef<AbortController | null>(null);
  const verdictRef = useRef<HTMLHeadingElement | null>(null);
  const reportRef = useRef<HTMLTextAreaElement | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const voiceHost = useMemo(() => parseVoiceUrl(voiceUrl)?.host ?? null, [voiceUrl]);
  const turnHost = useMemo(
    () => resolveTurnHost(parseVoiceUrl(voiceUrl)?.hostname, turnDomain),
    [voiceUrl, turnDomain],
  );

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const start = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase("running");
    setFiles(initialFiles());
    setVoice("pending");
    setTurn("pending");
    setWebrtc("pending");
    setFinished(null);
    setCopy("idle");
    const net = collectNetInfo();
    const results = await runCheck({
      origin: window.location.origin,
      voiceUrl,
      turnDomain,
      signal: ctrl.signal,
      handlers: {
        onFile: (i, state) => {
          if (!ctrl.signal.aborted) setFiles((prev) => prev.map((p, idx) => (idx === i ? state : p)));
        },
        onVoice: (state) => {
          if (!ctrl.signal.aborted) setVoice(state);
        },
        onTurn: (state) => {
          if (!ctrl.signal.aborted) setTurn(state);
        },
        onWebRtc: (state) => {
          if (!ctrl.signal.aborted) setWebrtc(state);
        },
      },
    });
    if (ctrl.signal.aborted) return;
    const at = new Date();
    setFinished({ results, verdict: buildVerdict(results), net, at, tzOffsetMinutes: at.getTimezoneOffset() });
    setPhase("done");
  }, [voiceUrl, turnDomain]);

  // Итог появился: переводим на него фокус, чтобы скринридер прочитал вывод.
  useEffect(() => {
    if (phase === "done") verdictRef.current?.focus();
  }, [phase]);

  const report = useMemo(
    () =>
      finished
        ? buildReport({
            results: finished.results,
            verdict: finished.verdict,
            net: finished.net,
            at: finished.at,
            tzOffsetMinutes: finished.tzOffsetMinutes,
            pageUrl,
            manual,
          })
        : "",
    [finished, manual, pageUrl],
  );

  const copyReport = useCallback(async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(report);
      ok = true;
    } catch {
      // Нет доступа к буферу (http, запрет браузера): пробуем старым способом.
      const ta = reportRef.current;
      if (ta) {
        ta.focus();
        ta.select();
        try {
          ok = document.execCommand("copy");
        } catch {
          ok = false;
        }
      }
    }
    setCopy(ok ? "copied" : "failed");
    if (copyTimer.current) clearTimeout(copyTimer.current);
    if (ok) copyTimer.current = setTimeout(() => setCopy("idle"), 2500);
    else reportRef.current?.select();
  }, [report]);

  const siteState = (i: number): RowState => {
    const f = files[i];
    return typeof f === "string" ? f : presentFile(f);
  };
  const voiceView = (pick: (v: VoiceResult) => ReturnType<typeof presentHttps>): RowState =>
    typeof voice === "string" ? voice : pick(voice);
  const turnView = (pick: (t: TurnResult) => ReturnType<typeof presentTurn>): RowState =>
    typeof turn === "string" ? turn : pick(turn);
  const rtcView = (pick: (w: WebRtcResult) => ReturnType<typeof presentHost>): RowState =>
    typeof webrtc === "string" ? webrtc : pick(webrtc);

  const running = phase === "running";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-balance font-brand text-heading text-ink sm:text-display">Проверка связи</h1>
        <p className="mt-3 max-w-[56ch] text-pretty text-body-lg text-ink-2">
          Нажмите одну кнопку. Через минуту станет понятно, открывается ли Game Room и слышно ли голос из вашей сети.
          Результат вы скопируете и пришлёте тому, кто вас попросил.
        </p>
      </div>

      {phase === "idle" && (
        <Card padding="lg" radius="panel" className="flex flex-col gap-5">
          <div>
            <h2 className="text-title text-ink">Что проверим</h2>
            <ol className="mt-3 flex flex-col gap-2.5 text-body text-ink-2">
              <li>
                <span className="font-medium text-ink">Сайт{siteHost ? ` (${siteHost})` : ""}.</span> Скачаем четыре
                тестовых файла, самый большой 1 МБ.
              </li>
              <li>
                <span className="font-medium text-ink">Сервер голоса{voiceHost ? ` (${voiceHost})` : ""}.</span> Попробуем
                с ним связаться.
              </li>
              <li>
                <span className="font-medium text-ink">Запасной канал{turnHost ? ` (${turnHost})` : ""}.</span> Проверим,
                что до него доходит защищённое соединение.
              </li>
              <li>
                <span className="font-medium text-ink">Связь для звука.</span> Проверим, отвечает ли наш сервер по UDP:
                так идёт голос.
              </li>
            </ol>
          </div>
          <InlineAlert tone="info" title="Перед запуском">
            Если включён VPN или обход блокировок, выключите его на время проверки. Лучше проверять из той сети, где вы
            обычно играете.
          </InlineAlert>
          <div className="flex flex-col gap-3">
            <Button variant="primary" size="lg" block onClick={start}>
              Проверить связь
            </Button>
            <p className="text-caption text-ink-3">
              Страница обращается только к нашему сайту и нашему серверу голоса. В отчёт попадут браузер, язык,
              часовой пояс и данные о соединении, которые даёт сам браузер. IP-адрес и провайдера страница не
              собирает, результат нигде не сохраняется.
            </p>
            <p className="text-caption text-ink-3">
              Если страница грузится очень долго или кнопка не нажимается, это тоже результат: напишите, что видите.
            </p>
          </div>
        </Card>
      )}

      {running && (
        <Card padding="md" tone="outline" className="flex items-center gap-3" role="status">
          <Button variant="primary" size="md" loading disabled aria-label="Идёт проверка">
            Проверяем
          </Button>
          <p className="text-label text-ink-2">Это займёт до минуты. Вкладку не закрывайте.</p>
        </Card>
      )}

      {phase === "done" && finished && (
        <>
          <Card padding="lg" radius="panel" className="flex flex-col gap-4" data-testid="check-verdict" data-level={finished.verdict.level}>
            <div className="flex items-center gap-4">
              <TrafficLight level={finished.verdict.level} />
              <div className="min-w-0">
                <p className="text-label text-ink-3">Итог проверки</p>
                <h2
                  ref={verdictRef}
                  tabIndex={-1}
                  className="text-balance font-brand text-heading text-ink outline-none"
                >
                  {finished.verdict.title}
                </h2>
              </div>
            </div>
            <div>
              <p className="text-label font-medium text-ink-3">Что это значит</p>
              <ul className="mt-2 flex flex-col gap-2 text-body text-ink-2">
                {finished.verdict.lines.map((line) => (
                  <li key={line} className="text-pretty">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          <Card padding="lg" radius="panel" className="flex flex-col gap-4">
            <div>
              <h2 className="text-title text-ink">Отправьте отчёт</h2>
              <p className="mt-1 text-label text-ink-3">
                Впишите, что знаете (необязательно), нажмите «Копировать отчёт» и пришлите текст тому, кто вас попросил.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Провайдер и город"
                placeholder="Например, Ростелеком, Казань"
                autoComplete="off"
                wrapperClassName="sm:col-span-2"
                value={manual.provider}
                onChange={(e) => setManual((m) => ({ ...m, provider: e.target.value }))}
              />
              <Select
                label="Способ подключения"
                options={CONNECTION_OPTIONS}
                value={manual.connection}
                onChange={(e) => setManual((m) => ({ ...m, connection: e.target.value as ManualFields["connection"] }))}
              />
              <Select
                label="VPN был включён?"
                options={VPN_OPTIONS}
                value={manual.vpn}
                onChange={(e) => setManual((m) => ({ ...m, vpn: e.target.value as ManualFields["vpn"] }))}
              />
              <TextField
                label="Что ещё заметили"
                placeholder="Например, сайт грузился долго"
                autoComplete="off"
                wrapperClassName="sm:col-span-2"
                value={manual.note}
                onChange={(e) => setManual((m) => ({ ...m, note: e.target.value }))}
              />
            </div>
            <textarea
              ref={reportRef}
              readOnly
              rows={14}
              value={report}
              aria-label="Текст отчёта"
              onFocus={(e) => e.currentTarget.select()}
              className="w-full resize-y rounded-card border border-line-strong bg-sunken px-3 py-2.5 font-code text-caption text-ink-2 focus-visible:border-line-control"
              data-testid="check-report"
            />
            {copy === "failed" && (
              <InlineAlert tone="caution" title="Само не скопировалось">
                Текст выделен. Нажмите Ctrl+C, а на телефоне задержите палец на тексте и выберите «Копировать».
              </InlineAlert>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="primary"
                size="lg"
                icon={copy === "copied" ? "check" : "copy"}
                onClick={copyReport}
                className="sm:flex-1"
                data-testid="check-copy"
              >
                {copy === "copied" ? "Скопировано" : "Копировать отчёт"}
              </Button>
              <Button variant="secondary" size="lg" icon="refresh" onClick={start} className="sm:flex-1">
                Проверить ещё раз
              </Button>
            </div>
          </Card>
        </>
      )}

      {phase !== "idle" && (
        <>
          <Section title="Сайт" hint={`Имя: ${siteHost || "наш сайт"}. Скачиваем тестовые файлы`}>
            {TEST_FILES.map((f, i) => (
              <ResultRow key={f.id} title={`Файл ${f.label}`} state={siteState(i)} />
            ))}
          </Section>
          <Section title="Сервер голоса" hint={voiceHost ? `Имя: ${voiceHost}` : "Адрес в этой сборке сайта не задан"}>
            <ResultRow title="Ответ по HTTPS" state={voiceView(presentHttps)} />
            <ResultRow title="WebSocket (так клиент входит в комнату)" state={voiceView(presentWs)} />
          </Section>
          <Section title="Запасной канал (TURN)" hint={turnHost ? `Имя: ${turnHost}, защищённое соединение на порту 443` : "Имя в этой сборке не задано"}>
            <ResultRow title="Ответ по TLS на 443" state={turnView(presentTurn)} />
          </Section>
          <Section title="Связь для звука (WebRTC)" hint="Спрашиваем наш сервер по UDP, как это делает голос">
            <ResultRow title="Адреса вашего устройства" state={rtcView(presentHost)} />
            <ResultRow title="Ответ нашего сервера по UDP" state={rtcView(presentSrflx)} />
            <ResultRow title="Канал через TURN" state={webrtc === "pending" ? "pending" : presentRelay()} />
          </Section>
        </>
      )}

      {phase === "done" && finished && (
        <Card padding="md" tone="ghost">
          <h2 className="text-title text-ink">Сведения о вашем браузере</h2>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-label">
            <dt className="text-ink-3">Браузер</dt>
            <dd className="text-ink-2">{finished.net.browser}</dd>
            <dt className="text-ink-3">Язык</dt>
            <dd className="text-ink-2">{finished.net.language || "неизвестно"}</dd>
            <dt className="text-ink-3">Часовой пояс</dt>
            <dd className="text-ink-2">{finished.net.timeZone || "неизвестно"}</dd>
            <dt className="text-ink-3">Соединение</dt>
            <dd className="text-ink-2">{finished.net.connection ?? "браузер не сообщает"}</dd>
          </dl>
          <p className="mt-2 text-caption text-ink-3">IP-адрес и провайдер не собираются: их можно вписать выше самим.</p>
        </Card>
      )}
    </div>
  );
}
