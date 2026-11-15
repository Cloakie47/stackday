# Stackday security checklist

November 15, 2026

This file goes through the list "20 (pen-test level) ways a stranger hacks your vibecoded app" and checks each one against the Stackday web app and account database as they are today. Two of the 20 are real gaps, and three more gaps were found outside the list, so the fix list at the end has six items and none of them is done yet.

This is a self-assessment by the builder, made by reading the code. It is not a penetration test and nobody independent has reviewed it.

## What was checked

- The web app in `web/` (Next.js on Vercel).
- The four server routes in `web/app/api/`: session, profile, employees, attendance.
- The sign-in code in `web/lib/signin.ts` and `web/lib/server/backend.ts`.
- The database layout in `supabase/schema.sql`.
- The smart contracts are covered separately. See "Smart contracts" near the end.

What is at stake in the account database: names, team lists and attendance. No money and no keys. Salaries, vaults and loans live on-chain and do not depend on it.

Meaning of the four statuses:

- **Not applicable**: we do not have the thing this attack targets.
- **Covered**: we have it, and the code handles it.
- **Covered by the hosting provider**: Vercel or Supabase handle it, not our code.
- **GAP**: a real weakness. It is in the fix list.

## Overview

| # | Attack | Applies to Stackday? | Status today |
|---|--------|----------------------|--------------|
| 1 | HTTP/2 Rapid Reset | Only at the hosting level | Covered by the hosting provider |
| 2 | 52-char username | No. No passwords | Not applicable |
| 3 | SAML bypass | No. No SAML | Not applicable |
| 4 | nOAuth email spoof | No. No OAuth, no emails | Not applicable |
| 5 | GraphQL aliases | Partly. Supabase has an unused GraphQL endpoint | Covered |
| 6 | 2FA code replay | Yes, as sign-in signature replay | GAP |
| 7 | ReDoS regex | Yes, we use two patterns | Covered |
| 8 | JWT alg confusion | No. No JWT library | Not applicable |
| 9 | Request smuggling | Only at the hosting level | Covered by the hosting provider |
| 10 | Cache poisoning | Yes | Covered |
| 11 | Spoofed IP header | Yes, because there is no rate limiting at all | Covered (gg/rate-limit) |
| 12 | Views bypass RLS | Yes, as a rule for the future | Covered |
| 13 | Math.random tokens | Yes | Covered |
| 14 | Timing attack | Yes | Covered |
| 15 | Padding oracle | No. Nothing is encrypted by our code | Not applicable |
| 16 | Prototype pollution | Yes | Covered |
| 17 | Template injection | Yes | Covered |
| 18 | XXE file read | No. No XML | Not applicable |
| 19 | WebSocket hijack | No. No WebSocket server of our own | Not applicable |
| 20 | Unicode lookalike names | Yes | Covered |

Totals: 7 Not applicable, 9 Covered, 2 Covered by the hosting provider, 2 GAP.

## The 20 checks in detail

### 1. HTTP/2 Rapid Reset

**The attack:** An attacker opens thousands of requests and cancels each one at once. The server does the work anyway and falls over.

**Does it apply to Stackday?** Only at the hosting level. We run no server of our own. Vercel and Supabase accept the connections.

**Status today:** Covered by the hosting provider.

**Check to do:** Nothing in our code. If the app is ever self-hosted, this becomes our problem: the web server and proxy would need to be patched and limited by us.

### 2. 52-char username

**The attack:** Some password systems only read the first 72 bytes of what they are given. If a long username is glued in front of the password, the password can be pushed out of that window and any password works.

**Does it apply to Stackday?** No. There are no passwords and no password hashing. Sign-in is a wallet signature. Names are also limited to 20 characters.

**Status today:** Not applicable.

**Check to do:** If passwords are ever added, use a maintained login service and do not build it by hand. Repeat check: search `web/` for `bcrypt` and `password`. Both should return nothing.

### 3. SAML bypass

**The attack:** SAML is a company single sign-on system. Flaws in how its signed messages are read let an attacker log in as someone else.

**Does it apply to Stackday?** No. There is no SAML.

**Status today:** Not applicable.

**Check to do:** Nothing. If company single sign-on is ever added, use a maintained provider.

### 4. nOAuth email spoof

**The attack:** With "Sign in with Microsoft" style logins, an attacker sets an email address they do not own on their own account. An app that matches users by email then hands over the victim's account.

**Does it apply to Stackday?** No. There is no OAuth login and we store no email addresses. The only identity is the wallet address, proven by a signature.

**Status today:** Not applicable.

**Check to do:** Keep the wallet address as the only identity. Never match accounts by email or by name.

### 5. GraphQL aliases

**The attack:** GraphQL lets one request ask the same question many times under different labels. Attackers use this to get around rate limits or to overload the server.

