// Read-only: Fairblock StableTrust on Base Sepolia, fees and our test wallet's balances.
// Run from web/: node --env-file=../.env scripts/fairblock-check.mjs   (prints no secrets)
import { ConfidentialTransferClient } from "@fairblock/stabletrust";
import { ethers } from "ethers";
import d from "../lib/deployment.json" with { type: "json" };
const RPC = "https://sepolia.base.org";
const client = new ConfidentialTransferClient(RPC, 84532);
const provider = new ethers.JsonRpcProvider(RPC);
const me = new ethers.Wallet(process.env.PRIVATE_KEY).address;
const usdc = new ethers.Contract(d.usdc, ["function balanceOf(address) view returns (uint256)", "function symbol() view returns (string)"], provider);
const feeToken = await client.getFeeToken();
console.log({
  contract: client.config.contractAddress,
  wallet: me,
  eth: ethers.formatEther(await provider.getBalance(me)),
  usdc: d.usdc, usdcSymbol: await usdc.symbol(), usdcBalance: ethers.formatUnits(await usdc.balanceOf(me), 6),
  feeToken, transferFee: String(await client.getNonAnonymousTransferFee()),
  account: (await client.getAccountInfo(me)).exists,
});
