/** Минимум данных об участнике для выбора нового хоста. */
export type SuccessorCandidate = { identity: string; joinedAt?: Date };

/**
 * Кто займёт свободное место хоста: владелец комнаты, если он здесь, иначе самый
 * ранний по входу, при равенстве — меньший identity. Все участники считают
 * одинаково и приходят к одному ответу, поэтому claim шлёт только победитель.
 * Неизвестное время входа считается самым ранним. Пусто → null.
 */
export function pickHostSuccessor<T extends SuccessorCandidate>(
  participants: readonly T[],
  ownerIdentity: string | null = null,
): T | null {
  if (participants.length === 0) return null;
  const owner = ownerIdentity ? participants.find((p) => p.identity === ownerIdentity) : undefined;
  if (owner) return owner;
  return [...participants].sort((a, b) => {
    const ja = a.joinedAt?.getTime() ?? 0;
    const jb = b.joinedAt?.getTime() ?? 0;
    if (ja !== jb) return ja - jb;
    return a.identity < b.identity ? -1 : 1;
  })[0];
}
