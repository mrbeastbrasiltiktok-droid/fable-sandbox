export const FIXED_DT = 1 / 60;
export const RACER_COUNT = 8;
export const DEFAULT_LAPS = 3;
export const CC_CLASSES = { 50: 0.74, 100: 0.87, 150: 1.0 };
export const MAX_COINS = 10;
export const COIN_SPEED_BONUS = 0.006; // per coin, multiplicative on top speed

// Drift / mini-turbo (units per second; MK8 uses 5/frame tight, 2/frame loose at 60fps)
export const DRIFT_CHARGE_TIGHT = 300;
export const DRIFT_CHARGE_LOOSE = 160;
export const DRIFT_TIGHT_INPUT = 0.35; // steering into the drift at least this much counts as a tight charge
export const DRIFT_TIERS = [
  { charge: 240, name: 'mini', color: 0x4ec9ff, duration: 0.62, mult: 1.18 },
  { charge: 520, name: 'super', color: 0xffa02e, duration: 1.67, mult: 1.22 },
  { charge: 860, name: 'ultra', color: 0xff4bf0, duration: 2.63, mult: 1.26 },
];
export const DRIFT_MIN_SPEED = 7;

export const BOOSTS = {
  mushroom: { mult: 1.45, duration: 0.95 },
  golden: { mult: 1.45, duration: 0.55 },
  pad: { mult: 1.38, duration: 1.3 },
  star: { mult: 1.28, duration: 7.5 },
  bullet: { mult: 1.95, duration: 5.5 },
  trick: { mult: 1.18, duration: 0.9 },
  slipstream: { mult: 1.2, duration: 1.0 },
};

export const OFFROAD_SPEED = 0.55;
export const ICE_TRACTION = 1.6;
export const POINTS_TABLE = [15, 12, 10, 9, 8, 7, 6, 5];
