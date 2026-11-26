// Лимиты частоты поверх Redis (@upstash/ratelimit, скользящее окно). Счётчик в
// памяти процесса не годится: инстансов может быть несколько, а лимит общий.
import { Ratelimit } from "@upstash/ratelimit";
import { peekRuntimeConfig } from "./platform/runtimeConfig";
import { getRedis, getRedisRaw } from "./redis";

// Лимитеры ленивые: создаются при первом обращении, чтобы не трогать env на сборке.
type LimitWindow = Parameters<typeof Ratelimit.slidingWindow>[1];
function lazyLimiter(tokens: number, window: LimitWindow, prefix: string): () => Ratelimit {
  let inst: Ratelimit | null = null;
  return () =>
    (inst ??= new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(tokens, window),
      prefix,
    }));
}

/**
 * Вход в комнату: ключ IP:КОД. 30 в минуту — в клубе вся компания сидит за одним
 * внешним IP: пять человек заходят разом, пара перезагрузок — 10 было мало (m4).
 * Перебор пароля сдерживает отдельный лимит ниже, коды комнат — их пространство
 * (31⁶ ≈ 887 млн при единицах живых комнат).
 */
export const joinLimit = lazyLimiter(30, "1 m", "rl:token");

/**
 * Неудачные пароли на КОМНАТУ (ключ — код), поверх лимита по IP: код публичной
 * комнаты виден в витрине, и лимит по IP обходится сменой адреса. Остаток
 * проверяется ДО сверки пароля: при исчерпанном лимите верный пароль тоже ждёт,
 * иначе перебор продолжался бы, просто ошибки выглядели бы как 429. Списывается
 * только неудача. Осознанный компромисс: во время атаки опечатавшийся друг тоже
 * подождёт — зато пароль не угадать.
 */
export const passwordFailLimit = lazyLimiter(20, "10 m", "rl:tokenFail");

/**
 * Превью комнаты в лобби: ключ IP:КОД, вдвое мягче входа — лобби может
 * переспрашивать состав, пока человек вводит ник, а в клубе все за одним IP.
 */
export const previewLimit = lazyLimiter(60, "1 m", "rl:preview");

/** Создание комнат: ключ IP — против спама комнатами. */
export const createRoomLimit = lazyLimiter(5, "1 m", "rl:createRoom");

/** Витрина публичных комнат: ключ IP. */
export const listRoomsLimit = lazyLimiter(30, "1 m", "rl:listRooms");

/** Модерация: ключ IP (хост щёлкает настройки, участники занимают место хоста). */
export const moderateLimit = lazyLimiter(60, "1 m", "rl:moderate");

/** Сообщения чата: ключ КОД:identity — у каждого участника свой счётчик. */
export const chatLimit = lazyLimiter(8, "10 s", "rl:chat");

/** История чата: ключ IP. */
export const chatHistoryLimit = lazyLimiter(30, "1 m", "rl:chatHistory");

/**
 * «Звук выкл» и рация для других (POST /api/voice): ключ КОД:identity. Клиент
 * шлёт с паузой 300 мс, так что 10 за 10 с хватает и с запасом; дальше — спам D,
 * а каждая запись LiveKit рассылает всей комнате.
 */
export const voiceLimit = lazyLimiter(10, "10 s", "rl:voice");

/**
 * Реакции (POST /api/reaction): ключ КОД:identity. Клиент сам держит 5 за 5 с
 * (REACTION_BURST в контракте); здесь вдвое шире: скользящее окно Upstash
 * приблизительное и на стыке окон считало бы честную очередь флудом. Отказ
 * получает только тот, кто шлёт в обход клиента.
 */
export const reactionLimit = lazyLimiter(10, "5 s", "rl:reaction");

/**
 * Соундборд (POST /api/sound): ключ КОД:identity. Клиент сам держит 3 за 10 с
 * (SOUND_BURST в контракте); здесь вдвое шире — по той же причине, что у реакций.
 */
export const soundLimit = lazyLimiter(6, "10 s", "rl:sound");

/**
 * Соундборд на всю комнату: ключ — код. Десять человек по три звука за 10 с —
 * уже не вечер, а шум: комнате хватит 10 звуков за 10 с на всех.
 */
export const soundRoomLimit = lazyLimiter(10, "10 s", "rl:soundRoom");

/** Загрузка своего звука (POST /api/sounds): ключ КОД:identity, три файла за 10 минут. */
export const soundUploadLimit = lazyLimiter(3, "10 m", "rl:soundUp");