**Does it apply to Stackday?** Partly. We have no GraphQL server of our own. Supabase switches on a GraphQL endpoint by default (pg_graphql). We do not use it.

**Status today:** Covered. Every table has row level security on with no policies, so the public key gets nothing through that endpoint. This was tested: a public read returns nothing and a public write is refused. Our code never gives the browser a Supabase key. Note that Vercel's Supabase integration did create `NEXT_PUBLIC_SUPABASE_*` variables, but no code uses them.

**Check to do:** After every schema change, repeat the public read and public write test. Search `web/` for `NEXT_PUBLIC_SUPABASE`: it must return nothing. Optional: switch off the GraphQL extension in the Supabase dashboard, since we do not use it.

### 6. 2FA code replay

**The attack:** A one-time code that can be used twice is not one-time. An attacker who captures it uses it again.

**Does it apply to Stackday?** We have no 2FA. But the same idea applies to our sign-in signature. The signed text holds the wallet and a time. The server accepts it for 10 minutes. It has no single-use number (nonce) and no site address in it.

**Status today:** GAP. Two problems:

- A captured signature can be used again within 10 minutes.
- A phishing site can ask a user to sign the identical text and then use it on our API. The wallet popup would show nothing that ties the text to our site.

The damage is limited to the off-chain account: name, team list, attendance. It can never move funds. Also note that a session lasts 7 days and cannot be cancelled from the server. Signing out only clears the cookie in that browser.

**Check to do:** Fix: add the site domain, the chain id and a single-use server nonce to the signed text. This is the "Sign-In with Ethereum" pattern. The server must reject a nonce it has seen before and reject a domain that is not ours. Test after the fix: sign in, capture the request, send it again. The second try must fail.

### 7. ReDoS regex

**The attack:** A badly written text pattern can take minutes to check one crafted input. One request then freezes the server.

**Does it apply to Stackday?** Yes, we use patterns on user input.

**Status today:** Covered. There are only two: `^[a-z0-9_]{3,20}$` for names and `^0x[0-9a-fA-F]{40}$` for wallets. Both are fixed length with no nested repeats, so they cannot blow up. No pattern is ever built from user input.

**Check to do:** Search `web/app` and `web/lib` for `new RegExp`. It must return nothing. Any new pattern must be simple and must have a length limit.

### 8. JWT alg confusion

**The attack:** A JWT is a signed login token that names its own signing method. Sloppy servers let the attacker pick a weak method, or "none", and forge a token.

**Does it apply to Stackday?** No. We use no JWT library. Our session cookie is our own format: wallet, expiry time, and an HMAC-SHA256 signature. The method is fixed in code. The client cannot choose it.

**Status today:** Not applicable.

**Check to do:** Keep it that way. One thing to tidy: if `SESSION_SECRET` is not set, the code falls back to `SUPABASE_JWT_SECRET`. Set a separate random `SESSION_SECRET` in Vercel so the two are independent. Do it in the Vercel dashboard, never in chat.

### 9. Request smuggling

**The attack:** When a proxy and the server behind it disagree on where one request ends, an attacker hides a second request inside the first. It skips checks or lands on another user.

**Does it apply to Stackday?** Only at the hosting level. We run no proxy and no server of our own.

**Status today:** Covered by the hosting provider.

**Check to do:** Nothing in our code. Like item 1, this becomes our problem if the app is ever self-hosted.

### 10. Cache poisoning

**The attack:** An attacker gets a bad response stored in a shared cache. Every later visitor is served the bad copy.

**Does it apply to Stackday?** Yes. Vercel caches pages.

**Status today:** Covered. Every API answer is sent with `Cache-Control: no-store` (the `json` helper in `web/lib/server/backend.ts`), so answers that depend on who is signed in are never stored. No code builds a page or a link from request headers such as Host.

**Check to do:** Every new API route must answer through the `json` helper. Never read the Host or forwarded headers to build output. Keep Next.js up to date, since the framework has had cache bugs of its own.

### 11. Spoofed IP header

**The attack:** Apps that limit requests per IP address often read the address from a header such as X-Forwarded-For. The client can write anything in that header, so the limit is easy to dodge.

**Does it apply to Stackday?** Yes, in a worse form. No code reads any IP header, which sounds good, but it means there is no rate limiting on any route.

**Status today:** GAP. What a stranger can do today:

- Hammer the sign-in route. Each try makes our server call a blockchain node.
- Grab names in bulk. Each fresh wallet can take one name, and wallets are free to make.
- Fill the database with team rows. One employer can add any number.

**Check to do:** Fix: add rate limiting on all four API routes, strictest on sign-in and on choosing a name. Use Vercel's firewall rules or the client IP that Vercel itself provides. Never trust a header the client can set. Test after the fix: send 100 quick requests with a fake X-Forwarded-For header. They must still be blocked.

