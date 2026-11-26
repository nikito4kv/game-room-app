"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AvatarStack } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconButton } from "@/components/ui/IconButton";
import { Icon } from "@/components/ui/icons";
import { InlineAlert } from "@/components/ui/InlineAlert";
import { SegmentedControl, type SegmentOption } from "@/components/ui/SegmentedControl";
import { Skeleton } from "@/components/ui/Spinner";
import { TextField } from "@/components/ui/TextField";
import { ClubBadge } from "@/components/platform/ClubBadge";
import type { PublicRoomSummary } from "@/lib/api/contract";
import { listPublicRooms } from "@/lib/client/api";
import { usePublicConfig } from "@/lib/client/usePublicConfig";
import { isAbortError, isApiError } from "@/lib/client/errors";
import {
  filterRooms,
  roomCapacity,
  roomRowLabel,
  roomStatus,
  roomsSummary,
  type RoomFilter,
  type RoomStatus,
} from "./roomList";

const FILTERS: SegmentOption<RoomFilter>[] = [
  { value: "all", label: "Все" },
  { value: "open", label: "Без пароля" },
  { value: "password", label: "С паролем" },
];

/**
 * Список обновляется при возврате на вкладку, но не чаще раза в 10 с: сервер
 * пускает 30 запросов в минуту с адреса, а в клубе адрес один на всех.
 * Опроса по таймеру нет — в покое страница ничего не делает.
 */
const REVISIT_REFRESH_MS = 10_000;

/**
 * Витрина открытых комнат: поиск, фильтр, список. `emptyVisual` — картинка пустого
 * списка (спящий Румик): её рисует серверная страница, чтобы код Румика не ехал в
 * JS этого компонента.
 */