/** Список и файлы звуков комнаты: ключ адрес; открыть панель и подтянуть 12 файлов не флуд. */
export const soundReadLimit = lazyLimiter(120, "1 m", "rl:soundRead");

/** Игры (POST /api/game): ключ КОД:identity — кубик и «Кто платит?» не чаще 6 за 10 с. */
export const gameLimit = lazyLimiter(6, "10 s", "rl:game");

/**
 * «Все готовы?» на комнату: ключ — код. Опрос идёт 30 с (READY_CHECK_MS) и
 * всплывает у каждого — новый не чаще раза в 20 с, кто бы его ни начал.
 */
export const readyCheckLimit = lazyLimiter(1, "20 s", "rl:ready");

/**
 * Статус «в игре / отошёл / слушаю» (POST /api/status): ключ КОД:identity.
 * Клиент шлёт с паузой и только при смене; каждая запись LiveKit рассылает всей
 * комнате, поэтому 10 за 30 с.
 */
export const statusLimit = lazyLimiter(10, "30 s", "rl:status");

/**
 * Рисунок Румика для других (POST /api/avatar): ключ КОД:identity. Клиент шлёт
 * при входе и при смене рисунка, не чаще раза в 5 с (AVATAR_SYNC_GAP_MS), а пока
 * рисуют — после затишья; здесь 4 за 15 с — с запасом на приблизительность
 * скользящего окна на стыке.
 */
export const avatarLimit = lazyLimiter(4, "15 s", "rl:avatar");

/**
 * Новые рисунки на сервере с одного адреса (ключ — сеть, clientNet; повтор уже
 * лежащего не считается): 20 за 10 минут — клуб из десятка человек за одним
 * адресом входит со своими рисунками, а залить Redis картинками с одного адреса
 * нельзя.
 */
export const avatarNewIpLimit = lazyLimiter(20, "10 m", "rl:avatarNew");

/**
 * Новые рисунки на сервере в одной комнате (ключ — код): по умолчанию 40 за 10
 * минут. В комнате до 25 человек (по ключу клуба), каждый входит со своим
 * рисунком и пару раз его меняет; больше — это уже не рисование, а заливка
 * хранилища из одной комнаты с разных адресов. Общий потолок на весь сайт —
 * суточный бюджет в server/avatar.ts.
 *
 * Порог — настройка продукта limits.avatarNewPerRoom. Без аргумента берётся из
 * последнего прочитанного конфига (peekRuntimeConfig): маршрут к этому моменту
 * уже прочитал его для флага. На каждый порог свой лимитер, счётчики у них общие
 * (тот же префикс), так что смена порога не обнуляет окно.
 */
const avatarRoomLimiters = new Map<number, Ratelimit>();
export function avatarNewRoomLimit(perRoom: number = peekRuntimeConfig().limits.avatarNewPerRoom): Ratelimit {
  let inst = avatarRoomLimiters.get(perRoom);
  if (!inst) {
    inst = new Ratelimit({ redis: getRedis(), limiter: Ratelimit.slidingWindow(perRoom, "10 m"), prefix: "rl:avatarRoom" });
    avatarRoomLimiters.set(perRoom, inst);
  }
  return inst;
}

/**
 * Чтение рисунков (GET /api/avatar/<id>): ключ — сеть адреса (clientNet). Браузер
 * берёт каждую картинку один раз и держит в кеше, так что 300 в минуту хватает и
 * клубу за одним адресом; перебор id упирается в лимит.
 */
export const avatarReadLimit = lazyLimiter(300, "1 m", "rl:avatarGet");

/**
 * Сеть клиента для лимитов рисунков: IPv4 — сам адрес, IPv6 — его /64. Абонент
 * обычно получает от провайдера целую /64, и счётчик по полному IPv6 обходится
 * сменой адреса внутри неё. IPv4 внутри IPv6 (::ffff:1.2.3.4) — как IPv4.
 */
export function clientNet(request: Request): string {
  return ipNet(clientIp(request));
}

