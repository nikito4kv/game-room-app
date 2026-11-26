import { describe, expect, it } from "vitest";
import {
  AVATAR_SYNC_CONFIRM_MS,
  AVATAR_SYNC_DEBOUNCE_MS,
  AVATAR_SYNC_GAP_MS,
  AVATAR_SYNC_QUIET_MS,
  IDLE_AVATAR_SYNC,
  afterAvatarSync,
  avatarTarget,
  planAvatarSync,
  startAvatarSync,
  type AvatarSync,
} from "./syncPlan";

const A = "data:image/png;base64,AAAA";
const B = "data:image/png;base64,BBBB";
const C = "data:image/png;base64,CCCC";
const T0 = 1_000_000;

/** Отправили paint в момент now и сервер принял его под id. */
function sent(sync: AvatarSync, paint: string | null, id: string | null, now: number): AvatarSync {
  return afterAvatarSync(startAvatarSync(sync, now), { ok: true, paint, id }, now + 50);
}

/** Вошли с рисунком A: план увидел его, сервер принял, атрибут пришёл. */
function entered(paint: string | null = A, id: string | null = "id-A"): AvatarSync {
  const first = planAvatarSync(paint, null, IDLE_AVATAR_SYNC, T0).sync;
  const s = sent(first, paint, id, T0 + 1000);
  return planAvatarSync(paint, id, s, T0 + 1100).sync;
}

describe("planAvatarSync", () => {
  it("вошли с рисунком — шлём после короткой паузы; без рисунка и без атрибута — нечего", () => {
    const plan = planAvatarSync(A, null, IDLE_AVATAR_SYNC, T0);
    expect(plan.sendInMs).toBe(AVATAR_SYNC_DEBOUNCE_MS);
    expect(plan.send).toBe(A);
    expect(planAvatarSync(null, null, IDLE_AVATAR_SYNC, T0).sendInMs).toBeNull();
  });

  it("сервер принял и атрибут пришёл — сошлось, больше не шлём", () => {
    const s = entered();
    expect(planAvatarSync(A, "id-A", s, T0 + 60_000).sendInMs).toBeNull();
  });

  it("запрос в пути — второй не шлём", () => {
    const s = startAvatarSync(IDLE_AVATAR_SYNC, T0);
    expect(planAvatarSync(B, null, s, T0 + 10).sendInMs).toBeNull();
  });

  it("рисуют в соседней вкладке — шлём только после затишья, один запрос на сеанс рисования", () => {
    let s = entered();
    // Штрих каждые 3 с в течение минуты: каждый раз план откладывает отправку.
    let at = T0 + 60_000;
    let plan = planAvatarSync(B, "id-A", s, at);
    for (let i = 0; i < 20; i++) {
      at += 3_000;
      plan = planAvatarSync(i % 2 ? B : C, "id-A", plan.sync, at);
      expect(plan.sendInMs).toBe(AVATAR_SYNC_QUIET_MS);
    }
    // Перестали рисовать: через QUIET_MS план всё ещё ждёт ровно остаток затишья.
    s = plan.sync;
    expect(planAvatarSync(B, "id-A", s, at + 5_000).sendInMs).toBe(AVATAR_SYNC_QUIET_MS - 5_000);
    expect(planAvatarSync(B, "id-A", s, at + AVATAR_SYNC_QUIET_MS).sendInMs).toBe(AVATAR_SYNC_DEBOUNCE_MS);
  });

  it("одна правка в комнате — уходит через AVATAR_SYNC_QUIET_MS, и не чаще AVATAR_SYNC_GAP_MS", () => {
    const s = entered();
    const plan = planAvatarSync(B, "id-A", s, T0 + 1500);
    // Затишье длиннее паузы между запросами — оно и решает.
    expect(plan.sendInMs).toBe(AVATAR_SYNC_QUIET_MS);
    expect(AVATAR_SYNC_QUIET_MS).toBeGreaterThanOrEqual(10_000);
    expect(AVATAR_SYNC_QUIET_MS).toBeLessThanOrEqual(20_000);
    expect(AVATAR_SYNC_QUIET_MS).toBeGreaterThan(AVATAR_SYNC_GAP_MS);
  });

  it("вошли заново (атрибута в новой сессии нет) — тот же рисунок уходит сразу, без затишья", () => {
    const s = entered();
    expect(planAvatarSync(A, null, s, T0 + 30_000).sendInMs).toBe(AVATAR_SYNC_DEBOUNCE_MS);
  });

  it("принято, а атрибут не пришёл — повтор после AVATAR_SYNC_CONFIRM_MS, дальше паузы растут", () => {
    const at = T0 + AVATAR_SYNC_GAP_MS * 10;
    let s = sent({ ...IDLE_AVATAR_SYNC, lastSentAt: 0 }, A, "id-A", at);
    expect(s.notBefore).toBe(at + 50 + AVATAR_SYNC_CONFIRM_MS);
    s = sent(s, A, "id-A", at + 10_000);
    expect(s.failures).toBe(1);
    s = sent(s, A, "id-A", at + 20_000);
    expect(s.failures).toBe(2);
    expect(s.notBefore - (at + 20_050)).toBe(10_000);
  });

  it("стёрли рисунок — снимаем атрибут (png: null) без затишья; снят — сошлось", () => {
    const s = entered();
    const plan = planAvatarSync(null, "id-A", s, T0 + 60_000);
    expect(plan.send).toBeNull();
    expect(plan.sendInMs).toBe(AVATAR_SYNC_DEBOUNCE_MS);
    const off = sent(plan.sync, null, null, T0 + 60_000);
    expect(planAvatarSync(null, null, off, T0 + 60_100).sendInMs).toBeNull();
  });

  it("сбой — повтор по нарастающей паузе или по retryAfterSec, если она длиннее", () => {
    let s = afterAvatarSync(startAvatarSync(IDLE_AVATAR_SYNC, T0), { ok: false }, T0);
    expect(planAvatarSync(A, null, s, T0).sendInMs).toBe(5_000);
    s = afterAvatarSync(startAvatarSync(s, T0 + 5_000), { ok: false, retryAfterSec: 30 }, T0 + 5_000);
    expect(planAvatarSync(A, null, s, T0 + 5_000).sendInMs).toBe(30_000);
  });
});

