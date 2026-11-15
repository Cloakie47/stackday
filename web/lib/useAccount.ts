"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignMessage } from "wagmi";
import { buildSignInMessage } from "./signin";
import { shortAddr } from "./format";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? "Something went wrong.");
  return body as T;
}

/**
 * The account database session. Signing in is one free wallet signature (no transaction).
 * `configured` is false when the database has not been connected, and everything that
 * needs it switches itself off.
 */
export function useSession() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api<{ configured: boolean; address: string | null }>("/api/session"),
    staleTime: 30_000,
  });

  const signedIn = !!address && session.data?.address === address.toLowerCase();

  const signIn = useCallback(async () => {
    if (!address) return false;
    setBusy(true);
    setError(undefined);
    try {
      // A single-use code from the server, signed together with this site's name and the chain.
      const { nonce } = await api<{ nonce: string }>("/api/session/nonce", { method: "POST" });
      const message = buildSignInMessage({
        address,
        domain: window.location.host,
        uri: window.location.origin,
        nonce,
        issuedAt: new Date(),
      });
      const signature = await signMessageAsync({ message });
      await api("/api/session", { method: "POST", body: JSON.stringify({ message, signature }) });
      await queryClient.invalidateQueries();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "Could not sign in.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [address, signMessageAsync, queryClient]);

  return { configured: session.data?.configured ?? false, loading: session.isLoading, signedIn, signIn, busy, error };
}

/**
 * Display names for a set of wallets: the business name if the wallet owns a business, else the
 * person's chosen name, else a shortened address. Also exposes each wallet's unique ID.
 */
export function useNames(wallets: (string | undefined)[]) {
  const list = Array.from(new Set(wallets.filter((w): w is string => !!w).map((w) => w.toLowerCase()))).sort();
  const key = list.join(",");
  const people = useQuery({
    queryKey: ["names", key],
    queryFn: () =>
      api<{ configured: boolean; profiles: Record<string, string>; ids: Record<string, string> }>(`/api/profile?wallets=${key}`),
    enabled: list.length > 0,
    staleTime: 60_000,
  });
  const firms = useQuery({
    queryKey: ["businesses", key],
    queryFn: () =>
      api<{ configured: boolean; businesses: Record<string, { name: string; description: string }> }>(`/api/business?wallets=${key}`),
    enabled: list.length > 0,
    staleTime: 60_000,
  });
  const profiles = people.data?.profiles ?? {};
  const ids = people.data?.ids ?? {};
  const businesses = firms.data?.businesses ?? {};
  const nameOf = (wallet?: string) => (wallet ? profiles[wallet.toLowerCase()] : undefined);
  const idOf = (wallet?: string) => (wallet ? ids[wallet.toLowerCase()] : undefined);
  const businessOf = (wallet?: string) => (wallet ? businesses[wallet.toLowerCase()] : undefined);
  const display = (wallet?: string) => businessOf(wallet)?.name ?? (nameOf(wallet) ? `@${nameOf(wallet)}` : shortAddr(wallet));
  return { nameOf, idOf, businessOf, display, configured: people.data?.configured ?? false };
}

export async function saveUsername(username: string) {
  return api<{ username: string }>("/api/profile", { method: "POST", body: JSON.stringify({ username }) });
}

export type TeamMember = { wallet: string; name: string; role: string; salary: string; status?: "invited" | "accepted" };

/**
 * An employer's team list. Saved in the account database when it is connected and the employer
 * is signed in. Otherwise it is kept in this browser only, so payroll still works without it.
 */
export function useTeam(employer: string | undefined, useDatabase: boolean) {
  const queryClient = useQueryClient();
  const key = employer ? `stackday-team-${employer.toLowerCase()}` : undefined;
  const [local, setLocal] = useState<TeamMember[]>([]);

  useEffect(() => {
    if (!key) return setLocal([]);
    try {
      setLocal(JSON.parse(window.localStorage.getItem(key) ?? "[]"));
    } catch {
      setLocal([]);
    }
  }, [key]);

  const remote = useQuery({
    queryKey: ["team", employer?.toLowerCase()],
    queryFn: async () => {
      const r = await api<{
        employees: { employee_wallet: string; name: string; role: string; salary_usdc: number; status: "invited" | "accepted" }[];
      }>("/api/employees");
      return r.employees.map((e) => ({
        wallet: e.employee_wallet,
        name: e.name,
        role: e.role,
        salary: String(Number(e.salary_usdc)),
        status: e.status,
      }));
    },
    enabled: !!employer && useDatabase,
  });

  const team = useDatabase ? (remote.data ?? []) : local;

  const save = useCallback(
    async (member: TeamMember) => {
      if (useDatabase) {
        await api("/api/employees", { method: "POST", body: JSON.stringify(member) });
        await queryClient.invalidateQueries({ queryKey: ["team"] });
      } else if (key) {
        const next = [...local.filter((m) => m.wallet.toLowerCase() !== member.wallet.toLowerCase()), member];
        setLocal(next);
        window.localStorage.setItem(key, JSON.stringify(next));
      }
    },
    [useDatabase, key, local, queryClient],
  );

  const remove = useCallback(
    async (wallet: string) => {
      if (useDatabase) {
        await api(`/api/employees?wallet=${wallet}`, { method: "DELETE" });
        await queryClient.invalidateQueries({ queryKey: ["team"] });
      } else if (key) {
        const next = local.filter((m) => m.wallet.toLowerCase() !== wallet.toLowerCase());
        setLocal(next);
        window.localStorage.setItem(key, JSON.stringify(next));
      }
    },
    [useDatabase, key, local, queryClient],
  );

  return { team, save, remove, loading: useDatabase && remote.isLoading, saved: useDatabase ? "database" : "browser" };
}

export function useAttendance(enabled: boolean) {
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ["attendance"],
    queryFn: () =>
      api<{ today: string; since: string; mine: string[]; team: Record<string, string[]> }>("/api/attendance?days=14"),
    enabled,
  });
  const checkIn = useCallback(async () => {
    await api("/api/attendance", { method: "POST" });
    await queryClient.invalidateQueries({ queryKey: ["attendance"] });
  }, [queryClient]);
  return { data: q.data, loading: q.isLoading, checkIn };
}

