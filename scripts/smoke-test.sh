#!/usr/bin/env bash
# Quick smoke-test for ConXion environments.
# Usage:
#   ./scripts/smoke-test.sh staging
#   ./scripts/smoke-test.sh production
#   ./scripts/smoke-test.sh both

set -u

ENV="${1:-both}"

run_tests() {
  local label="$1"
  local base="$2"
  local origin="$3"

  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "  $label  ($base)"
  echo "═══════════════════════════════════════════════════════"

  local pass=0
  local fail=0

  check() {
    local desc="$1"
    local got="$2"
    local want="$3"
    if [ "$got" = "$want" ]; then
      printf "  \033[32m✓\033[0m  %-45s  %s\n" "$desc" "$got"
      pass=$((pass+1))
    else
      printf "  \033[31m✗\033[0m  %-45s  got %s, want %s\n" "$desc" "$got" "$want"
      fail=$((fail+1))
    fi
  }

  # 1. Landing page reachable
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$base/" 2>/dev/null || echo "TIMEOUT")
  check "Landing page reachable" "$code" "200"

  # 2. Health endpoint reachable
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$base/api/health" 2>/dev/null || echo "TIMEOUT")
  # Accept 200 (healthy) or 503 (unhealthy but endpoint exists)
  if [ "$code" = "200" ] || [ "$code" = "503" ]; then
    printf "  \033[32m✓\033[0m  %-45s  %s\n" "Health endpoint responding" "$code"
    pass=$((pass+1))
  else
    printf "  \033[31m✗\033[0m  %-45s  got %s, want 200 or 503\n" "Health endpoint responding" "$code"
    fail=$((fail+1))
  fi

  # 3. Health status detail (check overall status, not nested check statuses)
  health_body=$(curl -s --max-time 10 "$base/api/health" 2>/dev/null || echo "")
  # Top-level status appears first in JSON: {"status":"...","timestamp":...}
  top_status=$(echo "$health_body" | sed -n 's/.*^{"status":"\([^"]*\)".*/\1/p; q')
  # Fallback: first occurrence of status field
  if [ -z "$top_status" ]; then
    top_status=$(echo "$health_body" | grep -oE '"status":"[^"]*"' | head -1 | sed 's/"status":"//; s/"$//')
  fi
  case "$top_status" in
    healthy)
      printf "  \033[32m✓\033[0m  %-45s  healthy\n" "Health status (overall)"
      pass=$((pass+1))
      ;;
    degraded)
      printf "  \033[33m⚠\033[0m  %-45s  degraded\n" "Health status (overall)"
      ;;
    unhealthy)
      # Check what's failing
      db_err=$(echo "$health_body" | grep -oE '"database":\{[^}]*\}' | head -1)
      printf "  \033[33m⚠\033[0m  %-45s  unhealthy\n" "Health status (overall)"
      if [ -n "$db_err" ]; then
        printf "      └─ DB check: %s\n" "$db_err"
      fi
      ;;
    *)
      printf "  \033[31m✗\033[0m  %-45s  unknown ('%s')\n" "Health status (overall)" "$top_status"
      fail=$((fail+1))
      ;;
  esac

  # 4. CORS - disallowed origin should be 403
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X POST \
    "$base/api/syncs/action" \
    -H "Origin: https://evil.example.com" \
    -H "Content-Type: application/json" 2>/dev/null || echo "TIMEOUT")
  check "CORS rejects disallowed origin (403)" "$code" "403"

  # 5. CORS - allowed origin preflight should be 204 (or 200)
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -X OPTIONS \
    "$base/api/syncs/action" \
    -H "Origin: $origin" 2>/dev/null || echo "TIMEOUT")
  if [ "$code" = "204" ] || [ "$code" = "200" ]; then
    printf "  \033[32m✓\033[0m  %-45s  %s\n" "CORS allows known origin (preflight)" "$code"
    pass=$((pass+1))
  else
    printf "  \033[31m✗\033[0m  %-45s  got %s, want 204 or 200\n" "CORS allows known origin (preflight)" "$code"
    fail=$((fail+1))
  fi

  # 6. Auth page reachable
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$base/auth" 2>/dev/null || echo "TIMEOUT")
  check "Auth page reachable" "$code" "200"

  # 7. Notifications page redirects unauthenticated (200 or 307)
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$base/notifications" 2>/dev/null || echo "TIMEOUT")
  if [ "$code" = "200" ] || [ "$code" = "307" ] || [ "$code" = "302" ]; then
    printf "  \033[32m✓\033[0m  %-45s  %s\n" "Notifications page accessible" "$code"
    pass=$((pass+1))
  else
    printf "  \033[31m✗\033[0m  %-45s  got %s\n" "Notifications page accessible" "$code"
    fail=$((fail+1))
  fi

  # 8. HTTPS enforced (HTTP should redirect or fail)
  http_url="${base/https:/http:}"
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 -L --max-redirs 0 "$http_url/" 2>/dev/null || echo "redirect")
  if [ "$code" != "200" ]; then
    printf "  \033[32m✓\033[0m  %-45s  HTTP not 200 (good)\n" "HTTP→HTTPS redirect/block"
    pass=$((pass+1))
  else
    printf "  \033[33m⚠\033[0m  %-45s  HTTP returned 200 (verify)\n" "HTTP→HTTPS redirect/block"
  fi

  # 9. Static assets served
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$base/branding/CONXION-2-favicon.png" 2>/dev/null || echo "TIMEOUT")
  check "Static branding asset served" "$code" "200"

  # 10. Latest build timestamp (compare X-Vercel-Id presence)
  vercel_id=$(curl -s -I --max-time 10 "$base/" 2>/dev/null | grep -i "x-vercel-id" | head -1 | tr -d '\r' | awk '{print $2}')
  if [ -n "$vercel_id" ]; then
    printf "  \033[32m✓\033[0m  %-45s  %s\n" "Vercel edge response" "${vercel_id:0:30}..."
    pass=$((pass+1))
  else
    printf "  \033[31m✗\033[0m  %-45s  no x-vercel-id header\n" "Vercel edge response"
    fail=$((fail+1))
  fi

  echo ""
  echo "  Result: $pass passed, $fail failed"
  return $fail
}

total_fail=0

case "$ENV" in
  staging)
    run_tests "STAGING" "https://staging.conxion.social" "https://staging.conxion.social"
    total_fail=$?
    ;;
  production|prod)
    run_tests "PRODUCTION" "https://conxion.social" "https://conxion.social"
    total_fail=$?
    ;;
  both)
    run_tests "STAGING" "https://staging.conxion.social" "https://staging.conxion.social"
    s_fail=$?
    run_tests "PRODUCTION" "https://conxion.social" "https://conxion.social"
    p_fail=$?
    total_fail=$((s_fail + p_fail))
    ;;
  *)
    echo "Usage: $0 {staging|production|both}"
    exit 2
    ;;
esac

echo ""
echo "═══════════════════════════════════════════════════════"
if [ "$total_fail" -eq 0 ]; then
  echo -e "  \033[32m✓ ALL CHECKS PASSED\033[0m"
else
  echo -e "  \033[31m✗ $total_fail check(s) failed\033[0m"
fi
echo "═══════════════════════════════════════════════════════"

exit $total_fail
