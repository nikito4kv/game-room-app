"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { IconButton } from "@/components/ui/IconButton";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { SettingRow } from "@/components/ui/SettingRow";
import { Switch } from "@/components/ui/Switch";
import { TextField } from "@/components/ui/TextField";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, TITLE_MAX_LENGTH } from "@/lib/api/contract";
import { EVENTS, track } from "@/lib/analytics/posthogClient";
import { createRoom } from "@/lib/client/api";
import { isApiError } from "@/lib/client/errors";
import { createRoomBlock } from "@/lib/client/publicConfig";
import { usePublicConfig } from "@/lib/client/usePublicConfig";
import { getNickname, markEntry, stashHostKey } from "@/lib/clientStorage";
import { defaultRoomTitle } from "./labels";

// Ник с прошлого входа — только чтобы подсказать название. На сервере и до
// гидрации его нет (null), после — из localStorage; другая вкладка сменила
// ник — подхватываем.
function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
const noNickname = () => null;

type FieldErrors = { title?: string; password?: string; key?: string };

/** Ключ клуба / код: сервер ждёт GR-XXXX-XXXX-XXXX, но регистр и пробелы прощаем. */
const KEY_MAX_LENGTH = 40;

/**
 * «Новая комната»: название (необязательно), пароль (необязательно) и
 * «показать в списке». Ник тут не спрашиваем — его спросит лобби. Создали →
 * ключ владельца в localStorage → переход в комнату.
 *
 * Администрация (А3, А6): в режиме обслуживания форма показывает объяснение и
 * не отправляется; с флагом access_keys есть свёрнутое поле «Есть ключ клуба или
 * код?» — комната получит бейдж клуба и его лимит людей.
 */
export function CreateRoomCard() {
  const router = useRouter();
  const nickname = useSyncExternalStore(subscribeStorage, getNickname, noNickname);
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [listed, setListed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const titleRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const listedId = useId();
  const keyId = useId();
  const fallbackTitle = defaultRoomTitle(nickname);
  const config = usePublicConfig();
  const blocked = config ? createRoomBlock(config) : null;
  const keysOn = config?.flags.access_keys ?? false;
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState("");
  const keyRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || blocked) return;
    setError(null);
    const pw = password.trim();
    if (pw && pw.length < PASSWORD_MIN_LENGTH) {
      setFieldErrors({
        password: `Слишком короткий пароль: нужно от ${PASSWORD_MIN_LENGTH} символов. Или оставьте поле пустым`,
      });
      passwordRef.current?.focus();
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const clubKey = keysOn && keyOpen ? key.trim().toUpperCase() : "";
      const room = await createRoom({
        title: title.trim() || fallbackTitle,
        password: pw || undefined,
        isPublic: listed,
        ...(clubKey ? { key: clubKey } : {}),
      });
      stashHostKey(room.code, room.hostKey);
      markEntry(room.code, "created");
      track(EVENTS.roomCreated, { is_public: listed, has_password: pw !== "" });
      // busy не снимаем: кнопка крутится, пока не откроется комната, — второго
      // клика и второй комнаты не будет.
      router.push(`/room/${room.code}`);
    } catch (err) {
      setBusy(false);
      if (isApiError(err) && err.code === "INVALID_PASSWORD") {
        setFieldErrors({ password: err.message });
        passwordRef.current?.focus();
      } else if (isApiError(err) && err.code === "INVALID_TITLE") {
        setFieldErrors({ title: err.message });
        titleRef.current?.focus();
      } else if (isApiError(err) && err.code === "INVALID_KEY") {
        setFieldErrors({ key: err.message });
        keyRef.current?.focus();
      } else {
        setError(isApiError(err) ? err.message : "Не получилось создать комнату. Попробуйте ещё раз");
      }
    }
  }

  return (
    <Card padding="lg">
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <h2 className="text-title text-ink">Новая комната</h2>
        {blocked && (
          <InlineAlert tone="caution" title="Новые комнаты сейчас не создаются">
            {blocked}
          </InlineAlert>
        )}
        {error && (
          <InlineAlert tone="alert" title="Комната не создалась">
            {error}
          </InlineAlert>
        )}
        <TextField
          ref={titleRef}
          label="Название"
          placeholder={fallbackTitle}
          hint={nickname ? "Можно не заполнять: назовём по вашему нику" : "Можно не заполнять"}
          error={fieldErrors.title}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (fieldErrors.title) setFieldErrors({});
          }}
          maxLength={TITLE_MAX_LENGTH}
          autoComplete="off"
          enterKeyHint="go"
        />
        <TextField
          ref={passwordRef}
          label="Пароль"
          type={showPassword ? "text" : "password"}
          placeholder="Без пароля"
          error={fieldErrors.password}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (fieldErrors.password) setFieldErrors({});
          }}
          maxLength={PASSWORD_MAX_LENGTH}
          autoComplete="new-password"
          enterKeyHint="go"
          suffix={
            password ? (
              <IconButton
                icon={showPassword ? "eye-off" : "eye"}
                label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                size="sm"
                onClick={() => setShowPassword((v) => !v)}
              />
            ) : undefined
          }
        />
        <SettingRow
          htmlFor={listedId}
          title="Показать в списке комнат"
          description="Зайти сможет любой со страницы «Открытые комнаты»"
          control={<Switch id={listedId} checked={listed} onCheckedChange={setListed} />}
          className="py-1"
        />
        {keysOn &&
          (keyOpen ? (
            <TextField
              ref={keyRef}
              id={keyId}
              label="Ключ клуба или код"
              placeholder="GR-XXXX-XXXX-XXXX"
              hint="Комната получит название и цвет клуба. Нет ключа — оставьте пустым"
              error={fieldErrors.key}
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                if (fieldErrors.key) setFieldErrors({});
              }}
              maxLength={KEY_MAX_LENGTH}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              enterKeyHint="go"
              data-testid="create-key"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setKeyOpen(true);
                requestAnimationFrame(() => keyRef.current?.focus());
              }}
              className="-mx-1 self-start rounded-item px-1 text-label text-ink-3 underline underline-offset-4 transition-colors duration-140 hover:text-ink"
            >
              Есть ключ клуба или код?
            </button>
          ))}
        <Button type="submit" variant="primary" size="lg" icon="plus" block loading={busy} disabled={!!blocked}>
          Создать комнату
        </Button>
      </form>
    </Card>
  );
}
