"use client";

import { useRef, useState, type ReactNode } from "react";
import type { ChatPolicy, RoomPublicMeta, ScreenPolicy } from "@/lib/api/contract";
import {
  Button,
  Dialog,
  SegmentedControl,
  SettingRow,
  Switch,
  TextField,
  toast,
} from "@/components/ui";
import { passwordProblem } from "@/lib/client/roomSettings";
import { useModeration } from "../state/useModeration";
import BanList from "./BanList";
import {
  finishChange,
  patchOf,
  settingsFromMeta,
  shownSettings,
  startChange,
  type InstantField,
  type InstantSettings,
  type SettingsDraft,
} from "./instantSettings";

const SCREEN_OPTIONS: { value: ScreenPolicy; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "approved", label: "По разрешению" },
  { value: "host", label: "Только хост" },
];

const CHAT_OPTIONS: { value: ChatPolicy; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "host", label: "Только хост" },
  { value: "off", label: "Выключен" },
];

const SCREEN_HINT: Record<ScreenPolicy, string> = {
  all: "Показать экран может любой.",
  approved: "Хост разрешает показ в меню участника.",
  host: "Показывать экран можете только вы.",
};

const CHAT_HINT: Record<ChatPolicy, string> = {
  all: "Писать может любой.",
  host: "Остальные только читают.",
  off: "Новые сообщения не отправляются. Голос и экран работают как обычно.",
};

/** Тост о пароле: один на окно, повторное «Задать» обновляет его. */
const PASSWORD_TOAST = "room-password";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-label font-medium text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

/**
 * «Настройки комнаты» — только у хоста: вход (замок, витрина, пароль), кто что
 * может (экран, чат), «Выключить микрофоны всем» и баны.
 *
 * Всё применяется сразу, кнопки «Сохранить» нет (решение М8): переключатель
 * показывает выбранное мгновенно, при отказе сервера возвращается назад, а
 * тост объясняет почему (его показывает useModeration). Подтверждения об успехе
 * не нужны: видно по самому переключателю, а замок и правила показа и так
 * объявляет тост комнаты всем. Исключение — пароль: его набирают, поэтому
 * отдельные кнопки «Задать» и «Снять». «Закрыть вход» здесь и в меню шапки —
 * одно и то же действие.
 *
 * «Готово» закрывает окно, дождавшись ещё не дошедших изменений. Монтируется
 * заново на каждое открытие — черновик выбора не переживает закрытия.
 */
