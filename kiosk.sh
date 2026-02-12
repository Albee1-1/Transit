#!/usr/bin/env bash
# Chromium kiosk launcher for Raspberry Pi.
# Copy to ~/.config/autostart/subway-kiosk.desktop  (see below)
# or call directly from your desktop session.

# Wait for the backend to be ready
sleep 5

# Disable screen blanking & power management
xset s off
xset -dpms
xset s noblank

# Hide the mouse cursor after 0.5 s of inactivity
unclutter -idle 0.5 &

# Launch Chromium in kiosk mode
chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-translate \
  --no-first-run \
  --start-fullscreen \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  http://localhost:3001
