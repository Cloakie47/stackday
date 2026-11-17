// End-to-end proof of confidential pay on Base Sepolia (Fairblock StableTrust), test money only.
// Employer (test wallet from ../.env) moves 0.10 USDC into a private balance, pays 0.05 privately to a
// fresh throwaway team-member wallet, the team member withdraws it to their normal wallet, and the
// employer withdraws the rest. Prints addresses, amounts and transaction hashes only, never keys.
// Run from web/: node --env-file=../.env scripts/fairblock-e2e.mjs
import { ConfidentialTransferClient } from "@fairblock/stabletrust";
import { ethers } from "ethers";
import d from "../lib/deployment.json" with { type: "json" };

const RPC = "https://sepolia.base.org";
const provider = new ethers.JsonRpcProvider(RPC);
const client = new ConfidentialTransferClient(RPC, 84532);
const employer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const member = ethers.Wallet.createRandom().connect(provider);
const usdc = new ethers.Contract(d.usdc, ["function balanceOf(address) view returns (uint256)"], provider);
const fmt = (v) => ethers.formatUnits(v, 6);
const step = (s) => console.log(`\n== ${s}`);
// Fairblock's network can take several minutes per step on testnet, longer than the SDK's own 90 second wait.
const waitIdle = async (who, label, minutes = 20) => {
  for (let i = 0; i < minutes * 12; i++) {
    const info = await client.getAccountInfo(who.address);
    if (info.exists && info.finalized && !info.pendingAction) return;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`Fairblock did not finish "${label}" within ${minutes} minutes`);
};
const NOWAIT = { waitForFinalization: false };
const bal = async (who, keys) => fmt((await client.getConfidentialBalance(who.address, keys.privateKey, d.usdc)).amount);

console.log({ contract: client.config.contractAddress, employer: employer.address, member: member.address });

step("Give the team member a little test ETH for gas");
const gas = await employer.sendTransaction({ to: member.address, value: ethers.parseEther("0.0004") });
await gas.wait();
console.log("tx", gas.hash);

step("Turn on private pay for both");
const ek = await client.ensureAccount(employer, NOWAIT);
const mk = await client.ensureAccount(member, NOWAIT);
await waitIdle(employer, "employer account");
await waitIdle(member, "member account");
console.log("employer private balance", await bal(employer, ek), "| member", await bal(member, mk));

step("Employer moves 0.10 USDC into the private balance");
const dep = await client.confidentialDeposit(employer, d.usdc, ethers.parseUnits("0.10", 6), NOWAIT);
await waitIdle(employer, "deposit");
console.log("tx", dep.hash ?? dep.transactionHash, "| employer private", await bal(employer, ek));

step("Employer pays 0.05 privately (amount hidden on chain)");
const tr = await client.confidentialTransfer(employer, member.address, d.usdc, ethers.parseUnits("0.05", 6), NOWAIT);
await waitIdle(employer, "transfer");
console.log("tx", tr.hash ?? tr.transactionHash, "| employer private", await bal(employer, ek), "| member private", await bal(member, mk));

step("Team member withdraws 0.05 to their normal wallet");
const before = await usdc.balanceOf(member.address);
const w1 = await client.withdraw(member, d.usdc, ethers.parseUnits("0.05", 6), NOWAIT);
await waitIdle(member, "member withdraw");
console.log("tx", w1.hash ?? w1.transactionHash, "| member wallet USDC", fmt(before), "->", fmt(await usdc.balanceOf(member.address)));

step("Employer withdraws the rest");
const left = (await client.getConfidentialBalance(employer.address, ek.privateKey, d.usdc)).amount;
if (left > 0n) {
  const w2 = await client.withdraw(employer, d.usdc, left, NOWAIT);
  await waitIdle(employer, "employer withdraw");
  console.log("tx", w2.hash ?? w2.transactionHash, "| employer private", await bal(employer, ek));
}
console.log("\nDONE");
