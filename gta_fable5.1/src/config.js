// Central tuning constants for the whole game.
export const CITY = {
  BLOCKS: 9,            // blocks per side
  BLOCK: 60,            // building block size (m)
  ROAD: 20,             // total road corridor width incl. sidewalks (m)
  ASPHALT: 14,          // driveable asphalt width (m) -> 4 lanes of 3.5
  SIDEWALK: 3,          // sidewalk width each side (m)
  LANE: 3.5,
  CURB: 0.15,
  ISLAND_MARGIN: 70,    // land beyond outer roads before beach
  BEACH: 30,
};
CITY.PITCH = CITY.BLOCK + CITY.ROAD;                 // 80m from road centre to road centre
CITY.HALF = (CITY.BLOCKS * CITY.PITCH) / 2;          // half-extent of road grid (360)
CITY.LAND = CITY.HALF + CITY.ISLAND_MARGIN;          // land edge (430)
CITY.WATER = CITY.LAND + CITY.BEACH;                 // where water begins (460)

export const PLAYER = {
  WALK: 3.2, RUN: 7.5, SPRINT: 10.5, ACCEL: 30, JUMP: 6.5, GRAVITY: 22,
  RADIUS: 0.4, HEIGHT: 1.8, MAX_HEALTH: 100, MAX_ARMOR: 100, SWIM: 2.5,
};

export const WANTED = {
  MAX: 5,
  DECAY_TIME: [0, 25, 40, 60, 90, 120], // seconds without crime & out of sight to drop a star
  COPS_PER_LEVEL: [0, 1, 2, 4, 6, 8],
  COP_SIGHT: 70,
};

export const DAY = { LENGTH: 480, START: 0.36 }; // seconds per full cycle, start fraction (morning)

export const KEYS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'], jump: ['Space'], handbrake: ['Space'], enter: ['KeyF'], interact: ['KeyE'], ao: ['KeyO'],
  horn: ['KeyH'], camera: ['KeyC'], map: ['KeyM'], pause: ['Escape', 'KeyP'], radio: ['KeyR'], skiptime: ['KeyT'],
  nextWeapon: ['KeyQ'], help: ['F1'],
};
