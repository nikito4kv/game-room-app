"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import type { Recap } from "@/lib/room/recap";
import { RecapDialog } from "./RecapDialog";

/** «Итоги вечера» на экране «Вы вышли»: кнопка и окно с картинкой. */
export function RecapButton({ recap }: { recap: Recap }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="lg" block icon="image" onClick={() => setOpen(true)} data-testid="recap-open">
        Итоги вечера
      </Button>
      <RecapDialog open={open} onOpenChange={setOpen} recap={recap} />
    </>
  );
}
