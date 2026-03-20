#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# Nam Task — Database Backup Script
#
# Usage:
#   ./scripts/backup.sh              # manual backup
#   ./scripts/backup.sh restore FILE # restore from a backup
#
# Cron (daily 2am): 0 2 * * * /opt/namtask/scripts/backup.sh >> /var/log/namtask-backup.log 2>&1
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/opt/namtask/backups}"
CONTAINER="${DB_CONTAINER:-namtask_postgres}"
DB_NAME="${DB_NAME:-namtask}"
DB_USER="${DB_USER:-namtask_user}"
KEEP_DAYS="${KEEP_DAYS:-14}"          # days to retain local backups
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/namtask_${TIMESTAMP}.sql.gz"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# ── Restore mode ──────────────────────────────────────────────────────────────
if [[ "${1:-}" == "restore" ]]; then
  FILE="${2:?Usage: backup.sh restore <file.sql.gz>}"
  log "⚠️  RESTORE: $FILE → $DB_NAME"
  log "This will OVERWRITE the current database. Press Ctrl+C to abort (10s)..."
  sleep 10

  docker exec -i "$CONTAINER" \
    psql -U "$DB_USER" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" "$DB_NAME" 2>/dev/null || true

  gunzip -c "$FILE" | docker exec -i "$CONTAINER" \
    psql -U "$DB_USER" "$DB_NAME"

  log "✅ Restore complete"
  exit 0
fi

# ── Backup ────────────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
log "📦 Starting backup → $BACKUP_FILE"

docker exec "$CONTAINER" \
  pg_dump -U "$DB_USER" --no-owner --no-acl "$DB_NAME" \
  | gzip -9 > "$BACKUP_FILE"

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
log "✅ Backup complete: $BACKUP_FILE ($SIZE)"

# ── Prune old backups ─────────────────────────────────────────────────────────
DELETED=$(find "$BACKUP_DIR" -name "namtask_*.sql.gz" -mtime "+${KEEP_DAYS}" -print -delete | wc -l)
[[ $DELETED -gt 0 ]] && log "🗑️  Deleted $DELETED backup(s) older than ${KEEP_DAYS} days"

# ── Optional: upload to S3 ────────────────────────────────────────────────────
# Uncomment and set AWS_S3_BUCKET to enable off-site backup
# if [[ -n "${AWS_S3_BUCKET:-}" ]]; then
#   aws s3 cp "$BACKUP_FILE" "s3://${AWS_S3_BUCKET}/namtask-db/" --storage-class STANDARD_IA
#   log "☁️  Uploaded to s3://${AWS_S3_BUCKET}/namtask-db/"
# fi

log "Backup size on disk: $(du -sh "$BACKUP_DIR" | cut -f1)"
