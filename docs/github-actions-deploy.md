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
2. Uploads the current repository snapshot as a tar archive.
3. Extracts it into `DEPLOY_PATH`, preserving the server `.env`.
4. Runs `scripts/deploy-on-server.sh`.
5. Rebuilds and restarts Docker Compose services.

## GitHub Secrets

Add these in GitHub:

`Settings` → `Secrets and variables` → `Actions` → `New repository secret`

Required:

- `DEPLOY_HOST` - server IP or hostname
- `DEPLOY_USER` - SSH user, for example `deploy`
- `DEPLOY_PASSWORD` - SSH password for `DEPLOY_USER`

Alternative to password:

- `DEPLOY_SSH_KEY` - private SSH key allowed to connect to the server

If both `DEPLOY_SSH_KEY` and `DEPLOY_PASSWORD` are set, the workflow uses the SSH key.

Optional:

- `DEPLOY_PORT` - SSH port, default `22`
- `DEPLOY_PATH` - project path on the server, default `/opt/fan-raids`

## One-Time Server Setup

Install Docker and Docker Compose on the server.

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

The deploy script supports both Compose variants:

- `docker compose`
- `docker-compose`

If neither is installed, the deploy script tries to install Docker Compose v2 into the deploy user's `~/.docker/cli-plugins/docker-compose` using `curl` or `wget`.

Create a deploy user and allow it to run Docker:

```bash
sudo adduser deploy
sudo usermod -aG docker deploy
```

Create the app directory and give the deploy user write access:

```bash
sudo mkdir -p /opt/fan-raids
sudo chown deploy:deploy /opt/fan-raids
```

You do not need to clone the repository on the server. GitHub Actions uploads the current code snapshot on every deploy.

On the first successful deploy, if `/opt/fan-raids/.env` does not exist, the workflow creates it from `.env.example`. After that, edit it on the server:

```bash
nano /opt/fan-raids/.env
```

Future deploys preserve `/opt/fan-raids/.env`.

By default, only the Caddy container publishes host ports `80` and `443`. The web and backend containers stay internal on the Docker network. The backend is reached by the web nginx proxy through `/api`, `/uploads`, and `/ws`.

## HTTPS Setup

Wallet login requires HTTPS on production domains. Use a real domain, not a raw server IP.

1. Create a DNS A record that points your domain to the VPS IP.
2. Open HTTP and HTTPS ports on the server:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

3. Edit the server environment file:

```bash
nano /opt/fan-raids/.env
```

4. Set:

```env
APP_DOMAIN=fanraid.example.com
```

5. Push to `main` or run deploy again. Caddy will request and renew the certificate automatically.

Check HTTPS logs with:

```bash
cd /opt/fan-raids
docker compose logs -f caddy
```

Open the app as `https://fanraid.example.com`, not `http://SERVER_IP:5173`.

## Password Login

If your server uses password SSH login, add `DEPLOY_PASSWORD` as a GitHub Actions secret.

The workflow installs `sshpass` in the GitHub runner and deploys with that password.

## SSH Key For GitHub Actions

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
./scripts/deploy-on-server.sh
```
