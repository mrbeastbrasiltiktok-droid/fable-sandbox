# Design notes — what makes it feel like GTA

Research + implementation notes. Numbers refer to the actual constants in `src/`.

## Camera
- On foot: orbit cam 4.2 m back, 1.6 m up, exponential damping (λ≈18). Recentres behind the player only after 1.6 s of
  mouse idle while moving, so it never fights the player.
- In a car: yaw chases a blend of heading and velocity direction (more velocity-weighted at speed), boom distance
  6.2→8.4 m and FOV 62→78° with speed, camera collision pulls in against buildings.
- Aim: over the right shoulder (side 1.05 m, 2.4 m back, FOV 50), soft lock-on snaps to the closest target inside a
  20° cone and then tracks gently unless the mouse is moving.

## Cars (`vehicle.js`)
- Bicycle-model yaw from a steering angle that falls off with speed (`0.35 + 0.65 / (1 + (v/16)^1.5)`).
- Lateral velocity decays by a grip factor; handbrake cuts grip to 22% and boosts yaw → drifts.
- Brake key = brake while rolling forward, reverse once stopped (reverse capped at 35% of top speed).
- Mild drag (`0.04 + 0.0015·v` per second) so sedans reach ~115 km/h, sports cars ~150, cruisers ~135.
- Damage → smoke < 55 hp, fire < 25 hp, explosion 3.5 s later; crashes shake the camera and crunch (WebAudio noise).

## Wanted level (`police.js`)
- Crimes add "heat": hit ped 0.34, kill 0.8, carjack 0.5, gunfire 0.34, attack cop 1.0, kill cop 1.5, explosion 1.0.
  Minor crimes have a chance of going unnoticed unless a cop is within 80 m.
- Cop cars per star: 1 / 2 / 4 / 6 / 8. Far away they route through the road grid toward you (ignoring lights,
  overtaking traffic); inside 70 m with line of sight they switch to direct pursuit and ram.
- On foot within 12 m, cops leave the car and chase (6.6 m/s); standing still next to one for 0.9 s = BUSTED.
  From 2 stars they shoot; from 3 stars they drive-by.
- Stars drop after 25/40/60/90/120 s without a cop within 70 m. Pay 'n' Spray clears everything for $100.

## Traffic & peds (`traffic.js`, `peds.js`)
- Lane graph is implicit from the grid: cars target the next intersection's stop line, then a bezier through the
  junction to the exit lane. Traffic lights cycle 16 s per intersection with a per-junction phase offset.
- Car-following uses a braking-distance model; peds in the lane stop cars and trigger honks.
- Peds walk block perimeters, cross at corners, wait for cars, flee gunfire, get knocked down by cars, talk when asked.
- Eastside/Ironworks spawn gang members; hurting one alerts the crew within 40 m and they shoot back.

## Missions (`missions.js`)
Checkpoint race, chained taxi fares with time bonus, assassination target that runs, steal-and-deliver with a
condition bonus, vigilante waves in a cruiser. All share objective text, timer, blips and PASSED/FAILED banners.

## Ambience
- 8-minute day; sun/moon/stars sky shader, warm dusk, emissive windows and neon at night, lamp glow sprites, headlights.
- Sound is 100% synthesised: engine (saw+square through a low-pass driven by RPM), skids, sirens, gunshots, explosions,
  horns, pickups, and a step-sequencer radio (synthwave / hip-hop / house).
