# Spider-Man-style Browser Game — Design Research Reference

Research compiled for a Three.js web-swinging game. Everything here is meant to be turned
into code. Where a source gives a hard number it is cited; where no public number exists,
a **[TUNE]** starting value is given — these are derived from the cited behaviour and are
meant to be dialled in, not treated as gospel.

Unit convention used throughout: **1 world unit = 1 metre**, gravity is negative-Y,
fixed timestep physics.

---

## 1. WEB-SWINGING FEEL

### 1.1 The single most important decision: attach to real geometry

The dividing line between "Spider-Man game that feels good" and "flying with cosmetic
webs" is whether the web line terminates on actual collidable geometry.

- Treyarch's *Spider-Man* (2002) shot webs "up to the sky" — the web was decoration on a
  scripted flight curve. Jamie Fristrom (technical director/designer) considered this the
  central failure and rebuilt it for *Spider-Man 2* (2004).
- *Spider-Man 2* solved attachment with **raycasts fired relative to the character**; where
  a ray intersects physical geometry is the anchor. This replaced hand-authored attach
  points with an effectively infinite set of them.
- Insomniac's *Marvel's Spider-Man* (2018) went the other way: **every piece of architecture
  in the city is authored/tagged with attachment points on building edges**, and the system
  picks the point that best preserves momentum. Trees and lampposts in Central Park are
  tagged too, so that low-rise district still swings.
- **Recommendation for a browser game:** do the *Spider-Man 2* thing (raycast), because
  your city is procedural and you cannot author tag points. Raycast against a simplified
  AABB proxy set, not render meshes.

### 1.2 Rope constraint, not a spring

Both the 2004 game and virtually every good implementation model the web as a **rigid
distance constraint (a tether), not a spring**. Springs oscillate, bounce, and feel rubbery;
a hard constraint feels like a rope.

The canonical formulation (Fristrom's own write-up of the Spider-Man 2 / *Energy Hook*
technique) treats the rope as an **invisible sphere the player slides along the inside of**:

```
// integrate freely first
velocity += acceleration * dt
testPosition = position + velocity * dt

// then project back onto the sphere if outside it
delta = testPosition - tetherPoint
if (delta.length() > tetherLength) {
    testPosition = tetherPoint + delta.normalized() * tetherLength
}

// derive corrected velocity from the corrected position (this is what kills the radial
// component and leaves pure tangential motion — the same trick as sliding along a wall)
velocity = (testPosition - position) / dt
position = testPosition
```

Key properties of this approach:

- It is **unconditionally stable** — no spring constant to blow up.
- It automatically produces correct pendulum behaviour: energy is conserved except for
  whatever damping you deliberately add.
- The velocity re-derivation (`(newPos - oldPos)/dt`) is what makes it feel like a rope
  rather than a leash — it removes the radial component instead of reflecting it.
- Because the constraint is one-sided (`if length > tetherLength`), the player can fall
  *inside* the sphere freely — which is exactly what you want when they web a point above
  and then dive.

Euler integration is enough here; Fristrom explicitly notes the naive
`pos += vel*dt; vel += acc*dt` is a rough approximation and suggests averaging
`(oldVelocity + velocity) * dt / 2` for better accuracy. Use a **fixed timestep**
(1/60 s, or 1/120 s with substepping) — variable dt makes swing arcs inconsistent between
machines and is a classic source of "why does it feel different on my laptop".

**[TUNE] starting values:**

| Parameter | Value | Note |
|---|---|---|
| `gravity` | **-25 to -35 m/s²** | *Not* -9.81. Real gravity makes swings feel floaty and slow. ~3× real is standard for arcade traversal. Start at **-30**. |
| `fixedTimestep` | 1/60 s, 2 substeps | |
| `maxRopeLength` | **90 m** | roughly 25–30 storeys |
| `minRopeLength` | **8 m** | clamp so you never divide by ~0 |
| `airDrag` | 0.999 per frame (≈0.94/s) | almost none while swinging |
| `maxSpeed` | **45 m/s** | see 1.6 |

### 1.3 Attachment-point selection (the actual secret sauce)

This is where "feels amazing" is won or lost. Neither game just raycasts straight forward.

**The rule Insomniac stated publicly:**
> "Lines that go out to the side cause you to turn, while lines that go more vertical let
> you swing more straight ahead."

That single sentence is the whole steering model. **The anchor's lateral offset from the
player's velocity direction *is* the steering input.** Do not steer with a separate
"turn force" — steer by choosing where the web goes.

**Concrete algorithm:**

```
1. Build a search direction:
     fwd    = horizontal component of player velocity (or camera forward if near-stationary)
     side   = fwd × up
     dir    = normalize( fwd * cos(yaw) + side * sin(yaw) )
   where yaw = steerInput * MAX_STEER_ANGLE        // steerInput ∈ [-1, 1] from A/D or mouse-X

2. Fire a fan of raycasts from a point ABOVE and AHEAD of the player:
     origin = playerPos + up * 6 + fwd * 4
     for each pitch in [ 30°, 45°, 60°, 75° ]        // elevation above horizontal
       for each yawOffset in [ -20°, -10°, 0°, +10°, +20° ]   // auto-aim spread
         cast ray of length maxRopeLength

3. Score every hit and keep the best:
     score =  w1 * (how close the hit's pitch is to the IDEAL_PITCH)
            + w2 * (alignment of hit direction with desired steer direction)
            + w3 * (predicted post-swing speed)
            - w4 * (penalty if the resulting arc would clip the ground)
```

**Numbers to start with:**

- `MAX_STEER_ANGLE` = **50–60°** — the maximum lateral offset the anchor may be placed at.
  Larger = tighter turns but more speed loss (turning costs speed, and it should).
- `IDEAL_PITCH` ≈ **55–65°** above horizontal. A web that goes near-vertical gives a short,
  fast, flat swing; ~45° gives a long, high, slow arc. 60° is the sweet spot for "forward
  and fast with a satisfying dip".
- **Auto-aim cone: ±20° horizontal, ±25° vertical.** This is the assist that makes the
  game playable with a mouse. If nothing is hit inside the cone, widen to ±45° for one
  retry before failing the swing.
- **Ray origin above the head, not from the hands.** Casting from the player's chest finds
  the wall you are about to hit; casting from 5–8 m above finds the roof edge you want.
- **Prefer edges.** In a raycast city you get face hits. Bias the score toward hits whose
  surface normal is *upward-ish* (roof) or whose hit point is within a few metres of a
  building's top edge — that reproduces Insomniac's "attach to building edges" rule and
  stops webs from anchoring to the middle of a wall you then smack into.

**Fallback ("sky" anchor):** if no geometry is found, do **not** attach to nothing. Either
(a) refuse the swing and let the player fall, or (b) attach to a virtual point and fade the
web line out — but option (b) is exactly the 2002 mistake. In a procedural city, a better
fallback is to raise the density of tall buildings so this rarely happens.

### 1.4 The dip, release, and launch

The dip at the bottom of the arc is the payoff of the whole mechanic and it emerges for
free from the constraint — but only if you don't fight it.

- **Energy conservation is the model.** At release, speed follows `v = sqrt(2 * g * h_drop)`
  where `h_drop` is how far below the anchor's height the player fell. Deeper dip = faster
  exit. This is why letting the player web *high* anchors and fall far is intrinsically
  rewarding — no artificial speed boost needed.
- **After release the player is a plain projectile** — parabolic, gravity only, no steering
  authority beyond a small air-control nudge.
- **Release timing changes everything, and this is the skill expression:**
  - Release **early / at the bottom of the arc** → low, flat, fast, heads for street level.
    Insomniac: "releasing earlier sends the player downward toward street level."
  - Release **late / on the upswing** → converts speed into height, arcs up over buildings.
    Insomniac: "pressing jump at swing's end launches forward."
