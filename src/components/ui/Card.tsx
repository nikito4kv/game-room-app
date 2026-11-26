import type { HTMLAttributes, Ref } from "react";
import { cn } from "./cn";

export type CardTone = "raised" | "sunken" | "outline" | "ghost";

const TONE: Record<CardTone, string> = {
  raised: "bg-raised border border-line shadow-raised",
  sunken: "bg-sunken border border-line",
  outline: "border border-line-strong",
  ghost: "bg-wash-1",
};

const PAD = { none: "", sm: "p-3", md: "p-5", lg: "p-6" } as const;

/**
 * Контейнер-карточка. Используйте, только когда приподнятость что-то значит
 * (отдельный блок формы, плитка). Группы внутри карточки делите отступами и
 * линиями (`divide-y divide-line`), а не вложенными карточками.
 */
export function Card({
  ref,
  tone = "raised",
  padding = "md",
  radius = "card",
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  ref?: Ref<HTMLDivElement>;
  tone?: CardTone;
  padding?: keyof typeof PAD;
  radius?: "card" | "panel";
}) {
  return (
    <div
      ref={ref}
      className={cn(TONE[tone], PAD[padding], radius === "panel" ? "rounded-panel" : "rounded-card", className)}
      {...props}
    />
  );
}
