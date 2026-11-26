"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TextField } from "@/components/ui/TextField";
import { markEntry } from "@/lib/clientStorage";
import { cleanRoomCodeInput, isRoomCode, type RoomCodeNote } from "@/lib/roomCode";
import { codeNoteText } from "./labels";

/**
 * «Есть код или ссылка?»: одно поле. Вставленная ссылка сразу превращается в
 * код, «К» кириллицей — в латинскую K, регистр — верхний (cleanRoomCodeInput).
 * «Войти» активна, когда код полный. Пароль и ник спросит лобби комнаты.
 *
 * Адрес с якорем #join (кнопка «Ввести другой код» на экране «Комнаты нет»)
 * сразу ставит фокус в поле: человек пришёл именно ввести код.
 */
export function JoinRoomCard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [note, setNote] = useState<RoomCodeNote | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = isRoomCode(code);

  useEffect(() => {
    if (window.location.hash === "#join") inputRef.current?.focus();
  }, []);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    markEntry(code, "code");
    router.push(`/room/${code}`);
  }

  return (
    <Card id="join" padding="lg" className="flex scroll-mt-4 flex-col gap-3">
      <h2 className="text-title text-ink">Есть код или ссылка?</h2>
      <form className="flex items-start gap-2" onSubmit={submit}>
        <TextField
          ref={inputRef}
          aria-label="Код комнаты или ссылка"
          placeholder="K7QMP4 или ссылка"
          size="lg"
          value={code}
          onChange={(e) => {
            const cleaned = cleanRoomCodeInput(e.target.value);
            setCode(cleaned.code);
            setNote(cleaned.note);
          }}
          hint={codeNoteText(note)}
          // Без maxLength: браузер обрезал бы вставленную ссылку до 6 символов.
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          wrapperClassName="flex-1"
          className="font-brand tracking-[0.14em] placeholder:font-body placeholder:tracking-normal"
        />
        <Button variant="secondary" size="lg" type="submit" disabled={!ready} loading={busy}>
          Войти
        </Button>
      </form>
    </Card>
  );
}
