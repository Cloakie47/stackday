/**
 * Real market price charts, drawn by TradingView's free embeddable widgets (web components).
 * https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/
 *
 * The charts show the REAL asset (for example Apple on Nasdaq), not the testnet mock token, so
 * every chart is labelled as a real market price. No API key is needed. TradingView requires its
 * attribution link, which the widget draws itself.
 *
 * No imports, so it can be unit tested (charts.test.ts).
 */

/** Where the widgets' code is loaded from. Also listed in the security policy. */
export const TV_SCRIPT_BASE = "https://widgets.tradingview-widget.com/w/en";

/** TradingView symbol of the real asset each testnet token stands in for. */
export const TV_SYMBOLS: Record<string, string> = {
  mAAPL: "NASDAQ:AAPL",
  mNVDA: "NASDAQ:NVDA",
  mGOOGL: "NASDAQ:GOOGL",
  mMETA: "NASDAQ:META",
  mPAXG: "OANDA:XAUUSD",
  mTSLA: "NASDAQ:TSLA",
  mAMZN: "NASDAQ:AMZN",
  mMSFT: "NASDAQ:MSFT",
  mMSTR: "NASDAQ:MSTR",
  mAMD: "NASDAQ:AMD",
  mSPX: "AMEX:SPY",
  mSGOV: "AMEX:SGOV",
  mcbBTC: "COINBASE:BTCUSD",
  mWETH: "COINBASE:ETHUSD",
};

/** Assets with no public market to chart (SpaceX is a private company): the chart is left out. */
export const NO_PUBLIC_CHART = new Set(["mSPCX"]);

/** `range` empty means "let the candle size decide the window" (a window can override the candle size). */
export type Timeframe = { id: string; label: string; interval: string; range: string };

/**
 * The founder's timeframes. The short ones set the candle size (1 minute, 5 minutes, 1 hour, 1 day,
 * 1 week, 1 month) over a window that suits it; 1Y and 5Y set the window. `interval` and `range`
 * use TradingView's own values (ranges: 1D, 5D, 1M, 3M, 6M, 12M, 60M, ALL).
 */
export const TIMEFRAMES: Timeframe[] = [
  { id: "1m", label: "1m", interval: "1", range: "" },
  { id: "5m", label: "5m", interval: "5", range: "" },
  { id: "1h", label: "1H", interval: "60", range: "" },
  { id: "1d", label: "1D", interval: "1D", range: "" },
  { id: "1w", label: "1W", interval: "1W", range: "" },
  { id: "1mo", label: "1M", interval: "1M", range: "" },
  { id: "1y", label: "1Y", interval: "1D", range: "12M" },
  { id: "5y", label: "5Y", interval: "1W", range: "60M" },
];

export const DEFAULT_TIMEFRAME = "1d";

export const tvSymbol = (assetSymbol: string): string | undefined => TV_SYMBOLS[assetSymbol];
export const timeframe = (id: string): Timeframe => TIMEFRAMES.find((t) => t.id === id) ?? TIMEFRAMES[3];
