# Nam Task — Cloud Deployment Guide
## Docker on a VPS (Ubuntu 22.04 LTS)

---

## Prerequisites

| Requirement | Minimum | Recommended |
|---|---|---|
| VPS RAM | 1 GB | 2 GB |
| CPU | 1 vCPU | 2 vCPU |
| Disk | 20 GB SSD | 40 GB SSD |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
| Domain | Required for SSL | — |

**Providers that work well:** DigitalOcean, Hetzner (cheapest), Vultr, Linode, AWS EC2.

---

## PHASE 1 — Server Setup (run once)

### 1.1 Connect to your server

```bash
ssh root@YOUR_SERVER_IP
```

### 1.2 Create a deploy user (never run apps as root)

```bash
adduser deploy
usermod -aG sudo deploy
usermod -aG docker deploy   # add after Docker is installed

# Copy your SSH key to the deploy user
mkdir -p /home/deploy/.ssh
cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

### 1.3 Harden SSH

```bash
# Edit SSH config
nano /etc/ssh/sshd_config
```

Change these lines:
```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
Port 22
```

```bash
systemctl restart sshd
# Test in a NEW terminal before closing current session!
ssh deploy@YOUR_SERVER_IP
```

### 1.4 Configure firewall (UFW)

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp      # SSH
ufw allow 80/tcp      # HTTP (nginx → certbot challenge)
ufw allow 443/tcp     # HTTPS (nginx)
# 3000, 5432, 6379 are NOT opened — they stay internal
ufw enable
ufw status
```

Expected output:
```
To          Action  From
--          ------  ----
22/tcp      ALLOW   Anywhere
80/tcp      ALLOW   Anywhere
443/tcp     ALLOW   Anywhere
```

### 1.5 Install Docker + Docker Compose

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Add deploy user to docker group
usermod -aG docker deploy

# Install Docker Compose plugin
apt-get install -y docker-compose-plugin

# Verify
docker --version          # Docker 25.x
docker compose version    # Docker Compose 2.x
```

### 1.6 Install utilities

```bash
apt-get update && apt-get install -y \
  git curl wget vim htop \
  fail2ban           `# blocks brute-force SSH` \
  unattended-upgrades `# auto security updates`

# Enable fail2ban
systemctl enable fail2ban
systemctl start fail2ban

# Enable auto security updates
dpkg-reconfigure -plow unattended-upgrades
```

---

## PHASE 2 — Application Setup

Switch to deploy user for all remaining steps:
```bash
su - deploy
```

### 2.1 Clone the repository

```bash
mkdir -p /opt/namtask
cd /opt/namtask
git clone https://github.com/YOUR_ORG/namtask.git .
```

### 2.2 Create the production .env file

```bash
cp .env.production.example .env
nano .env
```

Generate all secrets:
```bash
# Run this to generate each secret — copy the output into .env
echo "DB_PASSWORD=$(openssl rand -hex 32)"
echo "REDIS_PASSWORD=$(openssl rand -hex 32)"
echo "JWT_SECRET=$(openssl rand -hex 64)"
echo "SMS_WEBHOOK_SECRET=$(openssl rand -hex 32)"
echo "FNB_WEBHOOK_SECRET=$(openssl rand -hex 32)"
echo "BWK_WEBHOOK_SECRET=$(openssl rand -hex 32)"
```

Set your domain in .env:
```bash
API_BASE_URL=https://api.yourdomain.com
APP_BASE_URL=https://app.yourdomain.com
ALLOWED_ORIGINS=https://app.yourdomain.com
```

Restrict .env permissions:
```bash
chmod 600 .env
```

### 2.3 Update nginx domain

```bash
# Replace api.namtask.com with your actual domain
sed -i 's/api\.namtask\.com/api.yourdomain.com/g' nginx/namtask.conf
```

### 2.4 Create required directories

```bash
mkdir -p backups logs uploads/{tasks,avatars,proofs}
chmod -R 755 uploads
```

### 2.5 Make scripts executable

```bash
chmod +x scripts/deploy.sh scripts/backup.sh
```

---

## PHASE 3 — SSL Certificate (Let's Encrypt)

**DNS must be pointing to your server before this step.**

Check: `dig +short api.yourdomain.com` should return your server IP.

### 3.1 Get certificate (HTTP challenge — before starting nginx)

```bash
# Start nginx in HTTP-only mode first (comment out HTTPS server block temporarily)
# OR use standalone mode:

