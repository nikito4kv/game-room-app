// Lua-скрипты платформы (конфиг, заявки, ключи, жалобы). Модуль без импортов — его
// же читает фейковый Redis в тестах (server/testFakes.ts), как redisScripts.ts.

/**
 * Сравнить-и-заменить строковое значение: записать ARGV[2], только если сейчас в
 * ключе ровно ARGV[1] ("" — ключа нет). Срок жизни ключа сохраняется (PTTL → PX:
 * KEEPTTL есть только с Redis 6, а локальный стенд — Redis 5).
 * Так JSON-записи (конфиг, заявка, ключ клуба) меняются без потерянных обновлений:
 * параллельный писатель увидит 0 и перечитает.
 * Ответ: 1 — записали, 0 — значение успело поменяться.
 */
export const CAS_STRING_LUA = `
local cur = redis.call('GET', KEYS[1])
if not cur then cur = '' end
if cur ~= ARGV[1] then return 0 end
local ttl = redis.call('PTTL', KEYS[1])
if ttl > 0 then redis.call('SET', KEYS[1], ARGV[2], 'PX', ttl) else redis.call('SET', KEYS[1], ARGV[2]) end
return 1
`;
