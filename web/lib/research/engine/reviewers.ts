/**
 * Reviewers (founder spec section 6, human in the loop while testing): the founder and growth
 * wallets listed in RESEARCH_REVIEWERS (comma-separated, lowercase), signed in with the existing
 * wallet sign-in. Only reviewers see live daily notes, unapproved weekly reports, and can approve
 * a report or grade a note.
 */
const WALLET = /^0x[0-9a-f]{40}$/;

export function reviewerList(raw: string | undefined = process.env.RESEARCH_REVIEWERS): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => WALLET.test(s)),
  );
}

export function isReviewer(wallet: string | null | undefined, list: Set<string> = reviewerList()): boolean {
  return typeof wallet === "string" && list.has(wallet.toLowerCase());
}
