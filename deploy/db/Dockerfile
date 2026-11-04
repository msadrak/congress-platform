# syntax=docker/dockerfile:1
# PostgreSQL with pgBackRest, for continuous WAL archiving and point-in-time recovery (BACKUP_WAL=on;
# deploy/staging/compose.wal.yaml). The same postgres:16-alpine the plain `db` service runs, so an existing data
# directory starts unchanged (same musl collation); only the pgBackRest binary is added. pgBackRest writes to the
# S3-compatible bucket itself and encrypts every file client-side (aes-256-cbc) before it leaves the server.
FROM postgres:18-alpine
# Build-time proxy (deploy/proxy/congress-proxy.sh deploy): the predefined proxy build arguments reach apk.
RUN apk add --no-cache pgbackrest \
 && pgbackrest version \
 && install -d -o postgres -g postgres -m 0750 /var/log/pgbackrest /var/spool/pgbackrest /tmp/pgbackrest
