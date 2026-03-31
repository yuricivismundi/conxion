#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found in PATH. Install libpq client tools first."
  exit 1
fi

if [ "$#" -lt 1 ]; then
  echo "Usage: scripts/sql/run-remote-sql.sh <sql-file> [<sql-file> ...]"
  echo "Env:"
  echo "  SUPABASE_DB_URL (full postgres URL) OR"
  echo "  SUPABASE_DB_PASSWORD (+ linked supabase/.temp/pooler-url)"
  exit 1
fi

DB_URL="${SUPABASE_DB_URL:-}"

if [ -z "$DB_URL" ]; then
  POOLER_URL_FILE="supabase/.temp/pooler-url"
  if [ ! -f "$POOLER_URL_FILE" ]; then
    echo "Missing $POOLER_URL_FILE and SUPABASE_DB_URL is not set."
    exit 1
  fi
  if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
    echo "SUPABASE_DB_PASSWORD is required when SUPABASE_DB_URL is not set."
    echo "Example:"
    echo "  export SUPABASE_DB_PASSWORD='...'"
    exit 1
  fi

  BASE_URL="$(cat "$POOLER_URL_FILE")"
  USER_PART="$(printf '%s' "$BASE_URL" | sed -E 's#(postgresql://[^@]+)@.*#\1#')"
  HOST_PART="$(printf '%s' "$BASE_URL" | sed -E 's#postgresql://[^@]+@(.*)#\1#')"
  DB_URL="${USER_PART}:${SUPABASE_DB_PASSWORD}@${HOST_PART}"
fi

echo "Using remote database connection."

for sql_file in "$@"; do
  if [ ! -f "$sql_file" ]; then
    echo "SQL file not found: $sql_file"
    exit 1
  fi
  echo ""
  echo "Applying: $sql_file"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$sql_file"
done

echo ""
echo "Done."
