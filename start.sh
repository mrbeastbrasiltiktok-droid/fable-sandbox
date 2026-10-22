#!/usr/bin/env bash
# Build the three games into one static site and serve it in the foreground.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

PORT="${PORT:-${APP_PORT:-3000}}"
DIST="$PROJECT_DIR/dist"
WEB_DIR="${OPENCODE_WEB_DIR:-${RUNNER_TEMP:-/tmp}/omgithub-web}"

mkdir -p "$WEB_DIR"

run() {
  printf '\n==> %s\n' "$*"
  /usr/bin/time -p "$@"
}

app_hash() {
  local app="$1"
  (
    cd "$app"
    find index.html package.json package-lock.json vite.config.js src -type f -print0 \
      | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1
  )
}

install_app() {
  local app="$1"
  local hash stamp
  hash="$(cd "$app" && cat package.json package-lock.json | sha256sum | cut -d' ' -f1)"
  stamp="$WEB_DIR/deps-${app}.stamp"
  if [ ! -f "$app/node_modules/vite/bin/vite.js" ] || { [ -f "$stamp" ] && [ "$(cat "$stamp")" != "$hash" ]; }; then
    run npm --prefix "$app" ci --no-audit --no-fund
  fi
  printf '%s\n' "$hash" > "$stamp"
}

build_app() {
  local app="$1" base="$2"
  local hash stamp record
  hash="$(app_hash "$app")"
  stamp="$WEB_DIR/build-${app}.stamp"
  record="${hash}|${base}"
  if [ -f "$app/dist/index.html" ] && [ "$(cat "$stamp" 2>/dev/null || true)" = "$record" ]; then
    printf '\n==> %s build is up to date\n' "$app"
  else
    run npm --prefix "$app" run build -- --base="$base"
    printf '%s\n' "$record" > "$stamp"
  fi
}

install_app gta_fable5.1
install_app kart_fable5.1
install_app spiderman_fable5.1

build_app gta_fable5.1 /gta/
build_app kart_fable5.1 /kart/
build_app spiderman_fable5.1 /spider/

run rm -rf "$DIST"
run mkdir -p "$DIST/gta" "$DIST/kart" "$DIST/spider"
run cp -a "$PROJECT_DIR/gta_fable5.1/dist/." "$DIST/gta/"
run cp -a "$PROJECT_DIR/kart_fable5.1/dist/." "$DIST/kart/"
run cp -a "$PROJECT_DIR/spiderman_fable5.1/dist/." "$DIST/spider/"

