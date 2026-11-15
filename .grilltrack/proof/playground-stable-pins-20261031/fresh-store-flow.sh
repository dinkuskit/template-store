#!/bin/bash
# Usage: fresh-store-flow.sh <base-url> <label>: a fresh visitor store through the pretend Connect for
# Payments and Ship, a practice label and the tour. Prints PASS/FAIL per step with the text it expects.
cd "$(dirname "$0")"
U="$1"; JAR="${TMPDIR:-/tmp}/flow-$2.jar"; rm -f "$JAR"; D="python3 -I drive.py $U $JAR"; fails=0
step() { local name="$1" expect="$2"; shift 2; local out; out="$("$@" 2>&1)"
  if grep -Fq -- "$expect" <<<"$out"; then echo "PASS | $name | \"$expect\""; else echo "FAIL | $name | \"$expect\""; echo "$out" | head -12; fails=$((fails+1)); fi; }
step "open the playground" "/playground" $D get /
step "open the shop" "200 $U/ " $D get /
$D init >/dev/null
P=r_3brsc2on3bu673rn; S=r_ehdlg5cxkb3ffqvr; T=dinkus-playground-tour
step "Payments page" "Connect', 'connect'" $D admin $P '{"type":"page_load","page":"/status"}'
step "Payments Connect" "Authorize Payments at DinkusKit" $D admin $P '{"type":"block_action","page":"/status","action_id":"connect"}'
step "Payments Continue" "Connected: Stripe test mode" $D admin $P '{"type":"block_action","page":"/status","action_id":"continue"}'
step "Payments reload" "Connected: Stripe test mode" $D admin $P '{"type":"page_load","page":"/status"}'
step "Ship page" "header: Shipments" $D admin $S '{"type":"page_load","page":"/shipping"}'
step "Ship Connect" "Approve at DinkusKit.com" $D admin $S '{"type":"block_action","page":"/shipping","action_id":"connect"}'
step "Ship Check" "#1004 (TEST)" $D admin $S '{"type":"block_action","page":"/shipping","action_id":"check"}'
step "Ship open paid order" "Make practice label" $D admin $S '{"type":"block_action","page":"/shipping","action_id":"open","value":"playground-sample-paid"}'
step "Ship practice label" "Practice label made." $D admin $S '{"type":"form_submit","page":"/shipping","action_id":"buy:1:playground-sample-paid","values":{"boxId":"small","weightOz":"28","service":"GA","kind":"practice"}}'
step "Tour card ticks Payments and Ship" "Connect Payments, Look at your shop, Ship an order" $D admin $T '{"type":"page_load","page":"widget:tour"}'
step "Tour page names Payment settings" "Open Payment settings" $D admin $T '{"type":"page_load","page":"/tour"}'
step "Tour page names Shipments" "Open Shipments" $D admin $T '{"type":"page_load","page":"/tour"}'
echo "fails=$fails"
