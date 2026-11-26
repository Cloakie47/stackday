/** A line of the pay record kept on this device (lib/confidential.ts PrivateRecord). */
export type PayRecordLike = { kind: "paid" | "collected" | "invested"; private?: boolean };

/**
 * What a record line says. A normal Payroll payment is saved with `private: false` and must not be
 * shown as private. Records saved before the flag existed were all private payments.
 */
export function recordLabel(r: PayRecordLike): string {
  if (r.kind === "collected") return "Collected";
  if (r.kind === "invested") return "Invested";
  return r.private === false ? "Paid" : "Paid privately";
}
