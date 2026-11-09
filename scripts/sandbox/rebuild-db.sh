#!/bin/sh
D="$(cd "$(dirname "$0")/../../supabase" && pwd)"
"$(dirname "$0")/ensure-pg.sh" || exit 1
runuser -u postgres -- dropdb --if-exists sq >/dev/null 2>&1
runuser -u postgres -- createdb sq || exit 1
runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -d sq -f "$D/tests/local_stubs.sql" 2>&1 | grep -v "wal_level\|HINT"
for f in "$D"/migrations/*.sql; do out=$(runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -d sq -f "$f" 2>&1 | head -8); if [ -n "$out" ]; then echo "== $(basename "$f")"; echo "$out"; exit 1; fi; done
echo "ALL MIGRATIONS APPLIED"
