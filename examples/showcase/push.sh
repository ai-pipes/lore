#!/usr/bin/env bash
# Seeds the showcase stack with the Parcelly dataset: namespaces, v1 of all seven services,
# a v2 release of orders-service, billing-service and notifications-service (for diffs) and a feature-branch
# push of dispatch-service. Run from the repo root after `npm run build`:
#   examples/showcase/push.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . examples/showcase/.env; set +a
export LORE_URL=${LORE_URL:-http://localhost:4747} LORE_TOKEN=$LORE_API_KEY
lore() { node dist/cli.js "$@"; }
D=examples/showcase

for ns in "commerce:Commerce" "logistics:Logistics" "platform:Platform"; do
  lore namespace create "${ns%%:*}" --name "${ns#*:}" || true
done

push_v1() { # library namespace version
  lore push "$D/v1/$1" -l "$1" -v "$3" --namespace "$2" --no-enrich
}
push_v1 api-gateway           platform  9c41e07
push_v1 identity-service      platform  3b8d2f1
push_v1 notifications-service platform  e17a5c2
push_v1 orders-service        commerce  a1f3c9e
push_v1 billing-service       commerce  5d02b7a
push_v1 dispatch-service      logistics 0e6f4d9
push_v1 tracking-service      logistics b72c18f

# releases with changes, for the version diff
lore push "$D/v2/orders-service"  -l orders-service  -v 7d2e481 --branch main --no-enrich
lore push "$D/v2/billing-service" -l billing-service -v c4a90e3 --branch main --no-enrich
lore push "$D/v2/notifications-service" -l notifications-service -v 2b9f6d4 --branch main --no-enrich
# a feature branch, not promoted
lore push "$D/branch-batch-dispatch/dispatch-service" -l dispatch-service -v f8b3a61 \
  --branch feature/batch-dispatch --no-promote --no-enrich

lore namespace list