/** The last `n` days as YYYY-MM-DD, oldest first, ending today (UTC). Empty until the page is in the browser. */
export function useLastDays(n: number) {
  const [days, setDays] = useState<string[]>([]);
  useEffect(() => {
    setDays(Array.from({ length: n }, (_, i) => new Date(Date.now() - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10)));
  }, [n]);
  return days;
}

// ------------------------------------------------------------------ account type, business, invitations

export type Me = {
  profile: { wallet: string; uid: string; username: string | null; account_type: "individual" | "business" | null };
  business: { name: string; description: string } | null;
  memberships: { employer: string; businessName: string | null; role: string; status: "invited" | "accepted" }[];
};

export type Role = "individual" | "owner" | "employee";
/** The two interfaces. Personal = investing for yourself. Business = running payroll or being paid by one. */
export type Mode = "personal" | "business";

const MODE_KEY = (address: string) => `stackday-mode-${address.toLowerCase()}`;
const MODE_EVENT = "stackday-mode";

/** The mode remembered on this device, used when the account database is off or before it answers. */
function useLocalMode(address: string | undefined) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const read = () => {
      try {
        const v = address ? window.localStorage.getItem(MODE_KEY(address)) : null;
        setMode(v === "personal" || v === "business" ? v : null);
      } catch {
        setMode(null);
      }
      setLoaded(true);
    };
    read();
    window.addEventListener(MODE_EVENT, read);
    return () => window.removeEventListener(MODE_EVENT, read);
  }, [address]);
  return { mode, loaded };
}

export function rememberMode(address: string | undefined, mode: Mode) {
  if (!address) return;
  try {
    window.localStorage.setItem(MODE_KEY(address), mode);
  } catch {
    /* private window: the choice simply is not remembered on this device */
  }
  window.dispatchEvent(new Event(MODE_EVENT));
}

/** Where each mode opens. */
export function homeFor(mode: Mode | undefined, role: Role | undefined) {
  if (mode === "business") return role === "owner" ? "/employer" : "/pay";
  return "/dashboard";
}

/**
 * Who the connected wallet is on Stackday, and which interface it uses.
 * - `ready` is false until we know (so screens do not flash the wrong thing).
 * - `needsSetup` is true when a connected wallet has not picked Personal or Business yet.
 *   The app sends it to /start: the choice is required.
 * - With the account database the choice is saved to the profile. Without it, on this device.
 */
export function useAccountState() {
  const { address, isConnected } = useAccount();
  const session = useSession();
  const local = useLocalMode(address);
  const me = useQuery({
    queryKey: ["me", address?.toLowerCase()],
    queryFn: () => api<Me>("/api/me"),
    enabled: session.configured && session.signedIn,
    staleTime: 15_000,
  });
  const type = me.data?.profile.account_type ?? null;
  const saved: Mode | null = type === "individual" ? "personal" : type === "business" ? "business" : null;
  const mode: Mode | undefined = saved ?? local.mode ?? undefined;
  const role: Role | undefined =
    mode === "personal" ? "individual" : mode === "business" ? (me.data?.business ? "owner" : "employee") : undefined;
  const ready = local.loaded && !session.loading && (!session.signedIn || !me.isLoading);
  const database = session.configured;
  return {
    address,
    isConnected,
    session,
    me: me.data,
    mode,
    role,
    ready,
    needsSetup: isConnected && ready && (database ? !session.signedIn || !saved : !local.mode),
  };
}

/** Switch interface. Saves to the profile when signed in, and always on this device. */
export function useSwitchMode() {
  const queryClient = useQueryClient();
  return useCallback(
    async (address: string | undefined, mode: Mode, signedIn: boolean) => {
      rememberMode(address, mode);
      if (signedIn) {
        await saveAccountType(mode === "personal" ? "individual" : "business");
        // The saved choice wins over this device's, so wait for the fresh profile before moving on.
        await queryClient.refetchQueries({ queryKey: ["me"] });
      }
    },
    [queryClient],
  );
}

export const saveAccountType = (accountType: "individual" | "business") =>
  api<{ accountType: string }>("/api/me", { method: "POST", body: JSON.stringify({ accountType }) });

export const saveBusiness = (name: string, description: string) =>
  api<{ name: string; description: string }>("/api/business", { method: "POST", body: JSON.stringify({ name, description }) });

export type Person = { wallet: string; uid: string | null; username: string | null };

export const searchPeople = (q: string) => api<{ people: Person[]; hint?: string }>(`/api/people?q=${encodeURIComponent(q)}`);

export const answerInvite = (employer: string, action: "accept" | "decline") =>
  api<{ ok: boolean }>("/api/memberships", { method: "POST", body: JSON.stringify({ employer, action }) });
