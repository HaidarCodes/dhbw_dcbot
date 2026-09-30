#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

sudo -u dcbot git pull --ff-only
sudo -u dcbot npm ci --omit=dev
sudo -u dcbot npm run register
sudo systemctl restart dhbw-dcbot
sudo systemctl status dhbw-dcbot --no-pager
