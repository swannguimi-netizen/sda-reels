#!/usr/bin/env bash
# Applique les migrations sur une base vierge (bouchon Supabase) puis lance les tests RLS.
# Usage : PGHOST=/var/tmp PGPORT=54329 PGUSER=postgres ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=devis_test
psql -q -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/supabase_stub.sql
for f in migrations/*.sql; do
  echo "→ $f"
  psql -q -v ON_ERROR_STOP=1 -d $DB -f "$f"
done
echo "→ tests/rls_test.sql"
psql -qtA -v ON_ERROR_STOP=1 -d $DB -f tests/rls_test.sql 2>&1 | sed "s/^psql:[^ ]* NOTICE:  //" | grep -v "^$"; test ${PIPESTATUS[0]} -eq 0
echo "✔ Migrations et tests RLS OK"
