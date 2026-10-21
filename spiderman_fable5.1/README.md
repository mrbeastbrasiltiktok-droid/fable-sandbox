# Web-Slinger — a browser Spider-Man (Three.js)

Swing through a procedurally generated Manhattan, fight freeflow-style, and run an open-world loop of story missions, random crimes, rooftop races and collectibles. No art assets: the city, the hero, the thugs and every sound are generated in code.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static bundle in dist/
```

Click **PLAY** (pointer lock). Progress (level, skills, story, backpacks, race times) autosaves to the browser; the menu offers **CONTINUE** or **NEW GAME**. A standard gamepad works too: sticks move/look, RT swing, A jump, X attack, B dodge, Y zip, LB web-shoot, RB web-strike, LT sprint/dive, d-pad finisher/heal/bomb. You start on the street; the first mission walks you through running, swinging and zipping. Press `C` any time for the controls panel; the bar at the bottom of the screen always shows the keys that matter in your current state. `ESC` pauses.

## Controls

| Key | Action |
|---|---|
| `W A S D` | move / steer (mid-swing: `W` reels in + pumps, `S` lets out, `A D` shifts the next anchor to turn) |
| Mouse | look — the camera also auto-follows while swinging |
| **Right mouse (hold)** | web-swing. Release near the bottom of the arc for speed, near the top for height |
| `Space` | jump · jump-release from a swing · jump off a wall · double jump (skill) |
| `E` | web-zip to whatever the crosshair is on, up to 150 m. Roof → perch. Wall → cling (hold `SPACE` on arrival to launch up and over). Press `E` again mid-zip to chain to the next building |
| `Shift` | sprint on the ground · dive in the air |
| **Left mouse** | attack (4-hit chain, 4th hit launches) |
| `Q` | dodge (spider-sense flashes when an attack is coming — a dodge inside the last 0.2 s is a *perfect dodge*) |
| `F` | web-strike: zip to an enemy (or the getaway van) and hit them |
| `R` | web-shoot: webs an enemy in place, breaks shields |
| `G` | finisher (1 Focus bar, 2 for brutes) · `H` heal (1 Focus bar) · `1` web bomb |
| `T` | web-throw: hurl the nearest thug (webbed brutes too) where you're looking, bowling over anyone in the path · mid-air with nobody near: air trick |
| `V` | web-yank: pull a distant enemy (gunmen!) to your feet |
| `P` | take a photo (photo-op jobs) |
| `O` | toggle ambient occlusion |

Context moves: attack (LMB) while airborne above an enemy → **dive kick** shockwave; attack inside the window after a **perfect dodge** → instant counter web-strike.
| `Tab` | toggle tracking between the story mission and the active crime |

## What's in the box

- **Feel** — 120 Hz fixed-step physics with render interpolation, momentum-preserving landing rolls, generative synth score that swells into a beat during fights, adaptive quality (AO and pixel ratio step down if frame time stays high), contextual key prompts.
- **Walls** — run straight at a wall and you run up it; momentum carries you, holding W keeps you running, and it blends into a steady climb. Feet stay on the wall with the body leaning back; crawling has its own limb cycle. SPACE leaps off, E zips, RMB swings, LMB leaps into an enemy.
- **Swinging** — rigid rope constraint (project onto the sphere, re-derive velocity), ~3× gravity, anchors chosen by fan-casting real building geometry ahead/above the player and alternating sides. Rope auto-shortens so you never dip into the street, hitting a wall converts into a wall-run, release on the rise adds a boost, and a swing-assist scalar in `src/core/Config.js` keeps you moving over plazas.
- **Rendering** — ACES tone mapping, GTAO ambient occlusion, soft bloom on lit windows, PCF soft shadows following the player.
- **Camera** — FOV 70→98° with speed, a 5° kick on every web attach, roll into the turn, pitch tracking the pendulum, collision with buildings.
- **Combat** — attack chains with lunges, hitstop, launchers and air juggles, dodge with i-frames + perfect-dodge slow-mo and counters, web-strike, web-shoot, web-throw, web-yank, dive kick, finishers/heals that spend Focus, a web bomb gadget. Every animation cancels into dodge; attacks buffer. Four enemy archetypes that each force a different answer: thug, gunman (prioritise), shield (hit from behind / F / R), brute (web first, two-bar finisher).
- **Open world** — 9-mission story (swing tutorial → first fight → checkpoint race → courier delivery → armed robbery → photo op → van chase → backpacks → rooftop boss), then free roam with random events: crimes (mugging, robbery, brawl, getaway van, timed rescue) and jobs (courier delivery, medical rush, photo op), 4 rooftop checkpoint races with par times, 40 rooftop backpacks, XP with level-up skill picks, minimap and waypoints.
- **City** — 28×18 rectangular blocks (64×116 m, 28 m streets), log-normal building heights shaped by a two-Gaussian downtown/midtown field, procedural windows in the shader, rooftop props, looping traffic, dusk sky with a player-following shadow map and fog.

## Layout

```
src/core        Game loop, Config (all tunables), Input, FX
src/world       City generation + spatial queries, building shader, sky/lights, traffic
src/player      Player state machine, anchor finder, procedural Spider-Man model, web line
src/camera      Third-person camera
src/combat      Enemy archetypes + AI, freeflow combat
src/missions    Story, crimes, races, backpacks, XP/skills, getaway van
src/ui          HUD + minimap
src/audio       Synthesised SFX
docs/           RESEARCH.md (what the real games do and why) · DESIGN.md (how this game applies it)
```

Tuning: open the console and poke `game.player`, or edit `src/core/Config.js` — Vite hot-reloads.
