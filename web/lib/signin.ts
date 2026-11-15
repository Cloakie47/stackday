/** The exact text a wallet signs to prove who it is. Shared by the browser and the server. */
export function signInMessage(address: string, issuedAt: string) {
  return [
    "Stackday sign-in",
    "",
    "Sign this message to prove you own this wallet. It costs nothing and sends no transaction.",
    "",
    `Wallet: ${address.toLowerCase()}`,
    `Issued: ${issuedAt}`,
  ].join("\n");
}

export const USERNAME_RULE = /^[a-z0-9_]{3,20}$/;