- **Give a release jump/impulse.** Both games let you press jump at release. Add
  **+6 to +9 m/s along the current velocity direction, plus +3 m/s of up**, and only if
  the player is on the rising half of the arc. This is the "flick" that makes chained
  swings accelerate instead of decay.
- **Inherit velocity fully.** Never zero or damp velocity on detach. Momentum preservation
  across every state transition (swing → air → wall-run → swing → zip) is the #1 thing
  people praise in Insomniac's version and the #1 thing they criticise in the 2004 game,
  where switching between web-zip and swinging bled momentum.

### 1.5 Physics cheats you must implement (Insomniac's stated list)

Insomniac made the basics easy and layered mastery on top. Their publicly described cheats:

1. **Shorten the web near the ground.** If the swing arc would take the player below a
   ground clearance threshold, shrink `tetherLength` toward a `desiredLength`, raising the
   arc. Fristrom's write-up names exactly this pattern: keep `desiredLength` and
   `currentLength` separate and lerp `currentLength → desiredLength`. **[TUNE]** clearance
   = 3 m, shorten rate = 25 m/s, lerp back out at 10 m/s.
2. **Auto wall-run on collision instead of crashing.** If the player hits a wall while
   moving fast, don't stop them — enter a wall-run state that preserves horizontal speed
   and converts some of it to vertical. This alone removes most rage moments.
3. **Auto-correct forward momentum** so the player doesn't need constant stick input just
   to keep going straight.
4. **Don't wrap the line around corners.** *Spider-Man 2* (2023) explicitly stopped web
   lines from wrapping on corners because wrapping caused "an abrupt change of speed and
   angle". Do not implement rope wrapping; it looks clever and feels awful.
   (The 2004 game had a three-band rule: too close to an outcropping → web breaks;
   mid-distance → wrap; far → pass through. Modern consensus: just pass through.)
5. **No fall damage from traversal.** *Spider-Man 2* (2023) made fall damage an *optional
   toggle*, off by default. Landing at any speed should be a recovery-roll animation, never
   a punishment. In a browser game with no landing animation, just clamp downward velocity
   on ground contact and play a dust puff.

### 1.6 Speed, caps, and the feeling of "fast"

- Datamined/measured figures for Insomniac's Spider-Man put average swing speed around
  **28–30 m/s (~63–67 mph)**, with web-pull slightly faster than free swinging. That is a
  useful anchor: your comfortable cruise speed should be ~30 m/s and your cap somewhere
  around **45 m/s**.
- **Cap horizontal speed, not total speed.** Capping total speed kills dives. Let vertical
  velocity run free (or cap it much higher, ~70 m/s) so diving feels dangerous and fast.
- Apply the cap as a **soft cap**: above `maxSpeed`, scale excess by 0.9 per frame rather
  than hard clamping — a hard clamp is perceptible as a "wall".
- Cost model that creates skill expression: **turning costs speed.** Scale a small
  velocity penalty with `|steerInput|` (e.g. up to −4% per swing at full lock). Insomniac
  used the same idea — "momentum penalties for opposite directions" with the analog stick.

### 1.7 The supporting moveset

Swinging alone gets boring in about 90 seconds. Both games surround it with:

- **Web-zip / point launch.** Insomniac has two variants: (a) a plain forward zip that adds
  momentum, (b) *point launch* — zip to a tagged perch (lamppost, water tower, flagpole,
  gargoyle) and spring off it for a large boost. Point Launch Boost (press X on contact)
  "massively boost[s] Point Launch distance." In 2004 the zip was weak and bled momentum;
  that is the anti-pattern.
  **[TUNE]** zip: instant +18 m/s toward target, max range 60 m, cooldown 0.4 s.
  Point launch: on arrival, +25 m/s along the direction the camera faces, +12 m/s up.
- **Charge jump.** Hold to charge, release for a big leap. Present in both games; it's the
  bridge between ground movement and getting airborne enough to start a swing.
  **[TUNE]** 0.8 s full charge → 22 m/s up, 12 m/s forward.
- **Dive.** Point down and accelerate hard. This is the *speed reset button*: dive to trade
  height for speed, then swing to trade speed back for height.
  **[TUNE]** dive adds +18 m/s² downward accel and raises FOV noticeably.
- **Wall-run.** Enter on wall contact above a speed threshold, preserve tangential speed,
  drain vertical over ~1.5 s. Corner-turning during a wall run is one of Insomniac's named
  mastery moves.
- **Air tricks.** In *Spider-Man 2* (2023): hold Square + left stick while airborne. They
  do nothing mechanically except generate XP/Focus and look cool — which is the point: a
  reason to stay in the air longer and a way to make dead time expressive.
- **Web wings / glide** (2023 only). A hold-or-toggle glide mode with its own inverted-axis
  options. Optional for a small game, but it's the thing that makes long low-density
  stretches survivable.

### 1.8 Swing assist as an explicit, exposed setting

*Marvel's Spider-Man 2* (2023) ships a **Swing Steering Assistance slider, 0–10**, default
**10** (which equals the assist level of the 2018 game). Turning it down "reduce[s]
resistance and cause[s] physics to have a greater effect on web-lines"; at 0 players "will
actually be able to swing into the ground and more regularly smack into obstacles."

Other exposed assists in that game worth copying:
- **Slow Corner Timescale** — slows time briefly when whipping around a corner, to reduce
  disorientation.
- **Web Line Bending** on/off.
- **Fall damage** on/off (off by default).
- **Dodge/Parry Timing: Normal / Increased.**

**Lesson:** build the assists as a *scalar*, not a boolean, from day one. Wire
`assist ∈ [0,1]` into: auto-aim cone width, ground-clearance web shortening, forward
momentum auto-correct strength, and auto-wall-run threshold. It costs almost nothing and it
is both an accessibility feature and a difficulty/mastery axis.

### 1.9 Camera — half the feel lives here

Insomniac's own framing: the sense of speed comes from "a combination of camera movement,
field of view, and character animation," and they wrote custom code to roll the camera with
the swing line.

Concrete behaviours to implement:

- **FOV scales with speed.** Base **70°**, lerp toward **95–100°** as speed goes 20→45 m/s.
  Use `fov = lerp(70, 98, clamp01((speed-15)/30))` with a smoothing time of ~0.25 s.
- **Follow distance scales with speed too.** Both FOV *and* dolly distance increase with
  acceleration — this is a genuine **dolly zoom**, and every web shoot triggers a brief FOV
  bump, producing what one analysis calls a "dolly heartbeat." Formula given for the dolly
  compensation: `x₁ = tan(α/2)/tan(α/(2z)) * x₀`.
  **[TUNE]** distance 6 m → 9 m over the same speed range; +5° FOV kick for 0.15 s on each
  web attach, eased out.
- **Camera pitch tracks the pendulum tangent.** Match the camera's pitch to the tangent of
  the arc, and slide the character down-frame on the upswing. This is what sells verticality.
- **Camera lag.** Position the camera with a critically-damped spring
  (`smoothTime ≈ 0.12 s`); do **not** rigidly parent it. Lag is what makes acceleration
  readable.
- **Low-angle tilt near the ground.** When the player dips below ~15 m, pitch the camera
  down/behind so buildings streak past overhead — proximity to geometry is the single
  strongest speed cue, which is why the Manhattan street canyon works so well.
- **Roll.** Small camera roll (±6°) toward the inside of the swing.
- Keep the character **off-centre** (about 0.35 of screen width, opposite the swing side) so
  the direction of travel gets more screen.

### 1.10 Audio/visual feedback

