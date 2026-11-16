#!/usr/bin/env bash
# End to end check of the account flow routes: unique IDs, account type, business profile,
# finding people, team invitations and attendance consent.
# Uses throwaway wallets created on the spot (never a real wallet). Prints the wallets at the
# end so the rows can be removed with scripts/cleanup-test-rows.mjs.
#   Usage: bash scripts/test-account-flow.sh [base-url]
set -uo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
BASE="${1:-http://localhost:3000}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1 (expected $3, got $2)"; fail=$((fail+1)); fi; }
field() { python -c "import json,sys;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1" 2>/dev/null; }
newwallet() { cast wallet new --json | python -c "import json,sys;d=json.load(sys.stdin)['data'][0];print(d['address'], d['private_key'])"; }
low() { echo "$1" | tr 'A-Z' 'a-z'; }

read -r A_ADDR A_KEY <<<"$(newwallet)"   # business owner
read -r B_ADDR B_KEY <<<"$(newwallet)"   # team member
read -r C_ADDR C_KEY <<<"$(newwallet)"   # stranger
A_L=$(low "$A_ADDR"); B_L=$(low "$B_ADDR"); C_L=$(low "$C_ADDR")
NAME="t_$(date +%s | tail -c 9)"

# Sign in with Sign-In with Ethereum: get a single-use nonce from the server, build the same
# message the site builds (web/lib/signin.ts), sign it with the throwaway key, post it.
HOST="${BASE#*://}"; HOST="${HOST%%/*}"
SIGNIN_TS="$(cd "$(dirname "$0")/.." && pwd)/lib/signin.ts"
nonce() { curl -s -X POST "$BASE/api/session/nonce" | field "d['nonce']"; }
siwe() { # address nonce
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --input-type=module -e '
    import { pathToFileURL } from "node:url";
    const [file, address, nonce, domain] = process.argv.slice(1);
    const { buildSignInMessage } = await import(pathToFileURL(file).href);
    process.stdout.write(buildSignInMessage({ address, domain, uri: "http://" + domain, nonce, issuedAt: new Date() }));
  ' "$SIGNIN_TS" "$1" "$2" "$HOST"
}
signin() { # addr key jar -> http code
  local msg sig
  msg=$(siwe "$1" "$(nonce)")
  sig=$(cast wallet sign --private-key "$2" "$msg")
  python -c "import json,sys;print(json.dumps({'message':sys.argv[1],'signature':sys.argv[2]}))" "$msg" "$sig" > "$TMP/body"
  curl -s -o "$TMP/out" -w '%{http_code}' -c "$3" -H 'content-type: application/json' --data-binary @"$TMP/body" "$BASE/api/session"
}
req() { # jar method path [body]
  curl -s -o "$TMP/out" -w '%{http_code}' -b "$1" -X "$2" -H 'content-type: application/json' ${4:+-d "$4"} "$BASE$3"
}
out() { field "$1" < "$TMP/out"; }

# ---- unique ID on first sign-in
check "owner signs in" "$(signin "$A_ADDR" "$A_KEY" "$TMP/a")" "200"
A_UID=$(out "d['uid']")
check "owner gets an ID in the SD-XXXXXXXX format" "$(python -c "import re,sys;print(bool(re.fullmatch(r'SD-[2-9A-Z]{8}', sys.argv[1])))" "$A_UID")" "True"
check "member signs in" "$(signin "$B_ADDR" "$B_KEY" "$TMP/b")" "200"
B_UID=$(out "d['uid']")
check "stranger signs in" "$(signin "$C_ADDR" "$C_KEY" "$TMP/c")" "200"
check "two wallets get different IDs" "$([ "$A_UID" != "$B_UID" ] && echo yes)" "yes"
signin "$A_ADDR" "$A_KEY" "$TMP/a2" >/dev/null
check "signing in again keeps the same ID" "$(out "d['uid']")" "$A_UID"

# ---- account type
req "$TMP/a" GET /api/me >/dev/null
check "new profile has no account type yet" "$(out "d['profile']['account_type']")" "None"
check "no session is refused" "$(req /dev/null GET /api/me)" "401"
check "bad account type refused" "$(req "$TMP/b" POST /api/me '{"accountType":"admin"}')" "400"
check "member chooses a business account" "$(req "$TMP/b" POST /api/me '{"accountType":"business"}')" "200"
check "stranger chooses an individual account" "$(req "$TMP/c" POST /api/me '{"accountType":"individual"}')" "200"
req "$TMP/c" GET /api/me >/dev/null
check "choice is saved" "$(out "d['profile']['account_type']")" "individual"