/usr/bin/time -p tee "$DIST/index.html" >/dev/null <<'HTML'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#070913">
<title>Fable Sandbox — three procedural worlds</title>
<style>
  :root { color-scheme: dark; --bg:#070913; --ink:#f5f7ff; --muted:#9aa3c4; --acc:#ffd24a; --line:rgba(255,255,255,.12); }
  * { box-sizing: border-box; }
  html, body { min-height: 100%; }
  body {
    margin: 0; color: var(--ink);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background:
      radial-gradient(1100px 620px at 12% -12%, #263a8a 0, transparent 62%),
      radial-gradient(900px 680px at 98% 2%, #6b1a4d 0, transparent 58%),
      var(--bg);
    -webkit-font-smoothing: antialiased;
  }
  main {
    width: min(1180px, 100%); margin: 0 auto;
    padding: clamp(28px, 5vw, 64px) clamp(16px, 4vw, 32px) 40px;
    padding-top: calc(clamp(28px, 5vw, 64px) + env(safe-area-inset-top));
    padding-left: calc(clamp(16px, 4vw, 32px) + env(safe-area-inset-left));
    padding-right: calc(clamp(16px, 4vw, 32px) + env(safe-area-inset-right));
  }
  .eyebrow { margin: 0 0 14px; color: var(--acc); font-size: 12px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; }
  h1 { margin: 0; font-size: clamp(40px, 8vw, 82px); line-height: .95; letter-spacing: -2px; }
  h1 span { color: transparent; background: linear-gradient(100deg, #ffd24a, #ff6a9b 55%, #7ea2ff); -webkit-background-clip: text; background-clip: text; }
  .lede { max-width: 620px; margin: 18px 0 0; color: var(--muted); font-size: clamp(15px, 1.8vw, 18px); line-height: 1.6; }
  .games { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: clamp(14px, 2vw, 22px); margin-top: clamp(28px, 4vw, 46px); }
  .card {
    display: flex; flex-direction: column; overflow: hidden; text-decoration: none; color: inherit;
    background: linear-gradient(180deg, rgba(18,22,43,.92), rgba(10,13,27,.96));
    border: 1px solid var(--line); border-radius: 20px;
    box-shadow: 0 18px 50px rgba(0,0,0,.32);
    transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
  }
  .card:hover, .card:focus-visible { transform: translateY(-5px); border-color: rgba(255,255,255,.34); box-shadow: 0 26px 60px rgba(0,0,0,.45); outline: none; }
  .art { position: relative; height: clamp(120px, 15vw, 168px); overflow: hidden; }
  .art::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 40%, rgba(10,13,27,.88)); }
  .gta .art { background: linear-gradient(135deg, #ffb45c 0%, #d13d73 52%, #3a1a68 100%); }
  .gta .art::before { content:""; position:absolute; inset:auto 0 0; height:64%; opacity:.55; background: repeating-linear-gradient(90deg, rgba(8,10,22,.72) 0 12px, transparent 12px 26px), repeating-linear-gradient(0deg, rgba(8,10,22,.62) 0 10px, transparent 10px 24px); }
  .kart .art { background: linear-gradient(120deg, #ff4d7a 0%, #ffb02e 55%, #ffe66d 100%); }
  .kart .art::before { content:""; position:absolute; inset:-30% -20%; background: repeating-linear-gradient(115deg, rgba(255,255,255,.38) 0 18px, transparent 18px 52px); transform: rotate(-6deg); }
  .spider .art { background: radial-gradient(circle at 68% 44%, #ff5263 0 18%, transparent 19%), linear-gradient(135deg, #16224e 0%, #233c8f 50%, #070b1e 100%); }
  .spider .art::before { content:""; position:absolute; inset:-40%; opacity:.5; background: repeating-conic-gradient(from 0deg at 68% 44%, rgba(255,255,255,.35) 0deg 1.2deg, transparent 1.2deg 16deg), repeating-radial-gradient(circle at 68% 44%, transparent 0 18px, rgba(255,255,255,.28) 19px 20px, transparent 21px 40px); }
  .tag { position: absolute; z-index: 2; top: 12px; left: 12px; padding: 4px 9px; border-radius: 999px; background: rgba(5,7,16,.58); border: 1px solid rgba(255,255,255,.28); font-size: 10px; font-weight: 700; letter-spacing: 1.6px; text-transform: uppercase; backdrop-filter: blur(5px); }
  .num { position: absolute; z-index: 2; right: 14px; bottom: 10px; font-size: 42px; font-weight: 800; line-height: 1; color: rgba(255,255,255,.34); }
  .body { display: flex; flex-direction: column; flex: 1; padding: 16px 18px 18px; }
  .body h2 { margin: 0; font-size: clamp(20px, 2.4vw, 25px); letter-spacing: -.4px; }
  .body p { margin: 8px 0 16px; color: var(--muted); font-size: 13.5px; line-height: 1.55; flex: 1; }
  .play { display: inline-flex; align-items: center; gap: 7px; color: var(--acc); font-size: 13px; font-weight: 700; letter-spacing: .3px; }
  .play .arrow { transition: transform .18s ease; }
  .card:hover .arrow { transform: translateX(4px); }
  footer { display: flex; flex-wrap: wrap; gap: 8px 20px; justify-content: space-between; margin-top: 28px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12.5px; line-height: 1.5; }
  footer b { color: var(--ink); font-weight: 600; }
  @media (max-width: 860px) { .games { grid-template-columns: 1fr; } .art { height: 128px; } .body p { margin-bottom: 12px; } }
  @media (max-width: 420px) { h1 { letter-spacing: -1px; } .lede { margin-top: 12px; } footer { display: block; } footer span { display: block; margin-top: 6px; } }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
</head>
<body data-app-ready="true">
<main>
  <header>
    <p class="eyebrow">Three.js &middot; procedural &middot; zero asset files</p>
    <h1>Fable <span>Sandbox</span></h1>
    <p class="lede">Three playable worlds generated entirely in code. Pick a city, a circuit or a skyline &mdash; each game runs in the browser and shows touch controls on phones and tablets.</p>
  </header>
  <section class="games" aria-label="Games">
    <a class="card gta" href="/gta/">
      <div class="art"><span class="tag">Open world</span><span class="num">01</span></div>
      <div class="body">
        <h2>Fable City</h2>
        <p>Drive, shoot and outrun a five-star wanted level across a procedural island with traffic, missions and shops.</p>
        <span class="play">Play Fable City <span class="arrow" aria-hidden="true">&rarr;</span></span>
      </div>
    </a>
    <a class="card kart" href="/kart/">
      <div class="art"><span class="tag">Racing</span><span class="num">02</span></div>
      <div class="body">
        <h2>Fable Kart</h2>
        <p>Six tracks, Grand Prix, drift boosts and Balloon Battle, powered by a chiptune score synthesised at runtime.</p>
        <span class="play">Play Fable Kart <span class="arrow" aria-hidden="true">&rarr;</span></span>
      </div>
    </a>
    <a class="card spider" href="/spider/">
      <div class="art"><span class="tag">Action</span><span class="num">03</span></div>
      <div class="body">
        <h2>Web-Slinger</h2>
        <p>Web-swing across Manhattan, chain freeflow combos and follow a story campaign from the rooftops.</p>
        <span class="play">Play Web-Slinger <span class="arrow" aria-hidden="true">&rarr;</span></span>
      </div>
    </a>
  </section>
  <footer>
    <span><b>Built with Three.js + Vite.</b> Procedural worlds, textures, music and sound.</span>
    <span>Touch controls are automatic on mobile.</span>
  </footer>
</main>
</body>
</html>
HTML

/usr/bin/time -p tee "$DIST/favicon.svg" >/dev/null <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#ffd24a"/><path d="M22 16h24v8H31v8h13v8H31v16h-9z" fill="#070913"/></svg>
SVG

for page in "$DIST/index.html" "$DIST/gta/index.html" "$DIST/kart/index.html" "$DIST/spider/index.html"; do
  run sed -i 's#</head>#<link rel="icon" type="image/svg+xml" href="/favicon.svg"></head>#' "$page"
done

run mkdir -p "$WEB_DIR"
/usr/bin/time -p node -e '
  const fs = require("node:fs");
  const [file, project, directory] = process.argv.slice(1);
  fs.writeFileSync(file, JSON.stringify({ project, directory }));
' "$WEB_DIR/deployment-output.json" "$PROJECT_DIR" "$DIST"

printf '\n==> serving %s on 0.0.0.0:%s\n' "$DIST" "$PORT"
exec python3 -m http.server "$PORT" --bind 0.0.0.0 --directory "$DIST"
