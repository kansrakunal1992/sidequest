#!/bin/sh
if ! pg_lsclusters | grep -q online; then rm -f /var/lib/postgresql/16/main/postmaster.pid; setsid pg_ctlcluster 16 main start >/dev/null 2>&1; sleep 3; fi
pg_lsclusters | grep -q online
