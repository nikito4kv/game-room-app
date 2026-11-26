// Lua-скрипты состояния комнаты (roomSecret.ts): условные изменения описания за
// одну атомарную операцию Redis. Отдельный модуль без импортов — его же читает
// фейковый Redis в тестах (server/testFakes.ts), чтобы эмулировать скрипты.

/** Создать описание, только если его нет. KEYS[1]=meta; ARGV[1]=ttl; дальше поля. */
export const CREATE_META_LUA = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], unpack(ARGV, 2))
redis.call('EXPIRE', KEYS[1], ARGV[1])
return 1
`;

/** Изменить поля, если описание есть; вернуть новый rev (0 — описания нет). */
export const UPDATE_META_LUA = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('HSET', KEYS[1], unpack(ARGV))
return redis.call('HINCRBY', KEYS[1], 'rev', 1)
`;

/**
 * Сменить хоста, только если сейчас хост — ARGV[1] ("" — хоста нет). Заодно
 * стереть отметку ухода прежнего хоста и снять с нового принудительный мьют и
 * запрет чата: хоста не глушат, а сам с себя он их снять не может.
 * KEYS: meta, hostLeftAt, muted, chatMuted. ARGV: ожидаемый, новый, ник нового.
 * Ответ: rev > 0 — сменили, 0 — описания нет, -1 — хост уже другой.
 */
export const CAS_HOST_LUA = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
local cur = redis.call('HGET', KEYS[1], 'hostIdentity')
if not cur then cur = '' end
if cur ~= ARGV[1] then return -1 end
redis.call('HSET', KEYS[1], 'hostIdentity', ARGV[2], 'hostName', ARGV[3])
redis.call('DEL', KEYS[2])
redis.call('SREM', KEYS[3], ARGV[2])
redis.call('SREM', KEYS[4], ARGV[2])
return redis.call('HINCRBY', KEYS[1], 'rev', 1)
`;
