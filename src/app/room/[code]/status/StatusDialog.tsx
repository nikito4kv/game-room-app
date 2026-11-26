"use client";

import { Dialog } from "@/components/ui";
import { StatusPicker } from "./StatusPicker";

/** «Мой статус» из меню комнаты (флаг statuses): значок у вашего ника, а у «В игре» ещё и «во что». */
export function StatusDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Мой статус"
      description="Его увидят все в комнате рядом с вашим ником. Пропадёт, когда вы выйдете."
      data-testid="status-dialog"
    >
      <StatusPicker />
    </Dialog>
  );
}
