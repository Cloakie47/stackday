/**
 * The gift card's "confirmed by name" line (docs/features/CHAT-AND-GIFTS.md, 1.3): picks the person the
 * /api/people lookup returned for exactly the ID or username the gift names. Display only: the name is
 * never sent to the model and never decides where money goes.
 */

export type PersonLike = { uid: string | null; username: string | null };

/** "@name" for the one exact match that has a username, else null (the card then shows the ID alone). */
export function recipientName(asked: string, people: readonly PersonLike[]): string | null {
  const byId = /^SD-/.test(asked);
  const matches = people.filter((p) => (byId ? p.uid === asked : p.username === asked));
  if (matches.length !== 1 || !matches[0].username) return null;
  return `@${matches[0].username}`;
}
