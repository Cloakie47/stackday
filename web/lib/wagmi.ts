import { createConfig, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { coinbaseWallet, injected, mock } from "wagmi/connectors";

const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://sepolia.base.org";

/**
 * LOCAL TESTING ONLY. When NEXT_PUBLIC_DEV_ACCOUNT is set, a pretend wallet for that address is
 * offered. It only works against a local simulated chain (anvil with auto-impersonate), never
 * against the real network, because it has no key and cannot sign anything.
 */
const devAccount = process.env.NEXT_PUBLIC_DEV_ACCOUNT as `0x${string}` | undefined;

// The pretend wallet sends through the chain's default address, so point that at the local chain too.
const chain = devAccount ? { ...baseSepolia, rpcUrls: { default: { http: [rpcUrl] } } } : baseSepolia;

export const config = createConfig({
  chains: [chain],
  // A browser wallet first (MetaMask, Rabby, the Coinbase extension), then Coinbase Smart Wallet:
  // a passkey wallet in the browser that signs every step of an action at once (EIP-5792), so a
  // sell or a borrow is one popup instead of several.
  connectors: devAccount
    ? [mock({ accounts: [devAccount] }), injected()]
    : [injected(), coinbaseWallet({ appName: "Stackday", preference: { options: "smartWalletOnly" } })],
  transports: { [baseSepolia.id]: http(rpcUrl) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
