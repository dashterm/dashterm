#!/usr/bin/env bash
# DashTerm one-liner installer (native path — no Docker required).
#
# Usage:
#   curl -fsSL https://website-mf.web.app/install.sh | bash
#
# What it does:
#   1. verifies macOS or Linux
#   2. verifies Node 20+ (installs via Homebrew / NodeSource if missing)
#   3. clones the repo to ~/.dashterm/src/
#      (override with DASHTERM_INSTALL_DIR=/path)
#   4. runs `npm install` — postinstall builds the server + CLI
#   5. puts `dashterm` on PATH (npm link, or ~/.local/bin fallback)
#   6. (optional) runs `dashterm onboard` only if you pass DASHTERM_EMAIL +
#      DASHTERM_PASSWORD; otherwise the gateway seeds a default admin
#      (admin@localhost / changeme, force-reset) on its first start.
#
# After install, run:
#   $ dashterm start
# to launch the gateway (foreground; Ctrl-C to stop), then open
# http://localhost:8765 and sign in. Or for autostart on login:
#   $ dashterm daemon install
# (or pass DASHTERM_INSTALL_DAEMON=1 to the curl one-liner above).
#
# Env knobs:
#   DASHTERM_INSTALL_DIR     where to clone (default: ~/.dashterm/src)
#   DASHTERM_REPO_URL        git url to clone from
#   DASHTERM_BRANCH          branch / tag / commit (default: main)
#   DASHTERM_EMAIL           create this admin instead of the seeded default
#   DASHTERM_PASSWORD        password for DASHTERM_EMAIL (set both together)
#   DASHTERM_INSTALL_DAEMON  1 → also install the autostart unit
#                             (launchd plist on macOS, systemd-user on Linux)

set -euo pipefail

# -- formatting -------------------------------------------------------------
if [ -t 1 ]; then
  CYAN=$'\033[36m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'
  BOLD=$'\033[1m'; GRAY=$'\033[90m'; RESET=$'\033[0m'
else
  CYAN=''; GREEN=''; YELLOW=''; RED=''; BOLD=''; GRAY=''; RESET=''
fi

say()  { printf '%s%s%s\n' "$CYAN" "${1-}" "$RESET" ; }
ok()   { printf '%s✓%s %s\n' "$GREEN" "$RESET" "${1-}" ; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "${1-}" >&2 ; }
err()  { printf '%s✗%s %s\n' "$RED" "$RESET" "${1-}" >&2 ; }
note() { printf '%s%s%s\n' "$GRAY" "${1-}" "$RESET" ; }

# -- failure trap -----------------------------------------------------------
on_error() {
  local exit_code=$?
  err "Install failed (exit $exit_code)."
  echo
  note "If this is reproducible, please file an issue with the full output."
  exit "$exit_code"
}
trap on_error ERR

REPO_URL="${DASHTERM_REPO_URL:-https://github.com/dashterm/dashterm.git}"
BRANCH="${DASHTERM_BRANCH:-main}"
INSTALL_DIR="${DASHTERM_INSTALL_DIR:-$HOME/.dashterm/src}"

say "${BOLD}DashTerm installer${RESET}"
echo

# -- 1. OS check ------------------------------------------------------------
os="$(uname -s)"
case "$os" in
  Darwin) ok "Detected macOS" ; PLATFORM=macos ;;
  Linux)  ok "Detected Linux" ; PLATFORM=linux ;;
  *)      err "Unsupported OS: $os. macOS and Linux only."
          err "Windows users: clone the repo manually and run \`npm install\` from the root."
          exit 1 ;;
esac

# -- 2. Node check + install if needed --------------------------------------
need_node_install=0
if ! command -v node >/dev/null 2>&1; then
  need_node_install=1
else
  node_major="$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))' 2>/dev/null || echo 0)"
  if [ "$node_major" -lt 20 ]; then
    warn "Node $(node -v) is too old — need 20 or later. Installing newer…"
    need_node_install=1
  fi
fi

if [ "$need_node_install" -eq 1 ]; then
  if [ "$PLATFORM" = "macos" ]; then
    if ! command -v brew >/dev/null 2>&1; then
      err "Homebrew not found. Install it first: https://brew.sh/"
      exit 1
    fi
    say "Installing Node 20 via Homebrew…"
    brew install node@20
    # node@20 is keg-only; expose it.
    BREW_PREFIX="$(brew --prefix)"
    export PATH="$BREW_PREFIX/opt/node@20/bin:$PATH"
  else
    say "Installing Node 20 via NodeSource…"
    if ! command -v curl >/dev/null 2>&1; then
      err "curl is required to bootstrap Node. Install it first (apt install curl)."
      exit 1
    fi
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
  ok "Node $(node -v) installed"