docker run --rm -it \
  -v /opt/namtask/certbot_www:/var/www/certbot \
  -v /opt/namtask/certbot_certs:/etc/letsencrypt \
  -p 80:80 \
  certbot/certbot certonly \
  --standalone \
  --email your@email.com \
  --agree-tos \
  --no-eff-email \
  -d api.yourdomain.com

# Verify certificate was created
ls /opt/namtask/certbot_certs/live/api.yourdomain.com/
# Should show: cert.pem  chain.pem  fullchain.pem  privkey.pem
```

### 3.2 Schedule auto-renewal

```bash
crontab -e
```

Add this line:
```cron
# Renew SSL at 3am on the 1st and 15th of each month
0 3 1,15 * * docker exec namtask_certbot certbot renew --quiet && docker exec namtask_nginx nginx -s reload >> /var/log/namtask-certbot.log 2>&1
```

---

## PHASE 4 — First Deploy

### 4.1 Build and start all services

```bash
cd /opt/namtask

# Build the API image
docker compose -f docker-compose.prod.yml build api

# Start everything
docker compose -f docker-compose.prod.yml up -d

# Watch startup logs
docker compose -f docker-compose.prod.yml logs -f --tail=50
```

Expected sequence:
```
namtask_postgres   | database system is ready to accept connections
namtask_postgres   | CREATE EXTENSION
namtask_postgres   | CREATE TABLE
namtask_redis      | Ready to accept connections
namtask_migrator   | ✅ Migrations complete        ← exits with code 0
namtask_api        | ✅ PostgreSQL connected
namtask_api        | 🚀 Nam Task API running on port 3000
namtask_nginx      | nginx: [notice] start worker processes
```

### 4.2 Verify all containers are running

```bash
docker compose -f docker-compose.prod.yml ps
```

Expected:
```
NAME                STATUS          PORTS
namtask_postgres    running (healthy)
namtask_redis       running (healthy)
namtask_api         running (healthy)
namtask_nginx       running         0.0.0.0:80->80, 0.0.0.0:443->443
namtask_migrator    exited (0)      ← 0 = success
```

### 4.3 Check API health

```bash
curl https://api.yourdomain.com/health
```

Expected:
```json
{
  "status": "ok",
  "service": "namtask-api",
  "version": "1.0.0",
  "environment": "production",
  "timestamp": "2026-03-18T12:00:00.000Z"
}
```

### 4.4 Seed the database (first time only)

```bash
docker compose -f docker-compose.prod.yml exec api node scripts/seed.js
```

---

## PHASE 5 — Ongoing Operations

### 5.1 Deploy updates

```bash
cd /opt/namtask
bash scripts/deploy.sh
```

The deploy script:
1. Validates .env has no placeholder values
2. Takes a database backup
3. Pulls latest code
4. Builds new Docker image
5. Runs migrations
6. Swaps container (zero-downtime)
7. Health-checks the new container
8. Reloads nginx
9. Prunes old images

### 5.2 Roll back to previous version

```bash
bash scripts/deploy.sh --rollback
```

### 5.3 Manual database backup

```bash
bash scripts/backup.sh
# Backup saved to /opt/namtask/backups/
```

### 5.4 Restore a backup

```bash
bash scripts/backup.sh restore backups/namtask_20260318_020000.sql.gz
```

### 5.5 Set up automated daily backups

```bash
crontab -e
```

Add:
```cron
# Backup at 2am daily, keep 14 days
0 2 * * * cd /opt/namtask && bash scripts/backup.sh >> /var/log/namtask-backup.log 2>&1
```

### 5.6 View live logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# API only
docker compose -f docker-compose.prod.yml logs -f api

# Last 100 lines of nginx access log
docker exec namtask_nginx tail -100 /var/log/nginx/access.log

# Postgres slow queries
docker exec namtask_postgres tail -100 /var/log/postgresql/postgresql-*.log
```

### 5.7 Connect to the database directly

```bash
docker exec -it namtask_postgres \
  psql -U namtask_user -d namtask
```

