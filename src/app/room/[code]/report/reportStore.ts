"use client";

import { useSyncExternalStore } from "react";

// На кого жалоба: открывают из панели участника или из меню названия комнаты, а
// рисует ReportDialog — без общего провайдера (как диалог настроек комнаты).

/** Цель жалобы: человек (identity и ник) или вся комната (null). */
export type ReportTarget = { identity: string; name: string } | null;

type State = { open: boolean; target: ReportTarget; session: number };

let state: State = { open: false, target: null, session: 0 };
const listeners = new Set<() => void>();

function set(next: State): void {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Открыть диалог жалобы. Каждое открытие — свежая форма (новый session). */
export function openReport(target: ReportTarget): void {
  set({ open: true, target, session: state.session + 1 });
}

export function closeReport(): void {
  if (state.open) set({ ...state, open: false });
}

const closed: State = { open: false, target: null, session: 0 };

export function useReportState(): State {
  return useSyncExternalStore(subscribe, () => state, () => closed);
}
