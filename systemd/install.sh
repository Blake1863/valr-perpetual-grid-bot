#!/bin/bash
# Install systemd user service template

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_SYSTEMD_DIR="$HOME/.config/systemd/user"

# Create systemd user directory if it doesn't exist
mkdir -p "$USER_SYSTEMD_DIR"

# Copy service template
cp "$SCRIPT_DIR/valr-perpetual-grid-bot@.service" "$USER_SYSTEMD_DIR/"

# Reload systemd user daemon
systemctl --user daemon-reload

echo "Systemd service template installed to $USER_SYSTEMD_DIR/valr-perpetual-grid-bot@.service"
echo "Enable with: systemctl --user enable --now valr-perpetual-grid-bot@<config-name>.service"
echo "Where <config-name> matches configs/<config-name>.json (without .json extension)"