/** Адрес → ключ сети (см. clientNet). Не IPv6 или кривой — как есть. */
export function ipNet(ip: string): string {
  const groups = ipv6Groups(ip);
  if (!groups) return ip;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return [groups[6]! >> 8, groups[6]! & 255, groups[7]! >> 8, groups[7]! & 255].join(".");
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

/** Восемь 16-битных групп IPv6 (сжатие «::», хвост IPv4, зона «%eth0», скобки); не IPv6 — null. */
function ipv6Groups(ip: string): number[] | null {
  let s = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!s.includes(":")) return null;
  s = s.replace(/%.*$/, "");
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) {
    const b = v4.slice(1).map(Number);
    if (b.some((x) => x > 255)) return null;
    s = `${s.slice(0, v4.index)}${((b[0]! << 8) | b[1]!).toString(16)}:${((b[2]! << 8) | b[3]!).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const part = (x: string) => (x === "" ? [] : x.split(":"));
  const head = part(halves[0]!);
  const tail = halves.length === 2 ? part(halves[1]!) : [];
  const gap = 8 - head.length - tail.length;
  if (halves.length === 2 ? gap < 1 : gap !== 0) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? gap : 0).fill("0"), ...tail];
  if (!all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

/** Жалобы из комнаты: 5 за 10 минут — отдельно на участника (КОД:identity) и на IP. */
export const reportLimit = lazyLimiter(5, "10 m", "rl:report");
export const reportIpLimit = lazyLimiter(5, "10 m", "rl:reportIp");

/** Настройки продукта для браузера (GET /api/config): ключ IP, мягко — их спрашивает каждая страница. */
export const configLimit = lazyLimiter(120, "1 m", "rl:config");

/** Маяк страниц (POST /api/ev): ключ IP. Сверх лимита события молча отбрасываются. */
export const beaconLimit = lazyLimiter(60, "1 m", "rl:ev");

/** Чтение своей заявки и пометок «есть ответ»: ключ IP. */
export const leadReadLimit = lazyLimiter(60, "1 m", "rl:leadRead");

/** Сообщения в диалог заявки: ключ IP. */
export const leadMessageLimit = lazyLimiter(20, "10 m", "rl:leadMsg");

/**
 * IP клиента для лимитов. X-Real-IP выставляет Caddy и затирает присланный
 * клиентом (deploy/Caddyfile): ему и доверяем. ЛЕВЫЙ элемент X-Forwarded-For
 * задаёт клиент — брать его нельзя. Вне прокси — ПРАВЫЙ элемент (адрес от
 * ближайшего доверенного прокси). "local" — дев.
 */
export function clientIp(request: Request): string {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  return "local";
}

function secondsUntil(resetMs: number): number {
  return Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));
}

export type LimitVerdict =
  | { limited: false; remaining: number | null }
  | { limited: true; retryAfterSec: number };

/**
 * Списывает одну попытку. Если Redis недоступен — пропускаем (fail-open) и пишем
 * в лог: без Redis вход всё равно закрыт (состояние комнаты лежит там же), а
 * лимит не должен быть единственной причиной отказа. remaining: null — неизвестно.
 */
export async function consumeLimit(limiter: Ratelimit, identifier: string): Promise<LimitVerdict> {
  try {
    const { success, remaining, reset } = await limiter.limit(identifier);
    return success
      ? { limited: false, remaining }
      : { limited: true, retryAfterSec: secondsUntil(reset) };
  } catch (err) {
    console.error("rate limit check failed", err);
    return { limited: false, remaining: null };
  }
}

/**
 * Остаток попыток БЕЗ списания. null — Redis недоступен (вызывающий решает сам;
 * для пароля это «пропустить проверку остатка», дальше сработает обычная сверка).
 */
export async function peekLimit(
  limiter: Ratelimit,
  identifier: string,
): Promise<{ remaining: number; retryAfterSec: number } | null> {
  try {
    const { remaining, reset } = await limiter.getRemaining(identifier);
    return { remaining, retryAfterSec: secondsUntil(reset) };
  } catch (err) {
    console.error("rate limit peek failed", err);
    return null;
  }
}

/**
 * Глобальный лимит с меняющимся порогом (настройки продукта): фиксированное окно
 * windowSec на счётчике INCR. limit ≤ 0 — без ограничения. Redis недоступен —
 * пропускаем (как consumeLimit).
 */
export async function consumeWindow(
  name: string,
  limit: number,
  windowSec: number,
  now: number = Date.now(),
): Promise<LimitVerdict> {
  if (limit <= 0) return { limited: false, remaining: null };
  const window = Math.floor(now / 1000 / windowSec);
  const key = `gr:rl:${name}:${window}`;
  try {
    const redis = getRedisRaw();
    const n = Number(await redis.incr(key));
    if (n === 1) await redis.expire(key, windowSec * 2);
    if (n > limit) {
      const resetMs = (window + 1) * windowSec * 1000;
      return { limited: true, retryAfterSec: secondsUntil(resetMs) };
    }
    return { limited: false, remaining: limit - n };
  } catch (err) {
    console.error("window limit check failed", err);
    return { limited: false, remaining: null };
  }
}
