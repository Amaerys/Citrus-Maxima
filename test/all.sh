#!/bin/bash
# Runs every test; exits non-zero if any fails. Deploy only when this passes.
cd "$(dirname "$0")/.."; fail=0
for t in social board chores nurses media fuzz parse.test labor career plans extras daily changes social-ui people-ui labor-ui career-ui plans-ui extras-ui daily-ui changes-ui cockpit-ui sweep mind beta drive walk; do
  out=$(timeout 600 node test/$t.mjs 2>&1); code=$?
  if [ $code -ne 0 ] || echo "$out" | grep -q "✗\|FAILED"; then echo "✗ $t"; echo "$out" | grep -E "✗|FAILED|Error" | head -5; fail=1; else echo "✓ $t"; fi
done
exit $fail