- **Web line render:** a thin tapered quad or `THREE.Line` from hand to anchor, drawn with
  a 2–3 frame "shoot out" animation (lerp the endpoint from hand to anchor over ~60 ms) so
  the web reads as *fired*, not *appeared*. Add 1–2 slack segments (a shallow catenary that
  straightens under tension) — cheap and enormously convincing.
- **THWIP on fire, and a distinct low *tk* on attach.** Two sounds, not one. Pitch-shift
  the thwip ±10% randomly so chains don't sound looped.
- **Wind/whoosh volume and lowpass cutoff driven by speed.** Map `speed → gain` and
  `speed → filter frequency`; this is the cheapest, highest-impact speed cue after FOV.
- **Speed lines / radial blur vignette** above ~35 m/s. A screen-space shader that costs
  nothing and doubles the perceived velocity.
- **Motion blur on dives**, distant buildings moving slowly while foreground elements zip
  past — Insomniac explicitly names this parallax contrast as their velocity cue.

### 1.11 Why the 2004 game still gets cited

Worth internalising, because it's cheap to reproduce and the modern games arguably lost it:

- Web lines were **rigid once attached**, producing obvious, legible pendulum motion around
  a fixed point. Players could *see* the physics, so they could *predict* it.
- **Manual control over acceleration and direction mid-swing**, with jump-charge-at-release
  giving multiple distinct exits from every swing.
- Development was framed as "finding ways to make a very difficult challenge accessible" —
  i.e. the physics was real and the *assists* were the design work. That is the right order:
  build honest physics first, then layer forgiveness.

---

## 2. COMBAT

### 2.1 What Insomniac took from Arkham freeflow, and what they changed

Rocksteady's freeflow is famously modelled more on *Dance Dance Revolution* than on a
fighting game: four verbs on four face buttons (strike, cape/stun, dodge, counter), each
with a **telegraph prompt** that tells you which verb to press. Combos build a multiplier;
crossing a threshold unlocks special moves.

Insomniac's version differs in ways that matter for implementation:

- **Everything cancels into dodge.** "Absolutely every standard combat animation can be
  cancelled into a dodge." This is the core responsiveness rule. Finishers are the only
  non-cancellable actions — and enemies don't attack during them, so it's safe.
- **No counter button (in 2018).** There is dodge only; the spider-sense telegraph tells
  you to *move*, not to press a matching button. (2023 added parry on L1 for heavy attacks.)
- **The Z axis.** Aerial combat is the differentiator — launch, juggle, and fight entirely
  off the ground. Previous freeflow systems were essentially planar.
- **Combos survive whiffs** but break on being hit or on inactivity — so the pressure is
  "don't get hit," not "don't miss."
- The system is described as favouring **improvisation over precision** — "fast-paced and
  sloppy, in a good way." Don't build tight frame-perfect windows; build generous ones.

### 2.2 The dodge / spider-sense window

Mechanics as shipped:

- A **spider-sense indicator** appears above the head before an incoming attack.
- In 2023 it goes **white → red**; dodging while it is **red** is a **Perfect Dodge**,
  which slows time, briefly webs/blinds the attacker, and opens a free counter (Web-Strike
  or a combo). Pressing on white is too early.
- Heavy/unblockable attacks show a distinct **yellow/red flashing** telegraph and must be
  **parried** (L1), not dodged. Parrying "at the last second" is more effective than parrying
  early — i.e. there is a graded reward, not a binary.
- Perfect dodge also feeds **Focus**.
- Difficulty is exposed: **Dodge/Parry Timing → Increased** widens the window.

**Concrete timing model to implement (at 60 fps):**

| Phase | Duration | Behaviour |
|---|---|---|
| Telegraph (white) | 24 frames / 400 ms | indicator appears, enemy winds up |
| **Perfect window (red)** | **12 frames / 200 ms** | dodge here → perfect dodge |
| Late window | 6 frames / 100 ms | dodge here → normal dodge, no reward |
| Impact | — | hit lands |
| Dodge i-frames | 18 frames / 300 ms | from dodge start |
| Dodge recovery | 8 frames / 133 ms | cancellable into attack |
| Input buffer | 8 frames / 133 ms | see below |
| Perfect-dodge slow-mo | 0.35 s at timeScale 0.35, eased | |
| Perfect-dodge counter window | 45 frames / 750 ms real time | free Web-Strike/hit |

Assist scaling: `"Increased" timing` = perfect window **20 frames / 333 ms**. A generic
rule of thumb from action-combat practice: attack inputs tolerate **6–8 frames** of buffer
without feeling sticky, dodge inputs need **3–4 frames max** — buffer the *intent* but not
the *forgiveness*.

### 2.3 Attack chaining and the combo state machine

Use an explicit state machine with **startup / active / recovery** phases and named cancel
windows. Standard action-game structure, and the one Insomniac effectively uses:

```
IDLE
 ├─ attack pressed ──▶ ATTACK[n]
 │                     ├─ startup   (6f)   : no hitbox, cancellable only into DODGE
 │                     ├─ active    (4f)   : hitbox on, cancellable into DODGE
 │                     └─ recovery  (10f)  : cancellable into DODGE always,
 │                                            and into ATTACK[n+1] after frame 3 (IASA)
 │                                            → if no input by end, return to IDLE
 ├─ dodge  pressed ──▶ DODGE (18f invuln + 8f recovery)
 ├─ jump   pressed ──▶ AIR
 ├─ webstrike       ──▶ ZIP_TO_TARGET (travel) ──▶ ATTACK[0] on arrival
 ├─ launch (hold atk)▶ LAUNCH ──▶ AIR + target enters JUGGLED
 └─ finisher (focus full) ──▶ FINISHER (uncancellable, enemies suppressed)

AIR
 ├─ attack ──▶ AIR_ATTACK[n] (same phase structure, shorter recovery: 6f)
 ├─ target JUGGLED and hit ──▶ reset target's fall velocity to ~0, +0.15 s hang time
 ├─ dodge ──▶ AIR_DODGE
 └─ no input for 0.5 s or no juggled target ──▶ fall
```

Rules that make it feel right:

- **Hitstop.** Freeze both attacker and victim for **4–6 frames** on a landed hit
  (8–10 on a launcher/finisher). This is the cheapest possible "impact" and it is
  non-negotiable.
- **Attack lunge.** Each attack translates the player up to **3 m** toward the nearest
  valid target within a **±60° / 5 m** cone. Without this, 3D melee feels like whiffing.
- **Target reselection every attack**, not once per combo — that's what produces the
  "leaps across the screen between enemies" look.
- **Juggle gravity:** while an enemy is `JUGGLED`, use **0.35× gravity** and cap the number
  of consecutive juggle hits (~8) before they fall normally, so juggles end.
- **Combo counter** with a decay timer (**2.5 s** of no landed hit → reset; taking a hit →
  instant reset). Multiplier drives Focus gain and score.

### 2.4 Web-strike, web-throw, and web resources

- **Web-Strike**: zip to a target and hit them. It's the traversal-in-combat verb and the
  thing that keeps encounters mobile. Upgradeable for range/damage ("Long Strike").
  **[TUNE]** range 20 m, travel at 40 m/s, ~0.25 s of travel, i-frames during travel.
- **Air Yank** (hold Triangle in the air): pull an enemy *up* to you to continue an air
  combo without touching ground. This is the mechanic that makes aerial combat a *loop*
  rather than a one-off.
- **Web-throw / yank environment** (hold L1+R1): grab a physics object and throw it. Cheap
  to implement, huge in perceived variety, works with any AABB prop.
- **Web-shoot**: tap R1 to web an enemy; enough webbing sticks them to a surface and removes
  them from the fight. Give webbing a **finite ammo** that regenerates or is refilled by
  landing hits, so it's a resource and not a spam button.