export function OpenRooms({ emptyVisual }: { emptyVisual?: ReactNode }) {
  // null — первая загрузка ещё идёт.
  const [rooms, setRooms] = useState<PublicRoomSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RoomFilter>("all");
  // Каждое увеличение — новая загрузка; прежний запрос эффект отменяет сам.
  const [reloadKey, setReloadKey] = useState(0);
  const lastLoadAt = useRef(0);

  useEffect(() => {
    const ctrl = new AbortController();
    lastLoadAt.current = Date.now();
    listPublicRooms(ctrl.signal).then(
      (list) => {
        setRooms(list);
        setError(null);
        setRefreshing(false);
      },
      (err: unknown) => {
        if (isAbortError(err)) return;
        setRooms((prev) => prev ?? []);
        setError(isApiError(err) ? err.message : "Не получилось загрузить список комнат");
        setRefreshing(false);
      },
    );
    return () => ctrl.abort();
  }, [reloadKey]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastLoadAt.current < REVISIT_REFRESH_MS) return;
      setReloadKey((k) => k + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setReloadKey((k) => k + 1);
  }

  const visible = useMemo(() => (rooms ? filterRooms(rooms, filter, query) : []), [rooms, filter, query]);
  // Головы Румиков, пока флаг rumik_table не выключен (не пришёл — тоже Румики).
  const rumik = usePublicConfig()?.flags.rumik_table !== false;

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <TextField
          type="search"
          icon="search"
          aria-label="Поиск комнаты"
          placeholder="Название, ник хоста или код"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          wrapperClassName="min-w-0 basis-full sm:basis-0 sm:flex-1"
        />
        <div className="flex items-center gap-2 max-sm:w-full">
          <SegmentedControl
            label="Какие комнаты показать"
            value={filter}
            onValueChange={setFilter}
            options={FILTERS}
            className="max-sm:flex-1"
          />
          <IconButton icon="refresh" label="Обновить список" loading={refreshing} onClick={refresh} />
        </div>
      </div>

      <p className="mt-3 min-h-[18px] text-label tabular-nums text-ink-3" aria-live="polite">
        {rooms && rooms.length > 0 ? roomsSummary(rooms) : null}
      </p>

      {error && (
        <InlineAlert
          tone="alert"
          title="Список не загрузился"
          className="mt-3"
          action={
            <Button size="sm" onClick={refresh} loading={refreshing}>
              Попробовать снова
            </Button>
          }
        >
          {error}
        </InlineAlert>
      )}

      {rooms === null ? (
        <ul aria-busy="true" aria-label="Загружаем комнаты" className="-mx-3 mt-3 flex flex-col gap-1 sm:-mx-4">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 px-3 py-3 sm:px-4">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <span className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-44 max-w-full" />
                <Skeleton className="h-3 w-28" />
              </span>
            </li>
          ))}
        </ul>
      ) : rooms.length === 0 ? (
        !error && (
          <EmptyState
            className="mt-12"
            visual={emptyVisual}
            icon={emptyVisual ? undefined : "globe"}
            // Сразу под h1 страницы — h2, иначе уровень заголовка перепрыгнет.
            titleAs="h2"
            title="Сейчас открытых комнат нет"
            description="Комната появляется здесь, когда хост показал её всем и внутри кто-то есть. Создайте свою и позовите друзей."
            actions={
              <Link href="/" className={buttonClass({ variant: "primary" })}>
                <Icon name="plus" size={18} className="-ml-0.5" />
                Создать комнату
              </Link>
            }
          />
        )
      ) : visible.length === 0 ? (
        <EmptyState
          size="sm"
          className="mt-10"
          icon="search"
          titleAs="h2"
          title="Ничего не нашлось"
          description="Попробуйте другое название или другой фильтр"
          actions={
            <Button
              variant="ghost"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              Показать все комнаты
            </Button>
          }
        />
      ) : (
        <ul className="-mx-3 mt-1 flex flex-col gap-1 sm:-mx-4">
          {visible.map((room) => (
            <li key={room.code}>
              <RoomRow room={room} rumik={rumik} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: RoomStatus }) {
  if (status === "locked") {
    return (
      <Badge tone="caution" size="sm" icon="lock">
        Вход закрыт
      </Badge>
    );
  }
  if (status === "full") {
    return (
      <Badge tone="caution" size="sm">
        Мест нет
      </Badge>
    );
  }
  if (status === "password") {
    return (
      <Badge size="sm" icon="key">
        Пароль
      </Badge>
    );
  }
  return null;
}

function RoomRow({ room, rumik }: { room: PublicRoomSummary; rumik: boolean }) {
  const status = roomStatus(room);
  const count = `${room.numParticipants} из ${roomCapacity(room)}`;
  return (
    <Link
      href={`/room/${room.code}`}
      aria-label={roomRowLabel(room)}
      className="group flex items-center gap-3 rounded-card px-3 py-3 transition-colors duration-140 hover:bg-wash-1 sm:gap-4 sm:px-4"
    >
      {/* Слот одной ширины у всех строк — названия стоят ровно друг под другом. */}
      <span className="flex w-[55px] shrink-0">
        {room.hostName ? (
          <AvatarStack
            people={[{ name: room.hostName }]}
            total={room.numParticipants}
            max={1}
            size="sm"
            variant={rumik ? "rumik" : "initials"}
          />
        ) : (
          <span className="grid size-8 place-items-center rounded-full bg-wash-2 text-ink-3">
            <Icon name="users" size={16} />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-body font-medium text-ink">{room.title}</span>
          {room.badge && <ClubBadge badge={room.badge} className="max-w-[10rem]" />}
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-caption text-ink-3">
            {room.hostName ? `${room.hostName} · ` : ""}
            {room.code}
            <span className="sm:hidden"> · {count}</span>
          </span>
          {/* На узком экране статус — во второй строке: название не сжимается в «Закрытая тусов…». */}
          <span className="shrink-0 sm:hidden">
            <StatusBadge status={status} />
          </span>
        </span>
      </span>
      <span className="shrink-0 max-sm:hidden">
        <StatusBadge status={status} />
      </span>
      <span className="w-[4.5rem] shrink-0 whitespace-nowrap text-right text-label tabular-nums text-ink-2 max-sm:hidden">
        {count}
      </span>
      <Icon
        name="chevron-right"
        size={18}
        className="shrink-0 text-ink-3 transition-[translate] duration-140 motion-safe:group-hover:translate-x-0.5"
      />
    </Link>
  );
}
