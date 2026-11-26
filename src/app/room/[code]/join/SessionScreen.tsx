"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HOST_HANDOVER_DELAY_SEC } from "@/lib/api/contract";
import { Button, Logo, Rumik, StateScreen, UiRoot, glueShortWords, type IconName } from "@/components/ui";
import { formatCountdown, type ScreenView } from "@/lib/client/joinScreens";
import { plural } from "@/lib/plural";
import { useCountdown } from "./useCountdown";

type Action = { label: string; icon?: IconName; onClick: () => void; disabled?: boolean; loading?: boolean };

/**
 * Румик вместо значка там, где его поза объясняет, что случилось. Строгие
 * тупики (выгнали, бан, администрация, техработы) остаются со значками.
 */
const PICTURES: Partial<Record<ScreenView["kind"], ReactNode>> = {
  // Трое внахлёст: места кончились. Место под картинку шире на 44%, как в макете.
  full: (
    <div className="-mx-[22%] flex">
      <div className="w-[38%] shrink-0">
        <Rumik colors={[0, 1, 2, 9]} sticker eyes="wide" />
      </div>
      <div className="-ml-[7%] w-[38%] shrink-0">
        <Rumik colors={[8, 7, 6, 5]} sticker eyes="wide" flip />
      </div>
      <div className="-ml-[7%] w-[38%] shrink-0">
        <Rumik colors={[3, 4, 5, 6]} sticker eyes="wide" />
      </div>
    </div>
  ),
  lost: <Rumik colors={[1, 0, 9, 2]} sticker extra="bang" eyes="lost" tilt={5} />,
  left: <Rumik colors={[2, 3, 4, 0]} sticker pose="wave" eyes="wink" hat="beanie" />,
};

/** Кем вышли (для «Вы вышли»): хосту — пара слов о том, куда денутся права. */
export type LeftAs = { wasHost: boolean; isOwner: boolean };

/**
 * Экран вместо лобби или комнаты: комнаты нет, выгнали, связь потеряна, вы
 * вышли… У каждого тупика — главное действие, которое чинит ситуацию, и
 * запасное («На главную»). Технический текст ошибок сюда не попадает.
 */