else
  ok "Node $(node -v)"
fi

# -- 3. clone -------------------------------------------------------------
if ! command -v git >/dev/null 2>&1; then
  err "git is not installed."
  if [ "$PLATFORM" = "macos" ]; then
    note "Install Xcode command line tools: \`xcode-select --install\`"
  else
    note "Install git: \`sudo apt-get install -y git\`"
  fi
  exit 1
fi

if [ -d "$INSTALL_DIR/.git" ]; then
  say "Updating existing checkout at $INSTALL_DIR…"
  git -C "$INSTALL_DIR" fetch --tags origin
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only
else
  say "Cloning $REPO_URL → $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi
ok "Repo at $INSTALL_DIR"

# -- 4. npm install (postinstall builds server + CLI) -----------------------
say "Installing npm deps + building server + CLI…"
cd "$INSTALL_DIR"
npm install --no-audit --no-fund
ok "Deps installed; server at packages/server/dist/, CLI at cli/dist/"

# -- 4b. build the web bundle the gateway will serve ------------------------
# EXPO_PUBLIC_GATEWAY_URL is intentionally empty so the bundle uses
# relative URLs — the gateway serves both the bundle and the API from the
# same origin, so '' + '/api/...' resolves correctly in any browser.
if [ "${DASHTERM_NO_WEB_BUILD:-}" = "1" ]; then
  warn "Skipping web bundle build (DASHTERM_NO_WEB_BUILD=1)."
  note "The gateway will start without a dashboard. Run \`npx expo export"
  note "  --platform web --output-dir web-dist\` from $INSTALL_DIR later."
else
  say "Building web bundle (a couple of minutes on first run)…"
  EXPO_PUBLIC_GATEWAY_URL= \
    npx expo export --platform web --output-dir web-dist
  ok "Web bundle at $INSTALL_DIR/web-dist/"
fi

# -- 5. put `dashterm` on PATH ---------------------------------------------
LINKED=0
if (cd "$INSTALL_DIR/cli" && npm link --silent >/dev/null 2>&1); then
  LINKED=1
  ok "dashterm linked globally (via npm link)"
else
  # Sudo-free fallback: drop a symlink in ~/.local/bin.
  mkdir -p "$HOME/.local/bin"
  ln -sf "$INSTALL_DIR/cli/dist/index.js" "$HOME/.local/bin/dashterm"
  ok "dashterm symlinked at ~/.local/bin/dashterm"
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) : ;;
    *) warn "~/.local/bin is not on your PATH — add this to your shell rc:"
       note "  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
  esac
fi

# Locate the `dashterm` binary for the rest of the script (npm link result
# may not be visible to this shell session yet).
DASHTERM_BIN=""
if command -v dashterm >/dev/null 2>&1; then
  DASHTERM_BIN="$(command -v dashterm)"
elif [ -x "$HOME/.local/bin/dashterm" ]; then
  DASHTERM_BIN="$HOME/.local/bin/dashterm"
else
  DASHTERM_BIN="$INSTALL_DIR/cli/dist/index.js"
fi

# -- 6. admin account -------------------------------------------------------
# The gateway seeds a default admin (admin@localhost / changeme, force-reset)
# on its first start, so onboarding is optional. We only run `dashterm
# onboard` when the operator supplied explicit credentials; the autostart
# unit can still be installed on its own.
if [ -n "${DASHTERM_EMAIL:-}" ] && [ -n "${DASHTERM_PASSWORD:-}" ]; then
  say "Creating admin ${DASHTERM_EMAIL}…"
  ONBOARD_ARGS=(onboard --email "$DASHTERM_EMAIL" --password "$DASHTERM_PASSWORD")
  if [ "${DASHTERM_INSTALL_DAEMON:-}" = "1" ]; then
    ONBOARD_ARGS+=(--install-daemon)
  fi
  "$DASHTERM_BIN" "${ONBOARD_ARGS[@]}"
elif [ "${DASHTERM_INSTALL_DAEMON:-}" = "1" ]; then
  say "Installing autostart unit…"
  "$DASHTERM_BIN" daemon install
fi

# -- 7. final summary ------------------------------------------------------
echo
ok "${BOLD}DashTerm installed.${RESET}"
echo
say "Repo:      $INSTALL_DIR"
say "Data dir:  ~/.dashterm/ (sqlite + jwt-secret)"
say "Gateway:   not yet running"
echo
note "Next step:"
note "  \$ dashterm start"
note ""
note "Then open http://localhost:8765 in a browser and sign in."
if [ -z "${DASHTERM_EMAIL:-}" ]; then
  note ""
  note "Default admin (seeded on first start): admin@localhost / changeme"
  warn "Rotate that password on first login, before exposing to a network."
fi