describe("отказ сервера", () => {
  it("отказ в новом рисунке — один раз снимаем атрибут: другие видят Румика без рисунка, а не прошлый рисунок", () => {
    // В комнате принят A, сменили на B, сервер B не принял (скрыт, не влез, место кончилось).
    let s = entered();
    let plan = planAvatarSync(B, "id-A", s, T0 + 60_000);
    s = afterAvatarSync(startAvatarSync(plan.sync, T0 + 75_000), { ok: false, paint: B, refused: true }, T0 + 75_100);
    expect(s.refused).toBe(B);
    expect(avatarTarget(B, s)).toBeNull();
    // Атрибут ещё держит A — уходит png: null, без затишья (но не чаще GAP).
    plan = planAvatarSync(B, "id-A", s, T0 + 75_200);
    expect(plan.send).toBeNull();
    expect(plan.sendInMs).toBe(AVATAR_SYNC_GAP_MS - 200);
    // Снят — сошлось, больше ничего не шлём, сколько бы ни прошло.
    s = sent(plan.sync, null, null, T0 + 80_000);
    for (const later of [T0 + 80_100, T0 + 600_000, T0 + 3_600_000]) {
      expect(planAvatarSync(B, null, s, later).sendInMs).toBeNull();
    }
  });

  it("отказ при входе (атрибута ещё нет) — слать нечего вовсе", () => {
    const first = planAvatarSync(A, null, IDLE_AVATAR_SYNC, T0);
    const s = afterAvatarSync(startAvatarSync(first.sync, T0 + 1000), { ok: false, paint: A, refused: true }, T0 + 1100);
    expect(planAvatarSync(A, null, s, T0 + 600_000).sendInMs).toBeNull();
  });

  it("администрация сняла атрибут и скрыла рисунок — повтор получает отказ, снова не шлём", () => {
    let s = entered();
    // Атрибут исчез (сброс): клиент пробует вернуть A — как после входа заново.
    let plan = planAvatarSync(A, null, s, T0 + 60_000);
    expect(plan.sendInMs).toBe(AVATAR_SYNC_DEBOUNCE_MS);
    s = afterAvatarSync(startAvatarSync(plan.sync, T0 + 61_000), { ok: false, paint: A, refused: true }, T0 + 61_100);
    plan = planAvatarSync(A, null, s, T0 + 61_200);
    expect(plan.sendInMs).toBeNull();
  });

  it("сменили отвергнутый рисунок — новый уходит после затишья", () => {
    const first = planAvatarSync(A, null, IDLE_AVATAR_SYNC, T0);
    const s = afterAvatarSync(startAvatarSync(first.sync, T0 + 1000), { ok: false, paint: A, refused: true }, T0 + 1100);
    const plan = planAvatarSync(B, null, s, T0 + 600_000);
    expect(plan.send).toBe(B);
    expect(plan.sendInMs).toBe(AVATAR_SYNC_QUIET_MS);
  });

  it("отказ в png: null (не бывает, но вдруг) — не по кругу, а с паузой как сбой", () => {
    const s = afterAvatarSync(startAvatarSync(IDLE_AVATAR_SYNC, T0), { ok: false, paint: null, refused: true }, T0);
    expect(s.refused).toBeNull();
    expect(s.failures).toBe(1);
    expect(planAvatarSync(null, "id-A", s, T0).sendInMs).toBe(5_000);
  });
});
