#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

scripts/sql/run-remote-sql.sh \
  scripts/sql/2026-03-17_references_unified_model.sql \
  scripts/sql/2026-03-17_references_examples_seed.sql