export default function SessionScreen({
  view,
  code,
  title,
  onRetry,
  retrying = false,
  error = null,
  leftAs,
  extra,
}: {
  view: ScreenView;
  code: string;
  /** Название комнаты, если знаем. */
  title?: string;
  /** Войти снова: «Попробовать снова», «Вернуться», «Переподключиться». */
  onRetry?: () => void;
  retrying?: boolean;
  /** Почему повтор не удался — текст сервера. */
  error?: string | null;
  /** Для «Вы вышли»: были ли хостом и владельцем. */
  leftAs?: LeftAs;
  /** Ещё одно действие между главным и запасным («Итоги вечера»). */
  extra?: ReactNode;
}) {
  const router = useRouter();
  const home = () => router.push("/");
  const kickedUntil = view.kind === "kicked" || view.kind === "adminRemoved" ? view.until : null;
  const left = useCountdown(kickedUntil);
  const inRoom = title ? ` «${title}»` : "";

  const retry = (label: string, icon: IconName = "reconnect"): Action | undefined =>
    onRetry ? { label, icon, onClick: onRetry, loading: retrying } : undefined;
  const toHome: Action = { label: "На главную", onClick: home };

  let icon: IconName;
  let tone: "neutral" | "alert" | "caution" = "neutral";
  let heading: string;
  let text: ReactNode;
  let primary: Action | undefined;
  let secondary: Action | undefined;

  switch (view.kind) {
    case "notFound":
      icon = "search";
      heading = `Комнаты ${code} нет`;
      text = "Возможно, все вышли и она закрылась, или в коде опечатка.";
      primary = { label: "Создать комнату", icon: "plus", onClick: home };
      // На главной поле кода сразу в фокусе (#join — см. JoinRoomCard).
      secondary = { label: "Ввести другой код", onClick: () => router.push("/#join") };
      break;
    case "closed":
      icon = "search";
      heading = "Комната закрылась";
      text = "Все вышли, и комнаты больше нет. Создайте новую, это быстро.";
      primary = { label: "Создать комнату", icon: "plus", onClick: home };
      secondary = toHome;
      break;
    case "kicked":
      icon = "user-x";
      tone = "alert";
      heading = "Вас выгнали из комнаты";
      text =
        left > 0
          ? `Хост выгнал вас из комнаты${inRoom}. Вернуться можно через ${formatCountdown(left)}.`
          : `Хост выгнал вас из комнаты${inRoom}. Теперь можно вернуться.`;
      primary = onRetry
        ? { label: "Вернуться в комнату", icon: "log-in", onClick: onRetry, disabled: left > 0, loading: retrying }
        : undefined;
      secondary = toHome;
      break;
    case "banned":
      icon = "ban";
      tone = "alert";
      heading = "Вас забанили в этой комнате";
      text = "Зайти снова не получится, пока хост не снимет бан.";
      primary = toHome;
      break;
    case "removed":
      // Причина не дошла до нас: убрать мог и хост, и администрация — не гадаем.
      icon = "user-x";
      tone = "alert";
      heading = "Вас удалили из комнаты";
      text = `Вас удалили из комнаты${inRoom}.`;
      primary = toHome;
      break;
    case "adminRemoved":
      icon = view.ban ? "ban" : "user-x";
      tone = "alert";
      heading = "Вас удалила администрация сервиса";
      text = view.ban
        ? `Администрация Game Room удалила вас из комнаты${inRoom}. Вернуться в эту комнату не получится.`
        : left > 0
          ? `Администрация Game Room удалила вас из комнаты${inRoom}. Вернуться можно через ${formatCountdown(left)}.`
          : `Администрация Game Room удалила вас из комнаты${inRoom}. Теперь можно вернуться.`;
      primary =
        !view.ban && onRetry && view.until !== null
          ? { label: "Вернуться в комнату", icon: "log-in", onClick: onRetry, disabled: left > 0, loading: retrying }
          : toHome;
      secondary = { label: "Правила сервиса", onClick: () => router.push("/rules") };
      break;
    case "adminClosed":
      icon = "shield";
      tone = "alert";
      heading = "Комната закрыта администрацией";
      text =
        view.message || `Администрация Game Room закрыла комнату${inRoom}. Если хотите продолжить, создайте новую.`;
      primary = { label: "Создать комнату", icon: "plus", onClick: home };
      secondary = { label: "Правила сервиса", onClick: () => router.push("/rules") };
      break;
    case "blocked":
      icon = "ban";
      tone = "alert";
      heading = "Вход закрыт администрацией";
      text = view.message || "Администрация Game Room закрыла доступ с этого устройства или из этой сети.";
      primary = toHome;
      secondary = { label: "Правила сервиса", onClick: () => router.push("/rules") };
      break;
    case "maintenance":
      icon = "refresh";
      tone = "caution";
      heading = "Идут технические работы";
      text = view.message || "Вход в комнаты временно закрыт. Попробуйте через несколько минут.";
      primary = retry("Попробовать снова");
      secondary = toHome;
      break;
    case "locked":
      icon = "lock";
      tone = "caution";
      heading = "Вход закрыт";
      text = `${view.message}. Попросите хоста открыть вход.`;
      primary = retry("Попробовать снова");
      secondary = toHome;
      break;
    case "full":
      icon = "users";
      heading = "Комната заполнена";
      text = "Свободных мест нет. Попросите кого-нибудь выйти и заходите.";
      primary = retry("Попробовать снова");
      secondary = { label: "Создать свою комнату", icon: "plus", onClick: home };
      break;
    case "seat":
      icon = "user";
      tone = "caution";
      heading = "Место занято";
      text = view.message;
      primary = toHome;
      break;
    case "outdated":
      icon = "refresh";
      heading = "Приложение обновилось";
      text = "Обновите страницу, это займёт секунду.";
      primary = { label: "Обновить страницу", icon: "refresh", onClick: () => window.location.reload() };
      break;
    case "duplicate":
      icon = "monitor";
      heading = "Вы открыли комнату в другой вкладке";
      text = "Здесь связь выключена, чтобы вас не было слышно дважды.";
      primary = retry("Вернуться сюда", "log-in");
      secondary = toHome;
      break;
    case "lost":
      icon = "wifi-off";
      tone = "alert";
      heading = "Связь потеряна";
      text = `Не получилось вернуть вас в комнату${inRoom} автоматически. Проверьте интернет: комната вас ждёт.`;
      primary = retry("Переподключиться");
      secondary = toHome;
      break;
    case "voice":
      icon = "alert-triangle";
      tone = "caution";
      heading = "Не получилось подключиться к голосу";
      text =
        "Проверьте интернет или выключите VPN. В клубе иногда закрыты нужные порты: попробуйте раздать интернет с телефона.";
      primary = retry("Попробовать снова");
      secondary = toHome;
      break;
    case "error":
      icon = "alert-circle";
      tone = "alert";
      heading = "Не получилось войти";
      text = view.message;
      primary = retry("Попробовать снова");
      secondary = toHome;
      break;
    case "left":
      icon = "log-out";
      heading = `Вы вышли из комнаты${inRoom}`;
      text = leftText(leftAs);
      primary = retry("Вернуться", "log-in");
      secondary = toHome;
      break;
  }

  return (
    <UiRoot className="fixed inset-0 grid place-items-center overflow-y-auto p-6">
      <header className="absolute left-5 top-4">
        <Link href="/" aria-label="Game Room, на главную" className="block rounded-control">
          <Logo variant="lockup" height={24} className="text-ink" />
        </Link>
      </header>
      <main className="flex w-full justify-center">
        <StateScreen
          icon={icon}
          tone={tone}
          visual={PICTURES[view.kind]}
          // В заголовке бывает название комнаты: «…катка в CS2» не должно рваться на «в».
          title={glueShortWords(heading)}
          actions={
            (primary || secondary || extra) && (
              <>
                {primary && (
                  <Button
                    variant="primary"
                    size="lg"
                    block
                    icon={primary.icon}
                    onClick={primary.onClick}
                    disabled={primary.disabled}
                    loading={primary.loading}
                    // Вышли сами — комната исчезла из-под фокуса; ставим его на «Вернуться».
                    autoFocus={view.kind === "left"}
                    data-testid="screen-primary"
                  >
                    {primary.label}
                  </Button>
                )}
                {extra}
                {secondary && (
                  <Button variant="ghost" block icon={secondary.icon} onClick={secondary.onClick}>
                    {secondary.label}
                  </Button>
                )}
              </>
            )
          }
        >
          <span data-testid="state-screen" data-kind={view.kind}>
            {text}
          </span>
          {error && <span className="mt-3 block text-label text-alert-ink">{error}</span>}
        </StateScreen>
      </main>
    </UiRoot>
  );
}

/** Пояснение к «Вы вышли»: хосту — что будет с правами, остальным — что друзья на месте. */
function leftText(as: LeftAs | undefined): string {
  if (!as?.wasHost) return "Друзья остались в комнате. Вернуться можно сразу.";
  const sec = HOST_HANDOVER_DELAY_SEC;
  const handover = `Если не вернётесь за ${sec} ${plural(sec, ["секунду", "секунды", "секунд"])}, хостом станет другой участник.`;
  return as.isOwner ? `${handover} Права можно будет вернуть в меню комнаты.` : handover;
}