# ---- business profile
check "business name too short refused" "$(req "$TMP/a" POST /api/business '{"name":"x"}')" "400"
check "owner creates a business" "$(req "$TMP/a" POST /api/business '{"name":"  Northwind   Studio ","description":"Design shop"}')" "200"
req "$TMP/a" GET /api/me >/dev/null
check "business is on the owner's account, spaces tidied" "$(out "d['business']['name']")" "Northwind Studio"
check "creating a business sets the account type" "$(out "d['profile']['account_type']")" "business"
check "business name is public" "$(curl -s "$BASE/api/business?wallets=$A_ADDR" | field "d['businesses']['$A_L']['name']")" "Northwind Studio"

# ---- finding people
check "member picks a name" "$(req "$TMP/b" POST /api/profile "{\"username\":\"$NAME\"}")" "200"
check "search needs a session" "$(req /dev/null GET "/api/people?q=$B_UID")" "401"
req "$TMP/a" GET "/api/people?q=$B_UID" >/dev/null
check "find by full ID" "$(out "d['people'][0]['wallet']")" "$B_L"
req "$TMP/a" GET "/api/people?q=$(echo "$B_UID" | cut -c1-7 | tr 'A-Z' 'a-z')" >/dev/null
check "find by start of ID, any letter case" "$(out "any(p['wallet']=='$B_L' for p in d['people'])")" "True"
req "$TMP/a" GET "/api/people?q=$NAME" >/dev/null
check "find by name" "$(out "d['people'][0]['uid']")" "$B_UID"
req "$TMP/a" GET "/api/people?q=$B_ADDR" >/dev/null
check "find by wallet address" "$(out "d['people'][0]['uid']")" "$B_UID"
req "$TMP/a" GET "/api/people?q=$A_UID" >/dev/null
check "search never returns yourself" "$(out "len(d['people'])")" "0"
req "$TMP/a" GET "/api/people?q=%25%27%3B--" >/dev/null
check "odd characters are refused, not searched" "$(out "len(d['people'])")" "0"

# ---- invitation, consent and attendance
check "owner adds the member" "$(req "$TMP/a" POST /api/employees "{\"wallet\":\"$B_ADDR\",\"name\":\"Test Person\",\"role\":\"Tester\",\"salary\":\"10\"}")" "200"
req "$TMP/a" GET /api/employees >/dev/null
check "a new member starts as invited" "$(out "d['employees'][0]['status']")" "invited"
req "$TMP/b" GET /api/me >/dev/null
check "member sees the invitation with the business name" "$(out "d['memberships'][0]['businessName'] + '/' + d['memberships'][0]['status']")" "Northwind Studio/invited"
check "member checks in" "$(req "$TMP/b" POST /api/attendance)" "200"
req "$TMP/a" GET "/api/attendance?days=14" >/dev/null
check "owner CANNOT see check-ins before the member accepts" "$(out "len(d['team'].get('$B_L', []))")" "0"
check "a stranger cannot answer someone else's invitation" "$(req "$TMP/c" POST /api/memberships "{\"employer\":\"$A_ADDR\",\"action\":\"accept\"}")" "404"
check "member accepts" "$(req "$TMP/b" POST /api/memberships "{\"employer\":\"$A_ADDR\",\"action\":\"accept\"}")" "200"
req "$TMP/a" GET "/api/attendance?days=14" >/dev/null
check "owner sees check-ins after the member accepts" "$(out "len(d['team'].get('$B_L', []))")" "1"
check "editing the member keeps them accepted" "$(req "$TMP/a" POST /api/employees "{\"wallet\":\"$B_ADDR\",\"name\":\"Test Person\",\"role\":\"Lead\",\"salary\":\"12\"}")" "200"
req "$TMP/a" GET /api/employees >/dev/null
check "status survives an edit" "$(out "d['employees'][0]['status'] + '/' + d['employees'][0]['role']")" "accepted/Lead"
check "member leaves the team" "$(req "$TMP/b" POST /api/memberships "{\"employer\":\"$A_ADDR\",\"action\":\"decline\"}")" "200"
req "$TMP/a" GET /api/employees >/dev/null
check "owner's team no longer lists them" "$(out "len(d['employees'])")" "0"
check "answering again says the invitation is gone" "$(req "$TMP/b" POST /api/memberships "{\"employer\":\"$A_ADDR\",\"action\":\"accept\"}")" "404"
check "bad request refused" "$(req "$TMP/b" POST /api/memberships '{"employer":"0x1","action":"accept"}')" "400"

echo "TEST_WALLETS $A_L $B_L $C_L"
echo "$pass passed, $fail failed"
[ "$fail" = "0" ]
