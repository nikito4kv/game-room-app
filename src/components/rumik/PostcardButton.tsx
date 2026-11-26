"use client";

import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { Button } from "@/components/ui/Button";
import type { RumikPlace } from "@/lib/analytics/rumik";
import type { RumikPose } from "@/lib/rumik/geometry";
import type { PostcardDialogProps } from "./PostcardDialog";

// Код окна (сборка PNG, позы, логотип) — отдельным куском, только по требованию:
// наведение на кнопку подгружает его заранее, нажатие открывает окно.
const loadDialog = () => import("./PostcardDialog");

function lazyDialog() {
  return lazy<ComponentType<PostcardDialogProps>>(() =>
    loadDialog().then(
      (m) => ({ default: m.PostcardDialog }),
      () => {
        // Сеть подвела: окно не открываем, следующее нажатие попробует снова.
        PostcardDialog = lazyDialog();
        return { default: NotLoaded };
      },
    ),
  );
}

let PostcardDialog = lazyDialog();

function NotLoaded({ onOpenChange }: PostcardDialogProps) {
  useEffect(() => onOpenChange(false), [onOpenChange]);
  return null;
}

/**
 * «Открытка» (R5): кнопка для панели рисовалки (проп `actions` у RumikEditor).
 * Лёгкая — только кнопка; окно с открыткой (PostcardDialog) приезжает по
 * клику. Одна и та же у заглушки рисовалки и у неё самой, поэтому при
 * загрузке рисовалки ничего не мигает.
 */
export function PostcardButton({ place, className }: { place: RumikPlace; className?: string }) {
  const [open, setOpen] = useState(false);
  // Окно смонтировано с первого нажатия: дальше открывается и закрывается само.
  const [asked, setAsked] = useState(false);
  // Поза помнится между открытиями окна.
  const [pose, setPose] = useState<RumikPose>("wave");
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        icon="image"
        className={className}
        onPointerEnter={() => void loadDialog().catch(() => {})}
        onClick={() => {
          setAsked(true);
          setOpen(true);
        }}
      >
        Открытка
      </Button>
      {asked && (
        <Suspense fallback={null}>
          <PostcardDialog open={open} onOpenChange={setOpen} place={place} pose={pose} onPose={setPose} />
        </Suspense>
      )}
    </>
  );
}
