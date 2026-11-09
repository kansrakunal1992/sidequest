#!/bin/sh
cd "$(dirname "$0")/../.."
scripts/sandbox/rebuild-db.sh >/dev/null 2>&1 || { scripts/sandbox/rebuild-db.sh; exit 1; }
runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -d sq ${1:+-o /dev/null} -f supabase/tests/rls_smoke.sql 2>&1 | head -${2:-8}