- **Air throw**: web an enemy, jump, hold Triangle → slam them into the ground; instant KO
  in the real game (used against jetpack enemies).

### 2.5 Focus meter

Exactly two sinks, and the tension between them *is* the meta-game:

- **Built by:** landing melee hits, chaining combos, dodges (especially perfect dodges),
  web usage, and staying untouched. Air attacks generate more (the "Air Marshal" skill).
- **Spent on:**
  1. **Heal** (down on d-pad) — costs one full bar; there is no other healing.
  2. **Finisher** (Triangle+Circle) — instant KO on a normal enemy; **brutes require two
     full bars**.
- Using a takedown resets the freeflow bonus, so there is a real cost to cashing in.

**[TUNE]** 3 bars max. Gains: normal hit +2%, combo-multiplied hit +2%×min(mult,5),
perfect dodge +8%, web-strike +5%, air trick +3%. Heal restores 40% HP per bar.

### 2.6 Enemy archetypes — each one exists to forbid one strategy

This taxonomy is the whole encounter design. Every type is defined by *the answer it forces*.

| Archetype | Behaviour | Forces the player to… |
|---|---|---|
| **Melee grunt** | rushes, basic combo, dies fast | nothing — this is the punching bag / combo fuel |
| **Ranged (pistol/rifle)** | shoots from distance, chips a lot of health | prioritise targets; keep moving; use web-shoot at range |
| **Rocket launcher** | slow, huge damage, telegraphed | *highest priority target*; forces you to break your combo and cross the arena |
| **Shield** | negates all frontal damage | attack from behind, launch them, or use a shield-breaking move (`Swing Kick` w/ "Bunker Buster") |
| **Brute** | huge HP, blocks normal attacks, must be stunned | use gadgets/environment to open them; slide between the legs; needs 2 Focus bars to finish |
| **Whip / hook** | yanks you out of the air at range | **breaks aerial play** — the anti-juggle enemy; only answer is dodge-counter |
| **Jetpack** | stays airborne, out of melee reach | forces air combat / air-throw (web them, jump, slam) |
| **Heavy armour** | just more HP | pacing — extends encounters without new mechanics |

Design rule extracted: **never introduce two archetypes that demand the same answer.**
A minimal browser roster of **four** (grunt, ranged, shield, brute) already covers
prioritise / reposition / stun, and a fifth (whip) is worth adding purely because it stops
juggling from being a win button.

### 2.7 Gadgets

- Insomniac's gadget wheel is widely considered the weakest part of the combat — the wheel
  only *slows* time rather than pausing it, leaving you vulnerable while choosing, and there
  are no direct shortcuts, so most players "just use the gadget that was equipped when
  combat started."
- **Do not copy this.** Bind 2–4 gadgets to number keys directly, no wheel.
- Good minimal set: **Impact Web** (knockback + stick to surface), **Web Bomb** (AoE cocoon,
  the brute-opener), **Electric Web** (stun, chains), **Trip Mine** (place-and-pull).
- Give each a **charge count (2–4) that refills slowly or on combo milestones** so they are
  tactical rather than spammable.

### 2.8 Encounter shape

- Real bases run ~**6 waves**, with some crimes adding reinforcements. That's too long for a
  browser game — use **2–3 waves of 4–8 enemies**.
- **Escalate archetypes across waves**, don't just add numbers: wave 1 grunts, wave 2 adds
  ranged + shield, wave 3 adds brute.
- Insomniac's stealth layer (perch takedowns, web-pull to ceiling) is cheap to add: an enemy
  in `UNAWARE` state adjacent to no other unaware enemy can be instantly removed. It gives
  the player a real choice at encounter start.
