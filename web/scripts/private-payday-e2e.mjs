// End-to-end proof of the private payday flow on Base Sepolia, test money only. Mirrors the app:
// 1. Employer (test wallet from ../.env) pays a fresh team member 0.50 USDC privately (Private payday panel:
//    top up the private balance, then one encrypted transfer, waiting for Fairblock between steps).
// 2. The team member collects 20% and invests it in mAAPL in one go (Private pay card on My pay):
//    withdraw the share, wait for Fairblock, then a one-time buy into their own vault (no Stackday fee).
//    The other 80% stays in the private balance.
// Prints addresses, amounts and transaction hashes only, never keys.
// Run from web/: node --env-file=../.env scripts/private-payday-e2e.mjs
import { ConfidentialTransferClient } from "@fairblock/stabletrust";
import { ethers } from "ethers";
import d from "../lib/deployment.json" with { type: "json" };

const RPC = "https://sepolia.base.org";
const provider = new ethers.JsonRpcProvider(RPC);
const client = new ConfidentialTransferClient(RPC, 84532);
const employer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const member = ethers.Wallet.createRandom().connect(provider);
const erc20 = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"];
const usdc = new ethers.Contract(d.usdc, erc20, provider);
const router = new ethers.Contract(d.sipRouter, ["function invest(address,uint256,uint256) returns (uint256)", "function investedOf(address,address) view returns (uint256)"], member);
const factory = new ethers.Contract(d.vaultFactory, ["function vaultOf(address) view returns (address)"], provider);
const fmt = (v) => ethers.formatUnits(v, 6);
const CENT = 10_000n;
const NOWAIT = { waitForFinalization: false };
const step = (s) => console.log(`\n== ${s}`);
const waitIdle = async (who, label, minutes = 20) => {
  for (let i = 0; i < minutes * 12; i++) {
    const info = await client.getAccountInfo(who.address);
    if (info.exists && info.finalized && !info.pendingAction) return;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`Fairblock did not finish "${label}" within ${minutes} minutes`);
};
const priv = async (who, keys) => (await client.getConfidentialBalance(who.address, keys.privateKey, d.usdc)).amount;
const t0 = Date.now();
const secs = () => `${Math.round((Date.now() - t0) / 1000)}s`;

console.log({ fairblock: client.config.contractAddress, employer: employer.address, member: member.address });

step("Team member: a little test ETH for gas, then turn on private pay (as on the team invite)");
await (await employer.sendTransaction({ to: member.address, value: ethers.parseEther("0.0006") })).wait();
const mk = await client.ensureAccount(member, NOWAIT);
const ek = await client.ensureAccount(employer, NOWAIT);
await waitIdle(member, "member account");
await waitIdle(employer, "employer account");
console.log("ready", secs());

step("Employer: private payday of 0.50 USDC to the team member");
const salary = ethers.parseUnits("0.50", 6);
const have = BigInt(await priv(employer, ek));
if (have < salary) {
  const dep = await client.confidentialDeposit(employer, d.usdc, salary - have, NOWAIT);
  await waitIdle(employer, "deposit");
  console.log("top-up tx", dep.hash ?? dep.transactionHash, secs());
}
const tr = await client.confidentialTransfer(employer, member.address, d.usdc, salary, NOWAIT);
await waitIdle(employer, "transfer");
console.log("encrypted transfer tx", tr.hash ?? tr.transactionHash, secs());
await waitIdle(member, "member receives");
const got = BigInt(await priv(member, mk));
console.log("member private balance (decrypted by the member only):", fmt(got));

step("Team member: collect and invest 20%, keep the rest private");
const share = ((got * 20n) / 100n / CENT) * CENT;
const quote = await client.getWithdrawalFeeQuote(d.usdc, share);
console.log("withdraw", fmt(share), "| Fairblock estimates", fmt(quote.estimatedNetAmount), "arrives");
const before = await usdc.balanceOf(member.address);
const w = await client.withdraw(member, d.usdc, share, NOWAIT);
await waitIdle(member, "withdraw");
const arrived = (await usdc.balanceOf(member.address)) - before;
console.log("withdraw tx", w.hash ?? w.transactionHash, "| arrived", fmt(arrived), secs());
if (arrived === 0n) throw new Error("nothing arrived in the wallet");
await (await new ethers.Contract(d.usdc, erc20, member).approve(d.sipRouter, arrived)).wait();
const buy = await router.invest(d.mAAPL, arrived, 0n);
await buy.wait();
const vault = await factory.vaultOf(member.address);
const shares = await new ethers.Contract(d.mAAPL, erc20, provider).balanceOf(vault);
console.log("buy tx", buy.hash, "| vault", vault, "| mAAPL in vault", ethers.formatUnits(shares, 8), "| investedOf", fmt(await router.investedOf(member.address, d.mAAPL)));
console.log("member private balance left:", fmt(await priv(member, mk)), "(stays private)");
console.log("\nDONE in", secs());
