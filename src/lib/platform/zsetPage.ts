// Страница отсортированного множества с «нового» конца (большие score) без ZRANGE
// REV (он есть только с Redis 6.2, а локальный стенд — Redis 5): обычный ZRANGE
// с отрицательными индексами и разворот.
import { getRedisRaw } from "@/lib/redis";

export async function newestMembers(key: string, offset: number, count: number): Promise<string[]> {
  if (count <= 0) return [];
  const raw = (await getRedisRaw().zrange(key, -(offset + count), -(offset + 1))) as unknown[];
  return raw.map(String).reverse();
}
