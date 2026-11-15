#!/usr/bin/env bash
# End to end check of the account database routes (sign-in, name, team, attendance).
# Uses two throwaway wallets created on the spot (never a real wallet) and removes
# everything it wrote afterwards.   Usage: bash scripts/test-account-api.sh [base-url]
set -uo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
BASE="${1:-http://localhost:3000}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1 (expected $3, got $2)"; fail=$((fail+1)); fi; }
field() { python -c "import json,sys;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1" 2>/dev/null; }

newwallet() { cast wallet new --json | python -c "import json,sys;d=json.load(sys.stdin)['data'][0];print(d['address'], d['private_key'])"; }
read -r A_ADDR A_KEY <<<"$(newwallet)"
read -r B_ADDR B_KEY <<<"$(newwallet)"
A_L=$(echo "$A_ADDR" | tr 'A-Z' 'a-z'); B_L=$(echo "$B_ADDR" | tr 'A-Z' 'a-z')
NAME="t_$(date +%s | tail -c 9)"

HOST="$(python -c "import sys,urllib.parse;print(urllib.parse.urlsplit(sys.argv[1]).netloc)" "$BASE")"
SIGNIN_TS="$(cd "$(dirname "$0")/.." && pwd)/lib/signin.ts"

nonce() { curl -s -X POST "$BASE/api/session/nonce" | field "d['nonce']"; }
# Builds the exact Sign-In with Ethereum text the site uses (lib/signin.ts). Args: address nonce [domain]
siwe() {
  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --input-type=module -e '
    import { pathToFileURL } from "node:url";
    const [file, address, nonce, domain] = process.argv.slice(1);
    const { buildSignInMessage } = await import(pathToFileURL(file).href);
    process.stdout.write(buildSignInMessage({ address, domain, uri: "http://" + domain, nonce, issuedAt: new Date() }));
  ' "$SIGNIN_TS" "$1" "$2" "${3:-$HOST}"
}
post_signin() { # message signature jar -> http code
  python -c "import json,sys;print(json.dumps({'message':sys.argv[1],'signature':sys.argv[2]}))" "$1" "$2" > "$TMP/body"
  curl -s -o "$TMP/out" -w '%{http_code}' -c "$3" -H 'content-type: application/json' --data-binary @"$TMP/body" "$BASE/api/session"
}
signin() { # addr key jar
  local msg sig
  msg=$(siwe "$1" "$(nonce)")
  sig=$(cast wallet sign --private-key "$2" "$msg")
  post_signin "$msg" "$sig" "$3"
}
req() { # jar method path [body]
  curl -s -o "$TMP/out" -w '%{http_code}' -b "$1" -X "$2" -H 'content-type: application/json' ${4:+-d "$4"} "$BASE$3"
}

check "database is connected" "$(curl -s "$BASE/api/session" | field "d['configured']")" "True"
check "no session before sign-in" "$(req /dev/null GET /api/employees)" "401"

# a signature from the wrong wallet is rejected
msg=$(siwe "$A_ADDR" "$(nonce)")
check "someone else's signature is rejected" "$(post_signin "$msg" "$(cast wallet sign --private-key "$B_KEY" "$msg")" /dev/null)" "401"

# a message made for another site is rejected
msg=$(siwe "$A_ADDR" "$(nonce)" "stackday-phish.example")
check "message for another site is rejected" "$(post_signin "$msg" "$(cast wallet sign --private-key "$A_KEY" "$msg")" /dev/null)" "401"

# replay: the same signed request only works once
msg=$(siwe "$A_ADDR" "$(nonce)")
sig=$(cast wallet sign --private-key "$A_KEY" "$msg")
check "first use of a signed request works" "$(post_signin "$msg" "$sig" /dev/null)" "200"
check "replaying the same signed request is rejected" "$(post_signin "$msg" "$sig" /dev/null)" "400"

check "employer signs in" "$(signin "$A_ADDR" "$A_KEY" "$TMP/a")" "200"
check "employee signs in" "$(signin "$B_ADDR" "$B_KEY" "$TMP/b")" "200"
check "session remembers the wallet" "$(curl -s -b "$TMP/a" "$BASE/api/session" | field "d['address']")" "$A_L"

# a tampered cookie is rejected
sed "s/$A_L/$B_L/" "$TMP/a" > "$TMP/forged"
check "forged cookie is rejected" "$(req "$TMP/forged" GET /api/employees)" "401"

# names
check "pick a name" "$(req "$TMP/a" POST /api/profile "{\"username\":\"$NAME\"}")" "200"
check "name is public" "$(curl -s "$BASE/api/profile?wallets=$A_ADDR" | field "d['profiles'].get('$A_L')")" "$NAME"
check "name must be unique" "$(req "$TMP/b" POST /api/profile "{\"username\":\"$NAME\"}")" "409"
check "bad name refused" "$(req "$TMP/b" POST /api/profile '{"username":"No Spaces!"}')" "400"

# team
check "add team member" "$(req "$TMP/a" POST /api/employees "{\"wallet\":\"$B_ADDR\",\"name\":\"Test Person\",\"role\":\"Tester\",\"salary\":\"12.5\"}")" "200"
check "bad wallet refused" "$(req "$TMP/a" POST /api/employees '{"wallet":"0x123","name":"X","salary":"1"}')" "400"
req "$TMP/a" GET /api/employees >/dev/null
check "employer sees their team" "$(field "len(d['employees'])" < "$TMP/out")" "1"
check "salary is stored" "$(field "float(d['employees'][0]['salary_usdc'])" < "$TMP/out")" "12.5"
req "$TMP/b" GET /api/employees >/dev/null
check "another wallet sees none of it" "$(field "len(d['employees'])" < "$TMP/out")" "0"

# attendance
check "employee checks in" "$(req "$TMP/b" POST /api/attendance)" "200"
check "second check-in same day is harmless" "$(req "$TMP/b" POST /api/attendance)" "200"
req "$TMP/b" GET "/api/attendance?days=14" >/dev/null
check "employee sees one check-in" "$(field "len(d['mine'])" < "$TMP/out")" "1"
req "$TMP/a" GET "/api/attendance?days=14" >/dev/null
check "employer sees the team member's check-in" "$(field "len(d['team'].get('$B_L', []))" < "$TMP/out")" "1"

# clean up the test rows
check "remove team member" "$(req "$TMP/a" DELETE "/api/employees?wallet=$B_ADDR")" "200"
echo "TEST_WALLETS $A_L $B_L"
echo "$pass passed, $fail failed"
[ "$fail" = "0" ]
