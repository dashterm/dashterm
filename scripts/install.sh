#!/usr/bin/env bash
# DashTerm one-liner installer (native path — no Docker required).
#
# Usage:
#   curl -fsSL https://dashterm.ai/install.sh | bash
#
# What it does:
#   1. verifies macOS or Linux
#   2. verifies Node 20+ (installs via Homebrew on macOS; the distro package
#      or NodeSource on Linux — works as root or via sudo)
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

# -- privilege + package-manager helpers ------------------------------------
NODE_MIN_MAJOR=20

is_root() { [ "$(id -u)" -eq 0 ]; }

# Run a command as root: directly if we already are, else via sudo. A leading
# -E (sudo's preserve-env flag) is dropped when we're already root — env is
# already ours. Fails clearly when we're neither root nor able to sudo.
as_root() {
  if is_root; then
    [ "${1:-}" = "-E" ] && shift
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    err "Need root to install system packages, but you're not root and sudo isn't installed."
    note "Re-run as root, or install sudo first."
    exit 1
  fi
}

# Resolve the system package manager into PKG_MGR (Linux only).
PKG_MGR=""
detect_pkg_mgr() {
  local m
  for m in apt-get dnf yum pacman apk; do
    if command -v "$m" >/dev/null 2>&1; then
      case "$m" in apt-get) PKG_MGR=apt ;; *) PKG_MGR="$m" ;; esac
      return 0
    fi
  done
  PKG_MGR=""
}

pkg_update() {
  case "$PKG_MGR" in
    apt)    as_root env DEBIAN_FRONTEND=noninteractive apt-get update -qq ;;
    pacman) as_root pacman -Sy --noconfirm ;;
    apk)    as_root apk update ;;
    *)      return 0 ;;  # dnf/yum refresh metadata on demand
  esac
}

pkg_install() {
  # --no-install-recommends / weak-deps-off: Debian's `npm` Recommends pulls in
  # ~500 extra packages (build tools, eslint/webpack, even X11/mesa) we don't
  # need — native deps ship prebuilt binaries. Keep the footprint minimal.
  case "$PKG_MGR" in
    apt)    as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@" ;;
    dnf)    as_root dnf install -y --setopt=install_weak_deps=False "$@" ;;
    yum)    as_root yum install -y "$@" ;;
    pacman) as_root pacman -S --needed --noconfirm "$@" ;;
    apk)    as_root apk add --no-cache "$@" ;;
    *)      return 1 ;;
  esac
}

# A C/C++ toolchain — only needed when a native dep has no prebuilt binary for
# this platform and must compile from source (e.g. musl/Alpine, exotic arches).
ensure_build_tools() {
  [ "$PLATFORM" = "linux" ] || return 0
  say "Installing build tools (native dep has no prebuilt binary here)…"
  case "$PKG_MGR" in
    apt)     pkg_install build-essential python3 ;;
    dnf|yum) pkg_install gcc gcc-c++ make python3 ;;
    pacman)  pkg_install base-devel python ;;
    apk)     pkg_install build-base python3 ;;
    *)       warn "Don't know how to install build tools for ${PKG_MGR}." ;;
  esac
}

# Run `npm install` (its postinstall builds the server + CLI). Native deps
# (better-sqlite3) normally fetch a prebuilt binary, so no compiler is needed;
# if none exists for this platform the build falls back to source, so on
# failure install a toolchain and retry once.
run_npm_install() {
  if npm install --no-audit --no-fund; then
    return 0
  fi
  warn "npm install failed — installing build tools and retrying once…"
  ensure_build_tools
  npm install --no-audit --no-fund
}

node_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))' 2>/dev/null || echo 0
}

