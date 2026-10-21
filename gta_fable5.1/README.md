# Fable City — a GTA-style open world in the browser

A Grand Theft Auto–inspired sandbox built with **Three.js** and plain ES modules. Everything is procedural: the city,
the cars, the people, the textures, the music and the sound effects are generated in code — there are no asset files.

## Run it

```bash
npm install
npm run dev        # http://localhost:5175
```

`npm run build` produces a static bundle in `dist/` (serve it with any static server).

Add `?debug` to the URL to run without pointer lock (handy for automation / testing).

## Controls

| Action | Keys |
|---|---|
| Move / sprint / jump | `WASD` · `Shift` · `Space` |
| Look | Mouse |
| Enter / exit / steal a car | `F` (occupied cars get carjacked) |
| Drive | `W` gas · `S` brake / reverse · `A` `D` steer · `Space` handbrake · `H` horn · `R` radio |
| Fire / aim | `LMB` · hold `RMB` for the over-shoulder lock-on aim |
| Weapons | `1`–`6`, `Q`, mouse wheel |
| Talk / shop | `E` near a person or a shop counter |
| Map · skip time · ambient occlusion · help | `M` · `T` · `O` · `F1` |

## What's in the city

- **Fable City**: a 9×9-block island with Downtown towers, Midtown, the Ironworks docks, Palm Heights beach, Oakvale and
  the gang-run Eastside. Roads with lanes, crosswalks, working traffic lights, parks, parking lots, street clutter, ocean.
- **Traffic & pedestrians** that follow lanes, stop at lights, honk, flee from gunfire, cross at corners, and get carjacked.
- **Arcade driving**: speed-sensitive steering, lateral grip & handbrake drifts, skid marks, damage, smoke, fire, explosions,
  headlights at night, procedural radio with three stations.
- **Wanted system (1–5 stars)** with cruisers that route through the streets, ram you, shoot at 2+ stars, get out and
  chase you on foot, arrest you if you stand still. Stars decay when you break line of sight. Pay 'n' Spray clears heat.
- **Combat**: fists, pistol, Uzi, shotgun, rifle, RPG. Lock-on aiming, headshots (2.5×), hit-markers, ragdoll-ish deaths,
  drive-bys, armed gangs that return fire, explosive red barrels.
- **Stores you can walk into**: Ammu-Nation (guns, ammo, armor), Burger Shot (health), Threads (outfits) — with clerks
  you can talk to — and a drive-through Pay 'n' Spray.
- **Missions** from glowing markers: Street Race, Taxi Fares, The Contract, Hot Wheels, Vigilante.
- **Presentation**: day/night cycle with sun, moon, stars, twilight; lit windows and neon at night; bloom, ambient
  occlusion (N8AO), tone mapping, camera shake, WASTED / BUSTED screens, rotating radar minimap, full map, area names.

See `DESIGN.md` for the mechanics notes that shaped the feel.
