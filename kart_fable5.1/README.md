# Fable Kart

A Mario Kart–style arcade racer in the browser. Three.js + Vite, everything procedural (no asset files).

```
npm install
npm run dev      # http://localhost:5176
```

## Play

| Action | Keys | Gamepad |
|---|---|---|
| Steer | ← → / A D | Left stick |
| Accelerate | ↑ / W | A / RT |
| Brake / reverse | ↓ / S | LT |
| Hop / drift | Space / Shift (hold) | B / RB |
| Use item | Ctrl / E / X / left mouse (hold to trail) | X / Y |
| Throw backward | right mouse / C / hold ↓ | LT |
| Rear view | R | Back |
| Pause | Esc / P | Start |

Modes: Single Race, Grand Prix (all 6 tracks, MK8 points table), **Balloon Battle** (3 arenas, 3 balloons each, 2:30, last kart standing or most balloons/hits wins), Time Trial (solo, no items). 50/100/150cc.

Mouse: left button holds/throws the item, right button throws it backward.

## Mechanics (modelled on Mario Kart 8 Deluxe)

- **Drift / Mini-Turbo** – hop while steering, hold to drift. Charge accrues at 300 units/s when steering ≥ 0.35 into the drift, 160 units/s otherwise (MK8: 5 vs 2 units/frame). Blue sparks at 240, orange at 520, purple at 860. Boost lengths 0.62 s / 1.67 s / 2.63 s (Nintendo’s published MK8D values), scaled by the character’s Mini-Turbo stat. Steering into the drift tightens the arc, steering away opens it; alternating (“waggling”) keeps a wide line while charging fast.
- **Characters** – 8 originals across MK8D-style weight classes with Speed / Acceleration / Weight / Handling / Traction / Mini-Turbo stats that map onto the physics (top speed spread ≈ 10 %, acceleration curve, steer rate, velocity-direction lag, collision mass, boost duration).
- **Surfaces** – road, curb (‑8 %), off-road (‑45 % unless boosting), ice (low traction), bumps, and void (fall → Lakitu respawn at last good position, −3 coins).
- **Items (18)** – banana, triple banana, green shell (bounces off walls), triple green, red shell (track-following then homing), triple red, spiny/blue shell (flies to 1st and explodes), mushroom, triple mushroom, golden mushroom, star, Bullet Bill (autopilot), lightning (everyone shrinks, leaders longer), blooper (ink on karts ahead), bob-omb, fire flower (10 shots), super horn (radius blast, blocks blue shells), coin. Trailed shells/bananas absorb hits. Distribution is position-based like MK8: defence and coins in front, red shells mid-pack, mushrooms/stars/bullets at the back, with rules (no blue shell for 1st, one blue at a time, lightning cooldown, bullet only from 5th back).
- **Extras** – coins (+0.6 % top speed each, max 10, lose 3 on hit), rocket start, slipstream, trick boosts off ramps, boost pads, kart–kart bumping by mass, star/bullet knock-outs, wrong-way warning, rubber-band AI that drifts, waggles, throws and dodges.

## Debug harness

Open `http://localhost:5176/?debug`. `window.app` is the app; once in a race:

```js
window.step(n, keys)                     // n fixed 1/60 s steps with a constant input, then renders
window.step(n, (i, player, race) => ({ throttle: 1, steer: player.autoSteer(18) }))  // per-step input function
new window.__mods.AIDriver(player, race.track, new window.__mods.RNG(1), 1.2)        // AI-drive the player
```
Start a race without menus: `app.mode='race'; app.cc=150; app.charIdx=2; app.menuConfirm('tracks', 0)`.

## Layout

`src/track.js` builds a closed Catmull-Rom spline into road/curb/shoulder/terrain strips with a nearest-point sampler (`sample`, `surfaceAt`, `heightAt`). `src/kart.js` is the physics controller (drift, boosts, stuns, walls, ramps, laps). `src/items.js` holds item definitions, probability tables and projectiles. `src/ai.js` drives CPU karts. `src/race.js` orchestrates a race (collisions, slipstream, positions, events). `src/menu.js`/`src/hud.js` are DOM; `src/audio.js` is procedural WebAudio incl. a per-theme chiptune sequencer.
