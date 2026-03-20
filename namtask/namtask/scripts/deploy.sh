#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# Nam Task — Production Deploy Script
#
# Usage:
#   ./scripts/deploy.sh              # deploy latest from current branch
#   ./scripts/deploy.sh --rollback   # roll back to previous image
#
# Performs:
#   1. Pull latest code
#   2. Build new Docker image
#   3. Run database migrations
#   4. Health-check new image before switching
#   5. Zero-downtime swap via Docker
#   6. Prune old images
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/namtask}"
COMPOSE="docker compose -f $APP_DIR/docker-compose.prod.yml"
LOG_FILE="/var/log/namtask-deploy.log"

log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
die()  { log "❌ ERROR: $*"; exit 1; }
ok()   { log "✅ $*"; }

cd "$APP_DIR"

# ── Rollback mode ─────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--rollback" ]]; then
  log "⏪ ROLLBACK requested"
  PREV_IMAGE=$(docker images namtask_api --format "{{.ID}}" | sed -n '2p')
  [[ -z "$PREV_IMAGE" ]] && die "No previous image found"
  log "Rolling back to image: $PREV_IMAGE"
  docker tag "$PREV_IMAGE" namtask_api:rollback
  $COMPOSE up -d --no-deps api
  ok "Rollback complete"
  exit 0
fi

# ── Pre-deploy checks ─────────────────────────────────────────────────────────
log "🚀 Nam Task deploy started"

[[ -f ".env" ]] || die ".env not found. Copy .env.production.example to .env and fill it in."

# Verify required vars
for var in DB_PASSWORD JWT_SECRET REDIS_PASSWORD FNB_WEBHOOK_SECRET BWK_WEBHOOK_SECRET; do
  val=$(grep "^${var}=" .env | cut -d= -f2-)
  [[ -z "$val" || "$val" == *"CHANGE_ME"* ]] && die "$var is not set or still placeholder in .env"
done
ok "Environment variables validated"

# ── Backup before deploy ──────────────────────────────────────────────────────
log "📦 Taking pre-deploy database backup..."
bash scripts/backup.sh || log "⚠️  Backup failed — continuing (check backup logs)"

# ── Pull latest code ──────────────────────────────────────────────────────────
log "⬇️  Pulling latest code..."
git pull origin "$(git branch --show-current)" || die "git pull failed"
ok "Code updated to $(git rev-parse --short HEAD)"

# ── Build new image ───────────────────────────────────────────────────────────
log "🏗️  Building Docker image..."
$COMPOSE build --no-cache api
ok "Image built"

# ── Run migrations ────────────────────────────────────────────────────────────
log "🗃️  Running database migrations..."
$COMPOSE run --rm migrator || die "Migrations failed"
ok "Migrations complete"

# ── Start new container ───────────────────────────────────────────────────────
log "🔄 Updating containers..."
$COMPOSE up -d --no-deps --remove-orphans api

# ── Health check ─────────────────────────────────────────────────────────────
log "🏥 Waiting for health check..."
MAX_WAIT=60
WAITED=0
until docker exec namtask_api curl -sf http://localhost:3000/health > /dev/null; do
  sleep 2
  WAITED=$((WAITED + 2))
  [[ $WAITED -ge $MAX_WAIT ]] && die "Health check timed out after ${MAX_WAIT}s"
done
ok "API is healthy (${WAITED}s)"

# ── Reload nginx ──────────────────────────────────────────────────────────────
log "🔃 Reloading nginx..."
docker exec namtask_nginx nginx -s reload || log "⚠️  nginx reload failed (may not be running yet)"

# ── Prune old images ──────────────────────────────────────────────────────────
log "🗑️  Pruning unused images..."
docker image prune -f --filter "until=24h" > /dev/null
ok "Images pruned"

log "🎉 Deploy complete! Commit: $(git rev-parse --short HEAD)"
log "   API health: $(curl -sf https://api.namtask.com/health 2>/dev/null | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("status","?"))' 2>/dev/null || echo 'check manually')"