- Skills gating basic moves behind unlocks (Insomniac's three trees) drew criticism for
  narrative dissonance — Spider-Man does moves in cutscenes he "hasn't learned". For a small
  game, **unlock breadth (new verbs), not competence (damage +5%)**.

---

## 3. MISSIONS & OPEN-WORLD LOOP

### 3.1 The real structure (Marvel's Spider-Man, 2018)

**Street crimes** — the spine of the moment-to-moment loop. Types shipped:

- Mugging, Assault (a gang jumps one civilian)
- Robbery / armed store holdup (enter through busted windows, or lure thugs outside)
- Stolen vehicle / car chase
- Hit and run (rescue civilians — *no combat at all*)
- Drug deal, Break-in
- Later factions (Demons, Sable) reskin these with kidnapping and cargo-theft variants and
  different enemy rosters

Delivery mechanics:
- Crimes are surfaced by **activating a district's surveillance tower**, which unfogs the map
  and populates the crime layer. Early on they come via police-radio intel instead.
- Roughly **~5 crimes per faction per district**; near-zero in low-density zones like
  Central Park.
- Crimes **respawn on a cooldown**, and the spawn rate visibly throttles after ~50–60 have
  been cleared — a deliberate anti-grind valve.
- Reward: **2 Crime Tokens** for completing the base objective, **up to 3** with the bonus
  objective ("don't let anyone escape", "finish in 60 s", "no one takes damage").

**Collectibles:**
- **55 Backpacks** — 1 token + a lore memento each. Placed high, so collecting them is
  really a traversal exercise.
- **Landmarks / Photo Ops** — swing to a marked landmark, take a photo, 1 token. Near-zero
  implementation cost and pure traversal reward.
- **Research stations** (skill-check minigames, 2 tokens each), lab projects, pigeons.

**Bases** — the "clear the compound" content: 6 Fisk Hideouts, 5 Demon Warehouses,
4 Sable Outposts, 4 Prisoner Camps, each worth up to 3 tokens (1 completion + 2 bonus
objectives), each running **~6 waves**.

**Token economy** — six separate currencies (Crime, Challenge, Research, Landmark, Backpack,
Base). Suits and gadgets require *specific types and counts*, which forces breadth of
engagement rather than grinding one activity. Widely criticised as "overcomplicated,"
"menial and redundant."

**Skill trees** — three (Innovator 10 skills / Defender 11 / Webslinger 11), 1 point per
level, later nodes cost more points and gate behind a level floor. Criticised because they
lock *basic verbs* Spider-Man visibly performs in cutscenes.

**Districts** — a per-district completion bar fed by towers + backpacks + landmarks + crimes
+ bases. In *Spider-Man 2* (2023) the map grows to **14 districts** with ~160 activities,
and **fast travel per district unlocks at district completion level 2** — travel convenience
is gated on exploration, not story.

### 3.2 What's actually wrong with it (and what to learn)

- The map is a textbook case of **"icon vomit"**: many activities, few distinct
  *experiences*. Progression is gated behind repeating identical crimes.
- The honest minute-to-minute loop is: *swing → an icon pulls you off your line → one of
  three combat arenas → token → resume swinging.* The swinging is the draw; the ground
  content is filler between traversal highs.
- **Players skip fast travel voluntarily.** That is the single most important data point in
  this whole document: **traversal is the reward, not the tax.** Any objective that makes
  the player stand still is spending your best asset.
- *Miles Morales* (2020) is the cited corrective — smaller map, fewer activities, higher
  craft per encounter. Quality over quantity validated commercially and critically.

### 3.3 Open-world design theory worth applying

- **POI density** is the expected number and *variety* of interesting things near any random
  point. Too sparse reads as empty; too dense and players stop evaluating POIs individually
  and just chase dots.
- **BOTW's "40-second rule"** — something interesting should come into view roughly every
  40 seconds of travel. Scale it down for a faster arcade traversal: **20–30 s** at 30 m/s
  cruise means a POI roughly every **600–900 m**, i.e. **every 3–4 city blocks**.
- **Three loop timescales:** micro (seconds — one swing, one attack), meso (minutes — clear
  a crime), macro (a session — district completion). Target a **meso loop of 90–180 s**:
  long enough to feel like a thing, short enough to chain three or four.
- Vary the *silhouette* of icons per category so the minimap reads as a menu of different
  experiences, not a checklist of the same one.

### 3.4 A minimal but satisfying loop for a browser game

Design constraint: no NPC animation budget, no cutscenes, no dialogue. So favour objectives
resolvable with **timers, triggers, waypoints, and physics** — and objectives that *keep the
player swinging*.

Recommended activity set (six types, all cheap):

1. **Checkpoint race** — a course of glowing rings through the skyline, timed, with
   bronze/silver/gold thresholds. **This is the best possible content for this game**: the
   objective *is* the core mechanic, it needs zero AI, and it teaches swing mastery.
   ~45–90 s per course.
2. **Chase the van** — a waypoint-driven vehicle on the street grid; stay within a leash
   radius for N seconds, or land on it. Reuses the car-chase pattern with no combat AI.
3. **Stop N thugs at a marker** — 4–8 capsule enemies, the combat state machine from §2.
   ~60–90 s. This is your only real "stop and fight" content; keep it rare.
4. **Photo / scan objective** — fly to a landmark, hold a key while it is on screen and
   within range. Near-zero cost, pure traversal, perfect density filler.
5. **Beat-the-clock rescue** — a countdown to reach a marker (hostage/bomb analogue).
   Tension from the clock, not from AI. Great for teaching route planning.
6. **Collectible hunt** — tokens placed at *altitude*, on rooftops, spires, and water towers,
   forcing exploration of the map's whole volume rather than its streets.

Structure it as:

- **One unified token currency** (skip the six-currency split entirely).
- **A completion % per district**, ~4–6 districts, fed by all six activity types.
- **Unlocks that add verbs, not stats**: web-zip → point launch → charge jump → air tricks →
  wall-run corner turn → dive. Each unlock changes how you move, which retroactively makes
  every existing race course a new puzzle.
- **Escalating tiers**: district 1 races have wide rings and generous timers; district 4 has
  rings that require a specific release timing.
- **A single always-available "swing anywhere" state** — never lock the player out of
  traversal for a mission.

---

## 4. PROCEDURAL CITY FOR SWINGING (Three.js)

### 4.1 The real Manhattan grid — use these numbers

From the Commissioners' Plan of 1811:

| Element | Imperial | Metric |
|---|---|---|
| Block | 200 ft × 800 ft | **~61 m × ~244 m** (long axis E–W) |
| Numbered street (minor) | 60 ft | **~18 m** |
| Major crosstown street (14th, 23rd, 34th, 42nd, 57th…) | 100 ft | **~30 m** |
| Avenue | 100 ft | **~30 m**, spaced every ~800 ft (~244 m) |
| Sidewalk | 8–12 ft typical | **~3–3.5 m** per side |

Practical generator: a repeating cell of `61 × 244 m` blocks, `18 m` minor streets with
**every 5th street promoted to 30 m**, avenues every ~250 m at 30 m wide. The asymmetry
matters — it produces long straight canyons on one axis and short hops on the other, which
gives the swinging natural rhythm variation instead of uniform mush.

### 4.2 Height distribution

- Real building heights within a city are **heavy-tailed / log-normal**, not normal — many
  short buildings, a long tail of towers. Measured Zipf tail exponents for NYC/London/Tokyo
  land around **μ ≈ 3–4.8** (`P(h) ∝ h^-μ`).
- Easiest correct generator: `height = exp(mu + sigma * gaussian())`.
  - low-rise residential: `mu = ln(15), sigma = 0.30`
  - mid-density: `mu = ln(40), sigma = 0.45`
  - downtown/midtown core: `mu = ln(80), sigma = 0.60` (fat tail reaching 300 m+)
- **Manhattan's skyline is genuinely bimodal** — a Financial District cluster and a Midtown
  cluster with a low stretch between. (The bedrock explanation is a myth; it was economics.)
  Reproduce it with a **two-Gaussian density field**:
  `heightMul(x,z) = max(bump(downtown, r1), bump(midtown, r2)) * (0.6 + 0.4*noise(x,z))`
  with lower flat zones at the map edges. Two "spikes" plus a dip is instantly legible as
  a city rather than a heightfield.

### 4.3 Why height and density matter *for swinging specifically*

This is the coupling that decides whether the game is fun:

- **Building height ≥ 1.5–2× max rope length** in the core swinging districts. With a 90 m
  rope, core buildings want to be **~120–180 m**. That leaves 30–50 % of the rope as ground
  clearance at the bottom of the arc.
- **Street width vs swing excursion.** Horizontal excursion of a swing is roughly
  `2 * L * sin(θmax)`; at L = 60 m and θmax = 60° that's ~104 m. Target **street width
  ≈ 0.5–1.0× excursion** so both sides of the canyon are reachable and graze-able. Real
  18 m streets are *far* narrower than that — which is why you should either widen streets
  (30–50 m) or shorten typical rope length (35–50 m) compared to naive realism.
- **Failure modes:**
  - Buildings too short → the arc drags through the street. Enforce a minimum height near
    traversed streets (`height >= L * 1.2`) *and* implement the web-shortening cheat (§1.5).
  - Gaps wider than ~2×L (parks, plazas, rivers) → no valid anchor, ugly free-fall fallback.
    Mitigate the way Insomniac did: sprinkle **lampposts, water towers, bridges, cranes and
    trees as taggable anchors** in every open area.
- **Bias the whole map denser and taller than reality.** A literal 1:1 NYC makes the outer
  districts unplayable. Every Spider-Man game inflates density; do the same.
- Deliberately author **district personalities** (Insomniac did): a tall Financial-District
  analogue for wide sweeping swings, a low Hell's-Kitchen analogue that forces tight
  grid-following, and a park with tree/lamppost anchors. Traversal variety comes from the
  *city*, not from new moves.

### 4.4 Three.js performance

- **`THREE.InstancedMesh` is the whole ballgame.** One geometry + material, N transforms via
  `setMatrixAt(i, m)` then `instanceMatrix.needsUpdate = true`. Practically **tens of
  thousands to ~100 k instances in one draw call**. Real-world reports of converting a scene
  to instancing: **~9,000 draw calls → ~300**.
  - Initialise unused slots with a **zero-scale matrix**, or you get stray unit cubes at the
    origin.
  - Use a handful of **kits** (box tower, setback tower, brownstone, warehouse) rather than
    unique geometry per building; vary appearance with `instanceColor` and an atlas UV
    offset.
- **Bucket instances per city block** into one InstancedMesh per ~250 m tile so frustum
  culling (which is per-Object3D, using a bounding sphere) can cull whole blocks. A single
  city-wide InstancedMesh is culled as one object and never culls.
- **`BufferGeometryUtils.mergeGeometries()`** (renamed from `mergeBufferGeometries` in r151+)
  for *static, non-repeating* geometry — ground plane, curbs, one-off landmarks. Loses
  per-object culling within the blob, so only merge things that are always visible or always
  local.
- **LOD** via `THREE.LOD` per block cluster:
  - `< 250 m`: full geometry + window texture
  - `250–600 m`: simplified box with baked low-res facade
  - `> 600 m`: billboard impostor or nothing (fog covers it)
- **Fake windows in the shader, never in geometry.** A tiling texture with
  `wrapS/wrapT = RepeatWrapping` and `repeat.set(nx, ny)` driven by floor count is cheap;
  for night, threshold a hash-noise per grid cell in the fragment shader to light random
  windows. (`Three Fenestra` is a good reference for going further — interior mapping that
  fakes 3D rooms behind flat window planes.)
- **Budgets for a comfortable 60 fps desktop browser:** aim for **< ~100 draw calls** and
  **~100 k–300 k visible triangles** per frame (mobile: 20–50 calls, < 100 k tris). With
  instancing, draw calls stop being the constraint and **overdraw/fill-rate** becomes the
  bottleneck — watch transparent glass facades and stacked emissive layers.

### 4.5 Fog

- `THREE.Fog(color, near, far)` — linear, predictable, best when you want a hard-ish cutoff.
- `THREE.FogExp2(color, density)` — `exp(-(density*d)²)`, softer; **density 0.005–0.03** for
  a city at metre scale.
- **Match `fog.color` to the sky/clear colour exactly.** Mismatch is the #1 cause of "my
  draw distance looks like a grey wall."
- The point of fog is leverage: pick `far` around **600–1000 m**, do LOD swaps well inside
  that (250–600 m), skip spawning full-detail buildings beyond, and let fog hide the seam.
  For a swinging game this also does aesthetic work — atmospheric perspective on distant
  towers is most of what makes a skyline read as huge.

### 4.6 Collision

- **AABBs (`THREE.Box3`) per building are entirely sufficient.** At gameplay speed the player
  only ever touches flat walls, roofs and ledges; cornices and window ridges are irrelevant
  to physics. Since your city is axis-aligned by construction, you don't even need OBBs.
- **Spatial hash / uniform grid for broadphase.** Bucket each AABB into cells sized ~1 city
  block (60–250 m); each frame test only the player's cell + 8 neighbours. Turns collision
  from O(n) over the whole city into effectively O(1). Reference implementation:
  `three-spatial-hash-grid`.
- **Raycast against the proxy AABB set, never the render meshes.** Keeps web-anchor raycast
  cost flat regardless of visual fidelity, and lets you tag proxies `swingable` /
  `not swingable` independently of appearance. A hand-rolled ray-vs-AABB slab test over the
  ~20 boxes in the local grid cells is far faster than `THREE.Raycaster` over the scene.

### 4.7 Open-source references worth scavenging

`jeromeetienne/threex.proceduralcity` (minimal, based on mrdoob's city demo) ·
`jason9075/city-pcg` (seeded, Vite) · `jstrait/city-tour` · `photonlines/Procedural-City-Generator`
(Perlin-driven block allocation) · `Rototu/procedural-skyscraper-city-generator-and-shader`.

---

## 5. CONTROLS

### 5.1 Reference: Marvel's Spider-Man 2 (2023) gamepad

| Action | Button |
|---|---|
| **Swing / Parkour** | **hold R2** |
| Wall run | hold R2 near/on a wall |
| Zip to point | **L2 + R2** |
| Web Zip (airborne) | **Cross (X)** |
| Jump | Cross |
| Dive / Perch | **L3** |
| Air tricks | hold **Square** + left stick direction |
| Attack | Square |
| Web-Strike / Web Wings | Triangle |
| Dodge | **Circle** |
| Parry (tap) / Ability (hold) | **L1** |
| Web-Shooter (tap) / Gadget (hold) | **R1** |
| Yank & throw environment object | hold L1 + R1 |
| Finisher | Triangle + Circle |
| Aim | L2 |
| Scan / show objective | R3 |

(2018 differs slightly: no parry, gadget cycling on L1, dive on tap-L3, swing-cornering on
Circle mid-swing.)

**The idiom to steal:** *swing is a hold, not a tap.* Jump off a ledge, **hold** through the
pendulum arc, **release at the peak** to convert speed into height, re-press to re-attach.
That press-hold-release rhythm is the entire feel of traversal and should be the first thing
your input state machine models, independent of which key it is bound to.

### 5.2 Recommended keyboard + mouse for a browser game

The official *Spider-Man Remastered* PC port maps swing to **hold Left Shift**, with an
optional toggle mode — and reception is mixed, with players noting it feels less immediate
than a trigger, and that toggle mode **destroys the release-timing skill**.

Recommended scheme (keeps the mouse doing camera + aim, puts the main verb on the button
players already expect to be the main verb):

| Key | Action |
|---|---|
| **WASD** | steer / air-control / ground movement |
| **Mouse move** | camera (pointer lock) |
| **Hold Left Mouse** | **swing** (fire web, hold through arc, release to let go) |
| **Space** | jump; **hold** = charge jump; tap at swing apex = release boost |
| **Hold Right Mouse** | web-zip / point launch toward the aimed anchor |
| **Shift** | sprint on ground / **dive** in air |
| **Ctrl** or **S in air** | dive-bomb alternative |
| **F** | attack (keep combat off LMB so it never fights with swing) |
| **Q** | dodge |
| **E** | interact / web-strike |
| **1–4** | gadgets (direct binds — no radial wheel, see §2.7) |
| **R** | heal (spend Focus) |
| **Tab** | map |
| **Esc** | pause (browser will exit pointer lock anyway) |

Notes:
- If you must overload LMB, make it *swing while airborne, attack while grounded* — that
  disambiguation is unambiguous in practice.
- Support **gamepad in parallel** through an action abstraction layer
  (`Input.swing`, `Input.jump`, …) fed by whichever device last produced input. Never branch
  on "R2 or Shift" inside gameplay code.

### 5.3 Browser-specific gotchas

- **Pointer Lock:** `canvas.requestPointerLock()` must be called from inside a user-gesture
  handler; a naked auto-call is rejected. Read `movementX`/`movementY` from `mousemove`
  (not `clientX/Y`) for unbounded relative look. Listen for `pointerlockchange` /
  `pointerlockerror`. **Esc always exits and cannot be overridden** — auto-pause on lock
  loss instead of fighting it.
- **`preventDefault()` on Space** or the page scrolls / a focused button re-fires.
- **`canvas.addEventListener('contextmenu', e => e.preventDefault())`** is mandatory if you
  bind anything to right mouse, or players get a menu mid-swing.
- **Gamepad API is poll-only.** No `onbuttondown`; call `navigator.getGamepads()` every
  `requestAnimationFrame` and diff state yourself. A prior user gesture is required before
  gamepads are visible to the page; use the `gamepadconnected` event rather than assuming
  `getGamepads()` is populated at load.
- **Input buffering of 100–150 ms** matters more here than on console, because rAF timing,
  tab backgrounding and GC pauses make browser frame delivery less consistent. Buffer jump,
  swing-attach and dodge. (Per action-combat practice: **6–8 frames** for attacks,
  **3–4 frames** for dodge.)
- **Fixed-timestep physics with an accumulator**, decoupled from rAF, or swings will differ
  between a 60 Hz and a 144 Hz display.

---

## KEY TAKEAWAYS — IMPLEMENT THIS

A programmer can build the whole thing from this list.

**Swinging (build this first, spend 50 % of your time here)**

1. Web = **rigid distance constraint**, never a spring. Integrate freely, then project the
   position back onto the sphere of radius `tetherLength` around the anchor, then re-derive
   velocity as `(newPos - oldPos)/dt`. Fixed timestep 1/60 s, 2 substeps.
2. **Gravity −30 m/s²** (≈3× real). Cruise speed ~30 m/s, soft cap horizontal at **45 m/s**
   (scale excess by 0.9/frame), leave vertical uncapped so dives are dangerous.
3. **Anchor selection is the steering.** Fan-cast rays from `playerPos + up*6 + fwd*4`, at
   pitches 30/45/60/75° and yaw offsets ±20°, with `MAX_STEER_ANGLE ≈ 55°` applied from the
   steer input. Ideal pitch ~60°. Bias scoring toward roof edges. **Side anchor = turn;
   vertical anchor = go straight.** Do not add a separate turn force.
4. **Auto-aim cone ±20° h / ±25° v**, widening to ±45° on a failed first pass.
5. Implement the five cheats: **shorten the rope near the ground** (clearance 3 m, shorten
   at 25 m/s), **auto wall-run instead of crashing**, **forward-momentum auto-correct**,
   **never wrap the line on corners**, **no fall damage**.
6. **Release = jump.** On release while rising, add **+7 m/s along velocity, +3 m/s up**.
   Never damp velocity on any state transition — momentum preservation is the whole game.
7. Wire every assist into a single **`assist ∈ [0,1]` scalar** and expose it as a 0–10
   slider (default 10, like Insomniac). It is an accessibility feature *and* a difficulty
   axis for free.
8. Moveset beyond the swing: **web-zip** (+18 m/s, 60 m, 0.4 s cd), **point launch**
   (+25 m/s fwd, +12 m/s up), **charge jump** (0.8 s → 22 up / 12 fwd), **dive**
   (+18 m/s² down), **wall-run**, **air tricks** (cosmetic, feeds Focus/XP).

**Camera & feedback (this is not polish, it is half the feel)**

9. `fov = lerp(70, 98, clamp01((speed-15)/30))`, smoothed over 0.25 s; **+5° kick for
   0.15 s on every web attach** (dolly-zoom "heartbeat"). Follow distance 6→9 m over the
   same range. Camera on a critically-damped spring, `smoothTime 0.12 s`. Pitch tracks the
   pendulum tangent. ±6° roll into the swing. Player off-centre 0.35.
10. Wind gain + lowpass cutoff driven by speed; two distinct web sounds (thwip on fire,
    thunk on attach) with ±10 % random pitch; speed-line vignette above 35 m/s; web line
    fired over ~60 ms with a slack catenary that straightens under tension.

**Combat**

11. **Every animation cancels into dodge.** Finishers are the only exception, and enemies
    are suppressed during them.
12. Timing at 60 fps: telegraph 24 f white → **perfect window 12 f red** → late 6 f →
    impact. Dodge = 18 f i-frames + 8 f recovery. Perfect dodge → 0.35 s at timeScale 0.35
    plus a 45 f counter window. "Increased" assist widens the perfect window to 20 f.
13. Attack phases **6 f startup / 4 f active / 10 f recovery**, chainable from recovery
    frame 3 (IASA). **Hitstop 4–6 f** on hit, 8–10 on launchers. Attacks lunge up to 3 m
    toward a target in a ±60°/5 m cone, re-targeting every attack. Juggled enemies get
    0.35× gravity, capped at ~8 consecutive hits. Combo decays after 2.5 s idle, resets on
    being hit.
14. **Focus**: 3 bars, built by hits/combos/perfect dodges; spent on **heal (1 bar)** or
    **finisher (1 bar; 2 for brutes)**. That tension is the meta-game.
15. **Four to five enemy archetypes, each forbidding one strategy**: grunt (fuel), ranged
    (prioritise), shield (reposition), brute (stun/gadget), whip (anti-juggle). Never ship
    two archetypes with the same answer.
16. Gadgets on **number keys, not a wheel** — the wheel is Insomniac's most-criticised
    system. 2–4 gadgets, 2–4 charges each.

**Open world**

17. **Traversal is the reward.** Players skip fast travel in the real games. Never build an
    objective that makes them stand still for long, and never lock them out of swinging.
18. Ship **six cheap activity types**: checkpoint races (best value by far — the objective
    *is* the mechanic), van chases, small enemy clusters, photo/scan, beat-the-clock
    rescues, altitude collectibles. **Meso loop 90–180 s.** A POI every **3–4 blocks
    (600–900 m)**, i.e. one every 20–30 s at cruise speed.
19. **One token currency**, not six. **4–6 districts** with a completion %. Unlocks add
    **verbs, not stats** — each new move retroactively re-opens every existing race course.

**City**

20. Grid: **61 × 244 m blocks**, **18 m** minor streets (every 5th promoted to **30 m**),
    **30 m** avenues every ~250 m. Widen streets or shorten ropes so that
    **street width ≈ 0.5–1.0 × (2·L·sin 60°)**.
21. Heights: **log-normal** `exp(mu + sigma*gaussian())`, `mu = ln(80), sigma = 0.6` in the
    core; modulate by a **two-Gaussian (downtown + midtown) field** with a dip between and
    low edges. **Core buildings ≥ 1.5–2× rope length.** Bias denser and taller than reality.
    Scatter lampposts/water towers/trees as anchors in every gap wider than 2×L.
22. Rendering: a few **InstancedMesh kits bucketed per ~250 m block** (so blocks cull),
    `THREE.LOD` at 250 m / 600 m, fake windows in the shader, `Fog` (or `FogExp2`,
    density 0.005–0.03) with `far ≈ 600–1000 m` and **fog colour == sky colour**. Budget
    **< 100 draw calls, 100–300 k tris**.
23. Collision: **Box3 AABBs in a uniform spatial hash** (cell ≈ one block), hand-rolled
    ray-vs-AABB slab tests against the local 9 cells only. Never raycast render meshes.

**Controls**

24. **Hold Left Mouse to swing**, Space to jump/boost-release, Right Mouse to zip, Shift to
    dive, WASD to steer, F to attack, Q to dodge, 1–4 gadgets. Hold, never toggle — the
    release timing *is* the skill.
25. Pointer lock from a user gesture, `preventDefault` on Space, kill the context menu,
    poll the Gamepad API every frame behind an action-abstraction layer, buffer inputs
    100–150 ms, and run physics on a fixed-timestep accumulator.

---

## SOURCES

**Web-swinging / traversal**
- Jamie Fristrom, ["Swinging Physics for Player Movement (As Seen in Spider-Man 2 and Energy Hook)"](https://code.tutsplus.com/swinging-physics-for-player-movement-as-seen-in-spider-man-2-and-energy-hook--gamedev-8782t) — the tether-constraint code
- GDC 2019, ["Classic Game Design Postmortem: Swinging with Spider-Man"](https://www.youtube.com/watch?v=5T1hnau158M) (Jamie Fristrom) / [Game Developer writeup](https://www.gamedeveloper.com/design/video-designing-i-spider-man-2-i-s-classic-web-swinging-mechanic)
- GDC 2019, ["Concrete Jungle Gym: Building Traversal in Marvel's Spider-Man"](https://www.youtube.com/watch?v=OEaGEaCUq3g) (Doug Sheahan, Insomniac) / [GDC Vault](https://www.gdcvault.com/play/1026422/Concrete-Jungle-Gym-Building-Traversal)
- Game Developer, ["Don't mean a thing if you ain't got that swing… in Spider-Man"](https://www.gamedeveloper.com/design/don-t-mean-a-thing-if-you-ain-t-got-that-swing-in-i-spider-man-i-) — swing-steering quote, point launch, camera
- Game Developer, ["Making Insomniac's Spider-Man do what a spider can"](https://www.gamedeveloper.com/design/making-insomniac-s-i-spider-man-i-do-what-a-spider-can) — release points, custom hero states, district design
- [Variety: Insomniac on the tech behind Spider-Man's swing](https://variety.com/2018/gaming/news/spider-man-tech-insomniac-interview-1202930094/)
- [PlayStation Lifestyle: how Insomniac perfected web-swinging](https://www.playstationlifestyle.net/2018/09/05/marvels-spiderman-ps4-web-swinging-perfection-broken-down-by-insomniac-team/)
- [Screen Rant: Marvel's Spider-Man web-slinging compared to Spider-Man 2](https://screenrant.com/marvels-spider-man-2-web-slinging-mechanics-physics/)
- [J.B. Siraudin, "The almost unintentional dolly of Insomniac's Spidercam"](https://jbsiraudin.github.io/blog/spiderman-dolly) — FOV/dolly formula
- [Insomniac support: Spider-Man 2 accessibility options](https://support.insomniac.games/hc/en-us/articles/46730041467027-What-Accessibility-options-does-Marvel-s-Spider-Man-2-feature)
- [Destructoid: Swing Steering Assistance slider in Spider-Man 2](https://www.destructoid.com/psa-theres-a-swing-steering-assistance-slider-in-spider-man-2/) · [GamesRadar on adjustable swing assist + fall damage](https://www.gamesradar.com/marvels-spider-man-2-has-adjustable-swing-assist-as-well-as-fall-damage-so-you-can-really-put-peter-and-miles-through-their-paces/)
- [Swing speed measurements (~28–30 m/s)](https://howstrongis.fandom.com/wiki/User_blog:HowStrongIs/Spider-Man_Goes_Swinging_(Insomniac's_Spider-Man))
- [smallnightlight: dynamic swinging mechanic in Unity](https://smallnightlight.github.io/Pages/Page3/SwingingMovement.html) · [toqoz.fyi: Verlet rope in games](https://toqoz.fyi/game-rope.html)

**Combat**
- [Game Developer: Marvel's Spider-Man Design Analysis](https://www.gamedeveloper.com/design/marvel-s-spider-man-design-analysis) — dodge-cancel rule, gadget-wheel critique, physics cheats
- [Arkham City Wiki: Freeflow Combat](https://arkhamcity.fandom.com/wiki/Freeflow_Combat) · [Game Developer: Batman Arkham Design Analysis](https://www.gamedeveloper.com/design/batman-arkham-design-analysis-part-1-)
- [Game8: How to Dodge](https://game8.co/games/Marvels-Spider-Man-2/archives/430255) · [How to Parry](https://game8.co/games/Marvels-Spider-Man-2/archives/430383) · [Dualshockers dodge & parry guide](https://www.dualshockers.com/spider-man-2-dodge-parry-guide/)
- [Marvel's Spider-Man Wiki: Focus](https://marvels-spider-man.fandom.com/wiki/Focus) · [gamepressure: Focus](https://guides.gamepressure.com/marvels-spider-man/guide.asp?ID=46212)
- [gamepressure: Enemies](https://guides.gamepressure.com/marvels-spider-man/guide.asp?ID=46213) · [SegmentNext combat guide](https://segmentnext.com/2018/09/07/marvels-spiderman-ps4-combat-guide)
- [StrategyWiki: Marvel's Spider-Man Skills](https://strategywiki.org/wiki/Marvel's_Spider-Man/Skills) · [TheSixthAxis: Spider-Man 2 all skills](https://www.thesixthaxis.com/2023/10/20/marvels-spider-man-2-all-skills-and-upgrades-guide/)
- [Input buffering, action canceling and forbidden knowledge](https://medium.com/@yosispring/input-buffering-action-canceling-and-also-forbidden-knowledge-47a3f8a95151) · [Jason de Heras, The Art of Melee Combat Design](https://www.jasondeheras.com/gamedesign/2021/2/11/meleecombatdesign)

**Open world**
- [GameFAQs: Marvel's Spider-Man side missions](https://gamefaqs.gamespot.com/ps4/191635-marvels-spider-man/faqs/76396/side-missions) · [Game8 crime tokens](https://game8.co/games/Marvels-Spider-Man/archives/383384) · [backpacks](https://game8.co/games/Marvels-Spider-Man/archives/383031) · [landmarks](https://game8.co/games/Marvels-Spider-Man/archives/383507) · [bases](https://game8.co/games/Marvels-Spider-Man/archives/383198)
- [Marvel's Spider-Man Wiki: resources](https://marvels-spider-man.fandom.com/wiki/Marvel's_Spider-Man_resources) · [Taskmaster Challenges](https://marvels-spider-man.fandom.com/wiki/Taskmaster_Challenges)
- [GameSpot: Spider-Man 2's revamped map and activities system](https://www.gamespot.com/articles/the-open-world-in-spider-man-2-features-a-revamped-map-and-a-new-activities-system/1100-6517752/) · [Game8: fast travel](https://game8.co/games/Marvels-Spider-Man-2/archives/429757)
- [GameRant: why Miles Morales' open world works better](https://gamerant.com/spider-man-miles-morales-open-world-good/) · [ResetEra: Spider-Man side content critique](https://www.resetera.com/threads/marvels-spider-man-side-content-is-terrible.616911/)
- [Game Design Skills: open world design](https://gamedesignskills.com/game-design/open-world/) · [core loops](https://gamedesignskills.com/game-design/core-loops-in-gameplay/) · [Joel Burgess, GDC 2011 on POI density](http://blog.joelburgess.com/2011/03/gdc-2011-transcript-motivating-players.html)

**City / Three.js**
- [Commissioners' Plan of 1811](https://en.wikipedia.org/wiki/Commissioners%27_Plan_of_1811) · [The Greatest Grid, MCNY](https://thegreatestgrid.mcny.org/greatest-grid/making-the-plan/12) · [NYCdata: The Grid](https://www.baruch.cuny.edu/nycdata/infrastructure/the_grid.html) · [NACTO sidewalk zones](https://nacto.org/publication/urban-street-design-guide/street-design-elements/sidewalks/sidewalk-zones/)
- ["Urban Skylines: building heights and shapes as measures of city size" (arXiv:1512.00946)](https://arxiv.org/pdf/1512.00946)
- [buildingtheskyline.org: The Bedrock Myth and the Rise of Midtown Manhattan](https://buildingtheskyline.org/bedrock-and-midtown-i/) · [Rutgers Newark: why there's a gap in the Manhattan skyline](https://www.newark.rutgers.edu/news/why-there-gap-manhattan-skyline-dont-blame-bedrock-its-location-location-location)
- [three.js InstancedMesh docs](https://threejs.org/docs/pages/InstancedMesh.html) · [BufferGeometryUtils](https://threejs.org/docs/pages/module-BufferGeometryUtils.html) · [Fog](https://threejs.org/docs/#api/en/scenes/Fog)
- [Codrops: Three.js instances](https://tympanus.net/codrops/2025/07/10/three-js-instances-rendering-multiple-objects-simultaneously/) · [R3F: scaling performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance) · [100 Three.js performance tips](https://www.utsubo.com/blog/threejs-best-practices-100-tips)
- [MDN: bounding volume collision detection with three.js](https://developer.mozilla.org/en-US/docs/Games/Techniques/3D_collision_detection/Bounding_volume_collision_detection_with_THREE.js) · [three-spatial-hash-grid](https://github.com/andrewisen-tikab/three-spatial-hash-grid)
- [threex.proceduralcity](https://github.com/jeromeetienne/threex.proceduralcity) · [city-pcg](https://github.com/jason9075/city-pcg) · [city-tour](https://github.com/jstrait/city-tour) · [Procedural-City-Generator](https://github.com/photonlines/Procedural-City-Generator) · [Three Fenestra](https://three-fenestra.codedgar.com/)

**Controls**
- [StrategyWiki: Marvel's Spider-Man 2 Controls](https://strategywiki.org/wiki/Marvel's_Spider-Man_2/Controls) · [Prima Games: Spider-Man 2 controls listed](https://primagames.com/tips/spider-man-2-controls-listed) · [Fandom: Marvel's Spider-Man controls](https://marvels-spider-man.fandom.com/wiki/Marvel's_Spider-Man_controls)
- [MDN: requestPointerLock](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestPointerLock) · [web.dev: pointer lock and FPS controls](https://web.dev/articles/pointerlock-intro)
- [MDN: Gamepad](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad) · [Smashing Magazine: using the Gamepad API in web games](https://www.smashingmagazine.com/2015/11/gamepad-api-in-web-games/)