Useful queries:
```sql
-- Check all tables
\dt

-- Active connections
SELECT count(*), state FROM pg_stat_activity GROUP BY state;

-- Wallet balances
SELECT u.name, w.balance, w.escrow_balance FROM wallets w JOIN users u ON u.id=w.user_id ORDER BY w.balance DESC;

-- Recent transactions
SELECT type, amount, created_at FROM transactions ORDER BY created_at DESC LIMIT 20;
```

### 5.8 Scale the API (multiple instances)

```bash
docker compose -f docker-compose.prod.yml up -d --scale api=3
```

> **Note:** Socket.io requires a Redis adapter for multi-instance. See `src/sockets/socketServer.js` — add `@socket.io/redis-adapter` when scaling beyond 1 instance.

---

## PHASE 6 — Monitoring

### 6.1 Simple uptime monitoring (free)

Sign up at **UptimeRobot** (free tier: 50 monitors, 5-min checks):
- Add HTTP(S) monitor: `https://api.yourdomain.com/health`
- Alert via email/Slack when down

### 6.2 Server resource monitoring

```bash
# Check memory/CPU right now
docker stats

# Disk usage
df -h
du -sh /opt/namtask/*
```

### 6.3 Set up log rotation on host

```bash
cat > /etc/logrotate.d/namtask << 'EOF'
/opt/namtask/logs/*.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
    copytruncate
}
EOF
```

---

## PHASE 7 — GitHub Actions Setup (automated CI/CD)

### 7.1 Add GitHub repository secrets

Go to: `Settings → Secrets and variables → Actions → New repository secret`

| Secret name | Value |
|---|---|
| `PROD_SERVER_HOST` | Your server IP |
| `PROD_SERVER_USER` | `deploy` |
| `PROD_SSH_KEY` | Contents of `~/.ssh/id_rsa` (private key) |

Generate an SSH key pair if needed:
```bash
ssh-keygen -t ed25519 -C "github-actions-namtask"
cat ~/.ssh/id_ed25519.pub >> /home/deploy/.ssh/authorized_keys
cat ~/.ssh/id_ed25519    # copy this as PROD_SSH_KEY secret
```

### 7.2 Workflow triggers

- **Push to `main`** → runs tests → builds image → deploys to production
- **Push to `staging`** → runs tests → builds image → deploys to staging
- **Pull request to `main`** → runs tests only (no deploy)

---

## Troubleshooting

### Container won't start

```bash
docker compose -f docker-compose.prod.yml logs api --tail=50
```

### Nginx 502 Bad Gateway

```bash
# Check API is running
docker compose -f docker-compose.prod.yml ps api
# Check API logs
docker compose -f docker-compose.prod.yml logs api
# Check nginx can reach API
docker exec namtask_nginx curl -s http://api:3000/health
```

### Database connection refused

```bash
# Check postgres is healthy
docker compose -f docker-compose.prod.yml ps postgres
# Check from API container
docker exec namtask_api node -e "
  require('dotenv').config();
  const {Pool}=require('pg');
  const p=new Pool({host:'postgres',database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD});
  p.query('SELECT 1').then(()=>console.log('✅ DB connected')).catch(e=>console.error('❌',e.message));
"
```

### SSL certificate not found

```bash
ls /opt/namtask/certbot_certs/live/api.yourdomain.com/
# If empty, re-run the certbot step in Phase 3
```

### Out of disk space

```bash
df -h
# Clean up Docker
docker system prune -f
docker volume prune -f    # WARNING: removes unused volumes
```

---

## Quick Reference

```bash
# Start all services
docker compose -f docker-compose.prod.yml up -d

# Stop all services
docker compose -f docker-compose.prod.yml down

# Restart API only
docker compose -f docker-compose.prod.yml restart api

# Deploy update
bash scripts/deploy.sh

# Rollback
bash scripts/deploy.sh --rollback

# Backup database
bash scripts/backup.sh

# View logs
docker compose -f docker-compose.prod.yml logs -f api

# Enter API container shell
docker exec -it namtask_api sh

# Enter Postgres shell
docker exec -it namtask_postgres psql -U namtask_user -d namtask

# Renew SSL manually
docker exec namtask_certbot certbot renew
docker exec namtask_nginx nginx -s reload

# Check resource usage
docker stats --no-stream
```
