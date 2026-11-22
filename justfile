set positional-arguments

# The toolchain (dotnet, node and electron) comes from the devenv shell. A recipe which needs it starts with
# this, naming itself: where the toolchain isn't already at hand, the recipe is run again inside that shell.
enter := 'enter() { if [[ -z "${OSU_SKIN_MIXER_IN_SHELL:-}" ]] && ! { command -v dotnet && command -v npm; } >/dev/null 2>&1; then export OSU_SKIN_MIXER_IN_SHELL=1; exec devenv shell -- just "$@"; fi; }; enter'

default:
    @just --list

# Serve the mixer at http://127.0.0.1:5727, to be opened in a browser
dev *args:
    #!/usr/bin/env bash
    set -euo pipefail
    {{ enter }} dev "$@"
    just _web

    # The server is given this build of the interface, rather than whichever one was last packed into it.
    export WEB_ROOT="$PWD/web/dist"

    exec dotnet run --project server -c Release --no-launch-profile -- --no-open "$@"

# Build and open the app itself, in its own window
app *args:
    #!/usr/bin/env bash
    set -euo pipefail
    {{ enter }} app "$@"
    just _web

    export WEB_ROOT="$PWD/web/dist"

    # The window starts the server itself, so it is told where this build of it is. The server is built to carry
    # its own .NET runtime, as it does when released: started by the window, it has no way to find the SDK's.
    runtime="$(dotnet --info | sed -n 's/^ *RID: *//p' | head -n 1)"
    dotnet publish server -c Release -r "$runtime" -o app/server-dev --nologo -v quiet
    export MIXER_SERVER="$PWD/app/server-dev/osu-skin-mixer-server"

    if [[ ! -d app/node_modules ]]; then
      (cd app && npm ci --no-fund --no-audit)
    fi

    # A system's own Electron is used where there is one, as on NixOS, where the one npm fetches can't run.
    if command -v electron >/dev/null 2>&1; then
      exec electron app "$@"
    fi

    cd app
    exec npx electron . "$@"

# Build the app for the system this is run on, into dist/
build:
    #!/usr/bin/env bash
    set -euo pipefail
    {{ enter }} build

    # Each system's build has to be made on that system: an AppImage on Linux, a portable .exe on Windows and a
    # .dmg on macOS. The release workflow does that for all three.
    #
    # On NixOS the result is the app as a folder with a launcher, run by the Electron from nixpkgs. It runs
    # there and nowhere else, which makes it good for trying a build out and nothing more.
    runtime="$(dotnet --info | sed -n 's/^ *RID: *//p' | head -n 1)"

    # The interface goes into the server, and the server goes alongside the window.
    (cd web && npm ci --no-fund --no-audit && npm run build)

    rm -rf app/server
    dotnet publish server -c Release -r "$runtime" -o app/server --nologo -v quiet

    cd app
    npm ci --no-fund --no-audit
    rm -rf out

    if [[ -n "${MIXER_ELECTRON_DIST:-}" ]]; then
      npx electron-builder --dir -c.electronDist="$MIXER_ELECTRON_DIST" -c.electronVersion="$MIXER_ELECTRON_VERSION"
    else
      npx electron-builder
    fi

    cd ..
    rm -rf "dist/$runtime"
    mkdir -p "dist/$runtime"

    if [[ -n "${MIXER_ELECTRON_DIST:-}" ]]; then
      # The folder a package would have been made from, and a launcher which starts it with the Electron from
      # nixpkgs. Electron as copied into the folder can't start by itself there.
      cp -r app/out/*-unpacked "dist/$runtime/app"

      cat > "dist/$runtime/osu-skin-mixer" <<LAUNCHER
    #!/usr/bin/env bash
    here="\$(dirname "\$(readlink -f "\$0")")"
    export MIXER_SERVER="\$here/app/resources/server/osu-skin-mixer-server"
    exec "$(command -v electron)" "\$here/app/resources/app.asar" "\$@"
    LAUNCHER
      chmod +x "dist/$runtime/osu-skin-mixer"
    else
      find app/out -maxdepth 1 -type f \( -name '*.AppImage' -o -name '*.exe' -o -name '*.dmg' \) -exec cp {} "dist/$runtime/" \;
    fi

    echo "built dist/$runtime"

# Run the interface's tests
test:
    #!/usr/bin/env bash
    set -euo pipefail
    {{ enter }} test
    just _web-deps
    cd web && npm test

# Type check the interface
check:
    #!/usr/bin/env bash
    set -euo pipefail
    {{ enter }} check
    just _web-deps
    cd web && npm run typecheck

# Enter the devenv shell
shell:
    devenv shell

# Update devenv inputs (nixpkgs, devenv module versions)
update:
    devenv update

# Garbage collect old devenv generations
gc:
    devenv gc

# Clean devenv cache (forces full rebuild on next shell)
clean:
    rm -rf .devenv devenv.lock

# What the interface depends on, fetched if it hasn't been.
[private]
_web-deps:
    #!/usr/bin/env bash
    set -euo pipefail

    if [[ ! -d web/node_modules ]]; then
      (cd web && npm ci --no-fund --no-audit)
    fi

# The interface, built if its build is older than its sources.
[private]
_web: _web-deps
    #!/usr/bin/env bash
    set -euo pipefail

    if [[ ! -f web/dist/index.html ]] || [[ -n "$(find web/src web/index.html web/package.json web/vite.config.ts -newer web/dist/index.html -print -quit)" ]]; then
      (cd web && npm run build)
    fi
