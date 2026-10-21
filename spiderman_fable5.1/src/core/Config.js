// Central tunables. Units: metres, seconds. Character is ~1.8 m tall.
// Numbers follow docs/RESEARCH.md (Insomniac / Spider-Man 2 (2004) breakdowns).
export const CFG = {
  gravity: 30,               // ≈3× earth — arcade feel, snappier arcs
  terminalVel: 95,           // vertical is effectively uncapped so dives matter
  fixedDt: 1 / 120,          // physics substep
  assist: 1.0,               // 0–1 swing assist scalar (virtual anchors, steer help, wider auto-aim)

  // Ground
  runSpeed: 11,
  sprintSpeed: 18,
  groundAccel: 60,
  groundFriction: 12,
  jumpVel: 14,
  chargeJump: { time: 0.7, up: 22, fwd: 12 },
  airControl: 14,
  airDrag: 0.012,
  diveAccel: 18,             // extra downward accel while diving

  // Swinging
  swing: {
    maxAttachDist: 80,
    maxRope: 50,             // longer ropes bottom out in the street
    minAnchorDist: 14,       // shorter ropes whip
    startKick: 16,           // minimum forward speed when a swing starts
    wallOffset: 3,           // physics anchor distance off the wall (web line still draws to the wall)
    lateralDamp: 1.4,        // swing-steering assist: bleeds sideways velocity (×assist)
    minAttachHeight: 6,
    idealRopeLen: 30,
    minRopeLen: 7,
    castOriginUp: 6, castOriginFwd: 4,
    pitches: [0.52, 0.785, 1.05, 1.31],   // 30/45/60/75°
    yawOffsets: [0, 0.35, -0.35, 0.7],    // ±20° auto-aim cone, plus a wider cast on the preferred side
    sideBias: 0.35,           // anchors alternate sides by this yaw (rad) — the natural zig-zag
    maxSteer: 0.96,          // A/D shifts the anchor by up to 55°: side anchor = turn
    steerForce: 10,          // small mid-swing lateral help (scaled by assist)
    pumpForce: 12,           // W thrust on the down-swing
    reelSpeed: 6,
    releaseAlong: 7, releaseUp: 3,        // additive boost on release while rising
    hCap: 45, hCapDamp: 0.9,              // soft cap horizontal speed
    drag: 0.0025,
    groundClearance: 3,      // shorten rope so the arc never dips below this
    attachFovKick: 5,
  },

  // Zip / point launch
  zip: { speed: 44, maxDist: 150, minDist: 4, launchFwd: 25, launchUp: 12, cooldown: 0.12 },

  // Wall
  wall: { climbSpeed: 9, jumpOff: 12, jumpUp: 10, runGravity: 0.55, runGravityHeld: 0.3, minRunFromGround: 10 },

  // Camera
  cam: { dist: 6, distFast: 9, height: 1.6, fov: 70, fovFast: 98, speedLo: 15, speedHi: 45, sens: 0.0022, smooth: 0.12 },

  // Combat (seconds; research gives frames @60)
  combat: {
    maxHealth: 100,
    attackRange: 3.0, lungeRange: 5.5, lungeCone: 1.05,
    attack: { startup: 0.1, active: 0.07, recovery: 0.17, chainFrom: 0.05 },
    hitstop: 0.07, hitstopHeavy: 0.14,
    comboWindow: 0.75, comboDecay: 2.5,
    hitDamage: [12, 12, 15, 30],
    dodge: { time: 0.3, recovery: 0.13, speed: 22, iframes: 0.3 },
    telegraph: 0.4, perfectWindow: 0.2, lateWindow: 0.1,
    perfectSlow: { time: 0.35, scale: 0.35 },
    juggleGravity: 0.35,
    focusBars: 3, focusPerBar: 100,
    focusPerHit: 9, focusPerfectDodge: 35, focusFinisherCost: 100, focusHealCost: 100, healAmount: 50,
  },
};
