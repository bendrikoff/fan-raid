# GitHub Actions Deployment

This project uses `.github/workflows/ci-cd.yml`.

## What The Pipeline Does

On pull requests and pushes:

1. Installs pnpm dependencies.
2. Runs TypeScript checks.
3. Runs backend tests.
4. Builds all packages.
5. Builds Docker images with `docker compose build`.

On push to `main` or `master`:

1. Connects to the server over SSH.
2. Updates the repo in `DEPLOY_PATH`.
3. Runs `scripts/deploy-on-server.sh`.
4. Rebuilds and restarts Docker Compose services.

## GitHub Secrets

Add these in GitHub:

`Settings` → `Secrets and variables` → `Actions` → `New repository secret`

Required:

- `DEPLOY_HOST` - server IP or hostname
- `DEPLOY_USER` - SSH user, for example `deploy`
- `DEPLOY_SSH_KEY` - private SSH key allowed to connect to the server

Optional:

- `DEPLOY_PORT` - SSH port, default `22`
- `DEPLOY_PATH` - project path on the server, default `/opt/fan-raids`

## One-Time Server Setup

Install Docker, Docker Compose plugin, and Git on the server.

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Create a deploy user and allow it to run Docker:

```bash
sudo adduser deploy
sudo usermod -aG docker deploy
```

Log in as `deploy`, clone the repo once, and create the production `.env`:

```bash
sudo mkdir -p /opt/fan-raids
sudo chown deploy:deploy /opt/fan-raids
git clone git@github.com:YOUR_ORG/YOUR_REPO.git /opt/fan-raids
cd /opt/fan-raids
cp .env.example .env
nano .env
docker compose up -d --build
```

If the repository is private, add an SSH deploy key for the server in GitHub:

`Settings` → `Deploy keys` → `Add deploy key`

## SSH Key For GitHub Actions

Generate a separate key on your local machine:

```bash
ssh-keygen -t ed25519 -C "fan-raids-github-actions" -f fan-raids-actions
```

Put `fan-raids-actions.pub` into the server user's `~/.ssh/authorized_keys`.

Put the private key `fan-raids-actions` into GitHub secret `DEPLOY_SSH_KEY`.

## Deploy

Push to `main` or `master`.

GitHub Actions will run CI first. If CI passes, it deploys to the server automatically.

Manual server command if needed:

```bash
cd /opt/fan-raids
git pull
./scripts/deploy-on-server.sh
```