export default function RoomSettingsDialog({
  meta,
  open,
  onOpenChange,
}: {
  meta: RoomPublicMeta;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { moderate } = useModeration();
  const [draft, setDraft] = useState<SettingsDraft>({});
  const shown = shownSettings(settingsFromMeta(meta), draft);
  const seqRef = useRef(0);
  // Запросы — строго по очереди: два быстрых нажатия не обгонят друг друга на сервере.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const [closing, setClosing] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState<"set" | "remove" | null>(null);
  const [mutingAll, setMutingAll] = useState(false);

  function change<K extends InstantField>(field: K, value: InstantSettings[K]) {
    if (shown[field] === value) return;
    const seq = ++seqRef.current;
    setDraft((d) => startChange(d, field, value, seq));
    queueRef.current = queueRef.current.then(async () => {
      const r = await moderate({ action: "settings", settings: patchOf(field, value) });
      setDraft((d) => finishChange(d, field, seq, r.ok));
    });
  }

  async function done() {
    if (closing) return;
    setClosing(true);
    await queueRef.current;
    setClosing(false);
    onOpenChange(false);
  }

  const pwProblem = passwordProblem(password);
  const canSetPassword = !!password.trim() && !pwProblem && passwordBusy === null;

  async function savePassword(next: string | null) {
    if (passwordBusy) return;
    setPasswordBusy(next === null ? "remove" : "set");
    const r = await moderate({ action: "settings", settings: { password: next } });
    setPasswordBusy(null);
    if (!r.ok) return;
    setPassword("");
    toast(
      next === null
        ? { id: PASSWORD_TOAST, title: "Пароль снят", description: "Зайти можно по ссылке без пароля", icon: "unlock" }
        : {
            id: PASSWORD_TOAST,
            title: meta.hasPassword ? "Пароль сменён" : "Пароль задан",
            description: "Новым людям он понадобится при входе",
            icon: "key",
          },
    );
  }

  async function muteAll() {
    setMutingAll(true);
    const r = await moderate({ action: "muteAll" });
    setMutingAll(false);
    if (r.ok) toast({ title: "Микрофоны выключены", description: "Свой микрофон каждый может включить сам", icon: "mic-off" });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Настройки комнаты"
      description="Изменения применяются сразу. Это окно есть только у хоста."
      size="md"
      data-testid="room-settings-dialog"
      footer={
        // testid прежний: e2e закрывает им окно после выбора (setRoomPolicy).
        <Button variant="primary" loading={closing} onClick={() => void done()} data-testid="room-settings-save">
          Готово
        </Button>
      }
    >
      <div className="flex flex-col gap-7">
        <Section title="Вход">
          <div className="divide-y divide-line rounded-card border border-line px-4">
            <SettingRow
              htmlFor="rs-lock"
              title="Закрыть вход"
              description="Новые люди не смогут зайти, даже по ссылке"
              control={
                <Switch id="rs-lock" checked={shown.locked} onCheckedChange={(locked) => change("locked", locked)} />
              }
            />
            <SettingRow
              htmlFor="rs-public"
              title="Показывать в списке комнат"
              description="Её найдут на странице «Открытые комнаты»"
              control={
                <Switch
                  id="rs-public"
                  checked={shown.isPublic}
                  onCheckedChange={(isPublic) => change("isPublic", isPublic)}
                />
              }
            />
            <form
              className="flex flex-col gap-2 py-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (canSetPassword) void savePassword(password.trim());
              }}
            >
              <TextField
                label="Пароль"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={meta.hasPassword ? "••••••" : "Без пароля"}
                hint={
                  meta.hasPassword
                    ? "Пароль задан. Чтобы сменить, введите новый и нажмите «Задать»."
                    : "Необязательно. Хотя бы 4 символа."
                }
                error={pwProblem ?? undefined}
                maxLength={128}
                data-testid="room-settings-password"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  size="sm"
                  icon="key"
                  disabled={!canSetPassword}
                  loading={passwordBusy === "set"}
                  data-testid="room-settings-password-set"
                >
                  Задать
                </Button>
                {meta.hasPassword && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    loading={passwordBusy === "remove"}
                    disabled={passwordBusy !== null}
                    onClick={() => void savePassword(null)}
                    data-testid="room-settings-password-remove"
                  >
                    Снять пароль
                  </Button>
                )}
              </div>
            </form>
          </div>
        </Section>

        <Section title="Кто что может">
          <div className="divide-y divide-line rounded-card border border-line px-4">
            <div className="flex flex-col gap-2 py-3">
              <span className="text-body text-ink">Показывать экран</span>
              <SegmentedControl
                label="Кто может показывать экран"
                size="sm"
                block
                value={shown.screen}
                onValueChange={(screen) => change("screen", screen)}
                options={SCREEN_OPTIONS}
              />
              <span className="text-label text-ink-3">{SCREEN_HINT[shown.screen]}</span>
            </div>
            <div className="flex flex-col gap-2 py-3">
              <span className="text-body text-ink">Чат</span>
              <SegmentedControl
                label="Кто может писать в чат"
                size="sm"
                block
                value={shown.chat}
                onValueChange={(chat) => change("chat", chat)}
                options={CHAT_OPTIONS}
              />
              <span className="text-label text-ink-3">{CHAT_HINT[shown.chat]}</span>
            </div>
          </div>
        </Section>

        <Section title="Сейчас">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-body text-ink">Выключить микрофоны всем</p>
              <p className="text-label text-ink-3">Кроме вас. Свой микрофон каждый сможет включить сам.</p>
            </div>
            <Button size="sm" icon="mic-off" loading={mutingAll} onClick={() => void muteAll()} data-testid="mute-all">
              Выключить
            </Button>
          </div>
        </Section>

        {/* Список грузится только в открытом окне: закрытое смонтировано всегда. */}
        <Section title="Забанены">{open && <BanList />}</Section>
      </div>
    </Dialog>
  );
}