**Fixed in `gg/rate-limit`:** `web/proxy.ts` runs before every `/api` request and counts requests per visitor address and route group in fixed one-minute windows: sign-in 10, sign-in code 20, choosing a name 5, team changes 30, check-in 10, other writes 30, reads 120. Over the limit the answer is 429 with `Retry-After`. The address comes only from `x-real-ip`, which Vercel sets itself (its docs: it overwrites X-Forwarded-For "to prevent IP spoofing"); client-writable headers are ignored, and off Vercel every request shares one bucket. Counts live in the `rate_limits` table through the `rate_limit_hit` function (service role only), keyed by a keyed hash of the address, never the address itself. If the counter cannot be reached the request goes through and the error is logged. Tests: `web/lib/server/rate-limit.test.ts`, including 100 requests with a fake X-Forwarded-For, of which only 10 pass.

### 12. Views bypass RLS

**The attack:** Row level security (RLS) protects tables. A database view runs with its owner's rights by default, so a view over a protected table can leak every row.

**Does it apply to Stackday?** As a rule for the future. Today the schema has three tables and no views.

**Status today:** Covered. All three tables have RLS on with no policies. Only our server, using the service role key, can read or write.

**Check to do:** Any future view must be created with `security_invoker = true`. After every schema change, check in the Supabase dashboard that there are no views without it and that RLS is still on for every table.

### 13. Math.random tokens

**The attack:** `Math.random` is predictable. Secrets made with it, such as session tokens or reset links, can be guessed.

**Does it apply to Stackday?** Yes, we issue a session cookie.

**Status today:** Covered. There is no `Math.random` anywhere in `web/app`, `web/lib` or `web/components`. The cookie holds no random token at all. It is the wallet and expiry time, signed with HMAC-SHA256 using a server secret.

**Check to do:** Search those three folders for `Math.random`. It must return nothing. When the nonce from item 6 is added, create it with `crypto.randomBytes` or `crypto.randomUUID`.

### 14. Timing attack

**The attack:** If a server compares a secret one character at a time and stops at the first wrong one, the response time leaks how much was right. An attacker guesses the secret piece by piece.

**Does it apply to Stackday?** Yes, the server compares the cookie signature.

**Status today:** Covered. The comparison uses `timingSafeEqual` in `sessionWallet` in `web/lib/server/backend.ts`.

**Check to do:** Any new secret comparison must use `timingSafeEqual`, never `===`. Check this in review whenever the sign-in code changes.

### 15. Padding oracle

**The attack:** With some older encryption modes, different error messages for "bad padding" and "bad data" let an attacker decrypt a message without the key.

**Does it apply to Stackday?** No. Our code encrypts nothing. The cookie is signed, not encrypted, and holds nothing secret. HTTPS is handled by Vercel.

**Status today:** Not applicable.

**Check to do:** Nothing. If we ever need to encrypt data ourselves, use a modern authenticated mode (AES-GCM) from the standard library.

### 16. Prototype pollution

**The attack:** In JavaScript, merging attacker-made JSON deep into an object can change the behaviour of every object in the app, for example through a key named `__proto__`.

**Does it apply to Stackday?** Yes, the routes accept JSON.

**Status today:** Covered. No route merges request data into an object. Each route picks out named fields one by one (`address`, `username`, `wallet`, `name`, `role`, `salary`) and checks each. There is no lodash-style deep merge of user input.

**Check to do:** Keep that pattern. Never spread or deep-merge a request body into another object. Keep dependencies updated (see the dependency audit below).

### 17. Template injection

**The attack:** If user text is dropped into a page template or into code and then run, the attacker's text runs as code.

**Does it apply to Stackday?** Yes, the app shows names and roles typed by users.

**Status today:** Covered. React escapes all text. There is no `dangerouslySetInnerHTML`, no `eval`, no `new Function` and no server-side template engine. Database queries use the Supabase client with values passed separately, not SQL built from text.

**Check to do:** Search `web/` (not `node_modules`) for `dangerouslySetInnerHTML`, `eval(` and `new Function`. All must return nothing. Never build SQL by joining strings.

### 18. XXE file read

**The attack:** XML files can point to other files. A careless XML reader will fetch them, including secret files on the server.

**Does it apply to Stackday?** No. We parse no XML anywhere. There are no file uploads.

**Status today:** Not applicable.

**Check to do:** Nothing. If uploads or imports are added, accept JSON or CSV only.

### 19. WebSocket hijack

**The attack:** A WebSocket is a long-lived connection. If the server does not check which site opened it, another site can open one using the visitor's cookie.

