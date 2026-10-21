# Web-Slinger — Design

Companion to `RESEARCH.md`. That doc says what Insomniac / Treyarch did and why; this one says what *this* game does with it.

## Pillars

1. **Traversal is the reward.** Every objective is reachable only by swinging well; nothing makes you stand still.
2. **Momentum is never taken away.** State transitions add velocity or keep it; only landing and being hit slow you down.
3. **Every enemy asks a different question.** No two archetypes share an answer.
4. **Readable feedback for everything.** Sound, FOV, particles, hitstop, HUD.

## Swinging (src/player/Player.js, Swing.js)

| Aspect | Choice | Research source |
|---|---|---|
| Rope | Rigid distance constraint, position projected onto sphere, velocity re-derived from positions | §1 "constraint, not spring" |
| Gravity | 30 m/s² (3× real), terminal 95 | §1 |
| Anchor | Fan-cast from `pos + up·6 + fwd·4`, pitches 30/45/60/75°, yaw ±20°, score toward 30 m rope & 60° pitch | §1 anchor selection |
| Steering | Anchors alternate sides (0.5 rad); A/D shifts the anchor up to 55°; tiny lateral force scaled by `assist` | "anchor placement is the steering" |
| Cheats | Rope shortened for 3 m ground clearance; wall impact → wall-run; forward auto-correct on stalls; no corner wrap; no fall damage | §1 five cheats |
| Release | +7 m/s along velocity, +3 up when rising; Space adds a jump | "release = jump" |
| Caps | Horizontal soft cap 45 m/s (0.9/frame over cap); vertical uncapped | §1 |
| Assist | `CFG.assist` 0–1: virtual anchors over plazas, steer help, wider auto-aim on failure | Insomniac's assist slider |
| Extras | Zip (`E`) with point-launch (+15 fwd, +12 up), dive (`Shift`, +18 m/s²), wall crawl, double jump skill | §1 moveset |

Fixed timestep: 1/120 s substeps in `Game._loop`, visuals interpolated per frame.

## Walls

Running into a wall on foot (or arriving airborne) converts horizontal speed into an upward wall-run (`wallVy`), which decays at 0.55 g, or 0.3 g while W is held, and then blends into a steady 9 m/s climb. Crawl velocity is damped so starts and stops don't pop. The model leans back 35° off the wall with the run cycle driving the feet during a run, and uses a spread-limb crawl cycle otherwise; the root is offset along the wall normal so feet stay on the surface. The camera eases behind the player and pitches up the wall. Space leaps off, RMB kicks off then swings, E zips, LMB leaps into a strike or dive kick.

## Camera (src/camera)

FOV 70→98° between 15 and 45 m/s (smoothed), +5° kick on attach, follow distance 6→9 m, roll into lateral velocity (±6°), pitch eases toward the pendulum tangent, auto-yaw toward heading when the mouse is idle, ray-vs-city collision, shake on hard landings/hits.

## Combat (src/combat)

- Attack: 0.10 s startup / 0.07 active / 0.17 recovery; chain from recovery; lunge up to 3.5 m (6 in the air) toward a target in a ±60° cone. Hits 1–3 stagger, hit 4 launches (enemy gravity ×0.35 while you keep hitting; 8-hit juggle cap).
- Hitstop 0.07 s (0.14 on launchers), combo decays after 2.5 s and resets on damage.
- Enemy telegraph: 0.42 s windup → 0.2 s perfect window → 0.1 s late → impact. Spider-sense ring above the attacker's head + sound.
- Dodge: 0.3 s i-frames, perfect dodge → 0.35 s at 0.35× time, +35 Focus, attacker staggered.
- Focus: 3 bars of 100. Hits build it; heal (`H`) or finisher (`G`, 2 bars for brutes) spend it. That tension is the meta-game.
- Archetypes: **thug** (fuel), **gunman** (hitscan; prioritise or keep moving — fast players are hard to hit), **shield** (front blocks; `R`, `F`, or attack from behind), **brute** (no stagger; web him with `R`, two-bar finisher).
- Gadget on a number key, not a wheel: `1` web bomb (3 charges, 20 s regen).
- Special moves (each answers a situation, none is a stat stick): **web throw** (`T`, crowd control — thrown bodies bowl over others and slam on impact), **web yank** (`V`, drags gunmen out of cover), **dive kick** (attack while airborne above a target — shockwave), **perfect-dodge counter** (attack in the 0.9 s window → instant web-strike), **air tricks** (`T` mid-air, Focus + XP). Brutes must be webbed before they can be thrown or yanked.
- Enemies knocked off a roof take fall damage; thrown enemies take slam damage on walls/ground.

## Open-world loop (src/missions)

Meso loop target 90–180 s. Story gates the systems in the order you need them:

1. **Get Your Legs** — swing ~450 m to a rooftop.
2. **Street Justice** — three thugs.
3. **Rooftop Run** — checkpoint race (the objective *is* the mechanic).
4. **Special Delivery** — courier job: pick up a package, deliver it across town on a timer.
5. **Armed and Dangerous** — gunmen + shield.
6. **Front Page** — photo op: reach a vantage ring, frame the subject beacon, press P.
7. **Hot Pursuit** — getaway van: three web-strikes or ride the roof, then the crew bails.
8. **Lost and Found** — four backpacks.
9. **The Big One** — two brutes + crew on the tallest roof.

Then free roam: a random event every 70–140 s drawn from eight types — five crimes (mugging, robbery, brawl, van chase, timed rescue) and three civic jobs (courier delivery, medical rush with a tighter clock, photo op) — plus four races with par times, 40 backpacks, and level-ups with three-choice skill picks that add **verbs** (double jump, faster zip, more thrust) not just stats.

## City (src/world)

28×18 blocks of 64×116 m with 28 m streets (≈ 0.5–1 × the 52 m swing chord). Heights are log-normal (μ = ln 70, σ = 0.55) multiplied by a two-Gaussian skyline field, snapped to 3.5 m floors, 15–320 m. One `InstancedMesh` for all buildings with a shader that fakes lit windows from world position; rooftop props, looping traffic and a water plane at the edge. Collision is hand-rolled AABB + ray-vs-AABB against the O(1) block grid.

## Persistence

Autosave to `localStorage` on every mission/crime/job/race completion, backpack pickup and skill pick. Skills are stored by id and re-applied on load. Physics state is never saved; you always resume on the street.

## Known simplifications

- Enemies don't path-find; they walk straight at you and are spawned on open ground.
- Traffic is decorative (no collision).