# Ensure Node >= $NODE_MIN_MAJOR is on PATH. macOS: Homebrew. Linux: prefer the
# distro's own package (modern distros ship >=20), falling back to NodeSource
# only when the distro's Node is missing or too old.
ensure_node() {
  if [ "$(node_major)" -ge "$NODE_MIN_MAJOR" ]; then
    ok "Node $(node -v)"
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    warn "Node $(node -v) is too old — need ${NODE_MIN_MAJOR} or later. Installing a newer one…"
  fi

  if [ "$PLATFORM" = "macos" ]; then
    if ! command -v brew >/dev/null 2>&1; then
      err "Homebrew not found. Install it first: https://brew.sh/"
      exit 1
    fi
    say "Installing Node ${NODE_MIN_MAJOR} via Homebrew…"
    brew install "node@${NODE_MIN_MAJOR}"
    # node@N is keg-only; expose it for the rest of this script.
    export PATH="$(brew --prefix)/opt/node@${NODE_MIN_MAJOR}/bin:$PATH"
    ok "Node $(node -v) installed"
    return 0
  fi

  # Linux — distro package first.
  say "Installing Node via ${PKG_MGR} (distro package)…"
  pkg_update || true
  pkg_install nodejs npm || pkg_install nodejs || true

  if [ "$(node_major)" -ge "$NODE_MIN_MAJOR" ]; then
    ok "Node $(node -v) from ${PKG_MGR}"
  else
    local have; have="$(command -v node >/dev/null 2>&1 && node -v || echo none)"
    warn "Distro Node is ${have}; need ${NODE_MIN_MAJOR}+. Falling back to NodeSource…"
    command -v curl >/dev/null 2>&1 || pkg_install curl ca-certificates || true
    case "$PKG_MGR" in
      apt)
        curl -fsSL "https://deb.nodesource.com/setup_${NODE_MIN_MAJOR}.x" | as_root -E bash -
        # NodeSource's nodejs bundles npm and Replaces the distro packages.
        pkg_install nodejs ;;
      dnf|yum)
        curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MIN_MAJOR}.x" | as_root -E bash -
        pkg_install nodejs ;;
      *)
        err "Distro Node is ${have} (need ${NODE_MIN_MAJOR}+) and NodeSource doesn't cover ${PKG_MGR}."
        note "Install Node ${NODE_MIN_MAJOR}+ from https://nodejs.org and re-run."
        exit 1 ;;
    esac
    if [ "$(node_major)" -lt "$NODE_MIN_MAJOR" ]; then
      err "Node install failed — got $(command -v node >/dev/null 2>&1 && node -v || echo none)."
      exit 1
    fi
    ok "Node $(node -v) via NodeSource"
  fi

  # npm ships separately from nodejs on some distros — make sure it's here.
  command -v npm >/dev/null 2>&1 || pkg_install npm || true
  if ! command -v npm >/dev/null 2>&1; then
    err "npm is missing after installing Node. Install npm and re-run."
    exit 1
  fi
}

# Ensure git is available, auto-installing it across package managers.
ensure_git() {
  if command -v git >/dev/null 2>&1; then return 0; fi
  if [ "$PLATFORM" = "macos" ]; then
    err "git is not installed."
    note "Install the Xcode command line tools: \`xcode-select --install\`"
    exit 1
  fi
  say "Installing git via ${PKG_MGR}…"
  pkg_update || true
  pkg_install git || { err "Could not install git via ${PKG_MGR}."; exit 1; }
  ok "git installed"
}

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

# On Linux, resolve the system package manager up front — the Node and git
# bootstraps below both depend on it.
if [ "$PLATFORM" = "linux" ]; then
  detect_pkg_mgr
  if [ -z "$PKG_MGR" ]; then
    err "No supported package manager found (need one of: apt, dnf, yum, pacman, apk)."
    note "Install Node ${NODE_MIN_MAJOR}+ and git manually, then re-run."
    exit 1
  fi
  ok "Package manager: $PKG_MGR"
fi

# -- 2. Node check + install if needed --------------------------------------
ensure_node

# -- 3. clone -------------------------------------------------------------
ensure_git

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
run_npm_install
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
note "  \$ dashterm setup     # account + AI agents (Claude) + autostart, interactive"
note "  \$ dashterm start     # or just run the gateway in the foreground"
note ""
note "Then open http://localhost:8765 in a browser and sign in."
if [ -z "${DASHTERM_EMAIL:-}" ]; then
  note ""
  note "Default admin (seeded on first start): admin@localhost / changeme"
  warn "Rotate that password on first login, before exposing to a network."
fi
