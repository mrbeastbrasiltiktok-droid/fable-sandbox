# Fable Sandbox

Three browser games built with **Three.js** + **Vite**. Everything is procedural — the worlds, the
characters, the textures, the music and the sound effects are generated in code. There are no art or
audio asset files in this repo.

| Folder | Game | Dev server |
|---|---|---|
| [`gta_fable5.1/`](gta_fable5.1) | **Fable City** — a GTA-style open world: drive, shoot, get a wanted level | http://localhost:5175 |
| [`kart_fable5.1/`](kart_fable5.1) | **Fable Kart** — a Mario Kart–style racer: 6 tracks, Grand Prix, Balloon Battle | http://localhost:5176 |
| [`spiderman_fable5.1/`](spiderman_fable5.1) | **Web-Slinger** — web-swing across a procedural Manhattan, freeflow combat, story missions | http://localhost:5173 |

## Run one

Each folder is a self-contained project. Pick one, install, and start it:

```bash
cd gta_fable5.1     # or kart_fable5.1, or spiderman_fable5.1
npm install
npm run dev
```

Then open the URL it prints (the ports are in the table above — they don't collide, so you can run
all three at once in separate terminals).

## Build a static bundle

```bash
npm run build       # outputs to dist/
npm run preview     # serve the built bundle locally
```

`dist/` is a plain static site — drop it on any static host.

## Requirements

Node 18+ and a browser with WebGL2. Each game's own README has the full controls, and
`DESIGN.md` (in `gta_fable5.1/` and `spiderman_fable5.1/docs/`) has the implementation notes.
