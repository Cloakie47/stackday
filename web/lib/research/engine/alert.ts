/**
 * Alert when a spend cap stops a run (founder spec section 6: "spend caps per run and per day, with
 * an alert when a cap is hit"). Always logs a warning; when RESEARCH_ALERT_WEBHOOK_URL is set (an
 * https URL, for example a Slack or Discord incoming webhook) it also POSTs `{ text }` there.
 * Never throws and never sends keys or request details: only the run id and the reason.
 */

export type AlertFn = (message: string) => Promise<void>;

export function webhookAlert(url: string | undefined = process.env.RESEARCH_ALERT_WEBHOOK_URL, fetchFn: typeof fetch = fetch): AlertFn {
  return async (message) => {
    const text = `[research] ${message}`.slice(0, 1000);
    console.warn(text);
    if (!url || !url.startsWith("https://")) return;
    try {
      await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, content: text }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // The warning above is the fallback.
    }
  };
}

/** The alert used when a run is not given one: reads the webhook URL at call time. */
export const defaultAlert: AlertFn = (message) => webhookAlert()(message);