**Does it apply to Stackday?** No. We have no WebSocket server. The wallet libraries may open outgoing connections to their own services, but those do not carry our cookie.

**Status today:** Not applicable.

**Check to do:** Nothing. If live updates are ever added, check the Origin header and the session on every connection.

### 20. Unicode lookalike names

**The attack:** Two names that look the same but use different characters get treated as one account. This is how Spotify accounts were once taken over.

**Does it apply to Stackday?** Yes, we have unique names.

**Status today:** Covered. Names must match `^[a-z0-9_]{3,20}$`: plain lowercase letters, digits and underscore only. This is enforced in the API and again by a check in the database. No accented or lookalike characters can get in. Team member names are free text, but they are private to each employer and are never used to look anyone up.

**Check to do:** A planned feature (not built) adds free-text business names and lets businesses find people by a unique ID or name. Rule for that feature: identity and lookups must use the ASCII-only unique ID or the wallet address. A display name must always be shown next to the ID. Test now: try to save a name with a capital letter, an accent or a Cyrillic letter. Capital letters are lowered and the rest must be refused.

## Other checks that matter for Stackday

### Secrets

- `.env` and `web/.env.local` are git-ignored. Confirmed with `git check-ignore`.
- The Supabase service role key is only read on the server, in `web/lib/server/backend.ts`. It is never sent to the browser.
- Never paste a key, private key or seed phrase in chat. Set secrets in the Vercel dashboard.
- Check to do: before each push, run `git status` and make sure no `.env` file is listed.

### Cross-site request forgery

Another site tries to make a signed-in visitor's browser send a request to us.

- The cookie is `HttpOnly` and `SameSite=Lax`, and `Secure` in production.
- Every change needs POST or DELETE. Reads never change anything.
- GAP (small): the server does not check the Origin header. Fix: refuse POST and DELETE requests whose Origin is not our own site.

### Authorisation

- Every route takes the wallet from the signed cookie, never from the request body. A user can only change their own name, their own team list and their own check-in.
- An employer only reads their own team list.
- The name lookup (`GET /api/profile`) is public on purpose. It returns only a wallet and its chosen name, for up to 100 wallets per request.
- GAP (small, found during this review): an employer can add any wallet to their team list without that person agreeing. The attendance route then shows the employer that wallet's check-in days. Only dates leak, nothing else. Fix: only show attendance for a team member who has accepted, or who has actually been paid by that employer on-chain.

### Input size limits

- Team member name and role are cut to 80 characters in the API and limited again in the database.
- Salary must be between 0 and 1 billion. Attendance history is limited to 60 days. Name lookup is limited to 100 wallets.
- There is no limit on how many team members one employer can add. Rate limiting (item 11) covers this.
- Request body size is limited only by Vercel's own cap. That is acceptable for now.

### Security headers

GAP. `web/next.config.ts` sets no security headers. There is no Content-Security-Policy and no `frame-ancestors` or X-Frame-Options. For a wallet app this matters: another site could show Stackday inside an invisible frame and trick a user into clicking (clickjacking). Fix: add a `headers()` block with at least `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff` and a `Referrer-Policy`. Check afterwards with the browser's network tab or securityheaders.com.

### Dependency audit

GAP. Running `npm audit --omit=dev` in `web/` reports 27 known issues (10 moderate, 17 high) in packages such as ws, zod, uuid and decode-uri-component. They come in through the wallet libraries. They have not been reviewed one by one. Fix: review each, update what can be updated, and write down why any remaining one does not affect us. Repeat before each release:

```powershell
cd web; npm audit --omit=dev
```

### Smart contracts

The contracts are reviewed in the "Security review" section of `README.md`. It is not repeated here. To be clear: there has been NO independent audit of the contracts or of the web app. Do not use Stackday with real money.

### The testnet demo wallet owns the mocks

On Base Sepolia the mock tokens, mock prices and mock swap have an owner, on purpose, so the demo can be driven. That owner is the test-only demo wallet. Whoever holds its key can change mock prices and mint mock tokens. This is fine for a testnet demo and is labelled as mocked. It must never be carried over to mainnet, where the real adapters have no such owner. The key lives only in `.env`.

## Fix list, in order

1. Sign-in message: add site domain, chain id and a single-use server nonce. **NOT DONE**
2. Rate limiting on all API routes, using the hosting provider's trusted client IP. **NOT DONE**
3. Security headers in `web/next.config.ts` (frame-ancestors, Content-Security-Policy, nosniff). **NOT DONE**
4. Dependency audit: review and update the 27 reported issues. **NOT DONE**
5. Origin check on POST and DELETE requests. **NOT DONE**
6. Attendance: do not show an employer the check-ins of a wallet that has not accepted being on their team. **DONE** in the account flow pull request: team members start as "invited" and only accepted members' check-ins are visible.
