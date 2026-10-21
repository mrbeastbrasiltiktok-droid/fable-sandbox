// Track definitions. points: [x, z, y, width]. Closed Catmull-Rom loop. t values are 0..1 fractions of lap.
export const TRACKS = [
  {
    id: 'meadow', name: 'Meadow Circuit', theme: 'meadow', difficulty: 1,
    blurb: 'Wide open farmland, hot-air balloons overhead. Learn to drift here.',
    rails: true, shoulder: 16, groundY: -0.4,
    sky: { top: 0x3f8fe8, bottom: 0xbfe6ff, fog: 0xbfe6ff, fogFar: 702, sun: 0xfff2d0, sunInt: 2.1, ambient: 0x8fb5d8, ambInt: 0.9, sunDir: [0.5, 0.9, 0.3] },
    points: [
      [0, 0, 0.0, 19], [78, 0, 0.0, 19], [143, -16, 0.6, 18], [182, -62, 1.7, 17], [169, -120, 3.4, 17], [120, -146, 4.6, 17],
      [68, -125, 5.8, 17], [29, -159, 6.3, 17], [-39, -185, 4.6, 17], [-107, -159, 2.9, 18], [-133, -91, 1.1, 18], [-120, -29, 0.6, 19], [-68, 8, 0.0, 19],
    ],
    itemBoxes: [0.12, 0.42, 0.7], coins: [0.25, 0.55, 0.85], boostPads: [{ t: 0.62, lat: 0, w: 9 }], ramps: [],
    hazardZones: [], deco: { trees: 420, extra: 60, barns: 3, balloons: 6, fences: 1 },
  },
  {
    id: 'dunes', name: 'Sunset Dunes', theme: 'desert', difficulty: 2,
    blurb: 'Pyramids, a canyon arch and a big jump. Deep sand will eat your speed.',
    rails: true, shoulder: 22, groundY: -0.6,
    sky: { top: 0x3d5aa8, bottom: 0xffb376, fog: 0xf3b98a, fogFar: 756, sun: 0xffd0a0, sunInt: 2.3, ambient: 0xd8b090, ambInt: 1.1, sunDir: [-0.7, 0.45, 0.3] },
    points: [
      [0, 0, 0.0, 18], [104, 0, 0.0, 18], [182, -29, 3.4, 17], [224, -94, 6.9, 17], [198, -172, 9.2, 17], [133, -211, 11.5, 17],
      [55, -195, 13.8, 16], [3, -237, 12.6, 16], [-81, -263, 9.2, 16], [-159, -224, 5.8, 16], [-185, -146, 3.4, 17], [-159, -68, 1.1, 17], [-94, -16, 0.0, 18],
    ],
    itemBoxes: [0, 0, 0.8, 5], coins: [0.22, 0.5, 0.78], boostPads: [{ t: 0.3, lat: 0, w: 8 }], ramps: [{ t: 0.545, lat: 0, w: 11 }],
    hazardZones: [], deco: { cacti: 300, mesas: 40, rocks: 160, pyramids: 3, arches: 2, tumbleweeds: 14 },
  },
  {
    id: 'frost', name: 'Frostbite Peak', theme: 'snow', difficulty: 3,
    blurb: 'Climb the mountain. Ice patches kill your traction.',
    rails: true, shoulder: 14, groundY: -0.5,
    sky: { top: 0x6f9be0, bottom: 0xe6f0ff, fog: 0xdbe8f8, fogFar: 621, sun: 0xffffff, sunInt: 1.9, ambient: 0xa8c4e6, ambInt: 1.0, sunDir: [0.3, 0.8, -0.5] },
    points: [
      [0, 0, 0.0, 18], [94, 0, 2.3, 18], [159, -42, 6.9, 17], [172, -120, 13.8, 16], [120, -172, 20.7, 16], [42, -159, 25.3, 16],
      [-29, -198, 29.9, 15], [-94, -185, 27.6, 15], [-133, -120, 20.7, 15], [-120, -55, 11.5, 16], [-81, -8, 4.6, 17], [-34, 8, 1.1, 18],
    ],
    itemBoxes: [0.14, 0.44, 0.72], coins: [0.3, 0.6, 0.9], boostPads: [{ t: 0.82, lat: 0, w: 9 }], ramps: [],
    hazardZones: [{ type: 'ice', t0: 0.33, t1: 0.42 }, { type: 'ice', t0: 0.64, t1: 0.71 }], deco: { pines: 520, snowmen: 20, rocks: 80, lodges: 2, lifts: 1 },
  },
  {
    id: 'neon', name: 'Neon Harbor', theme: 'neon', difficulty: 3,
    blurb: 'Tight hairpins under city lights. Boost pads reward clean lines.',
    rails: true, shoulder: 9, groundY: -0.3,
    sky: { top: 0x090a1f, bottom: 0x2a1a5a, fog: 0x161334, fogFar: 513, sun: 0x8090ff, sunInt: 1.1, ambient: 0x5050b0, ambInt: 1.4, sunDir: [-0.3, 0.8, 0.4] },
    points: [
      [0, 0, 0.0, 17], [117, 0, 0.0, 17], [159, 16, 0.0, 16], [164, 57, 0.0, 16], [130, 81, 0.0, 16], [81, 68, 0.0, 16], [52, 107, 0.0, 16], [94, 159, 0.0, 16],
      [55, 211, 0.0, 16], [-29, 211, 0.0, 16], [-81, 172, 0.0, 16], [-65, 120, 0.0, 16], [-120, 81, 0.0, 16], [-159, 29, 0.0, 16], [-120, -21, 0.0, 17], [-55, -8, 0.0, 17],
    ],
    itemBoxes: [0, 0, 0.7, 5], coins: [0.2, 0.48, 0.72], boostPads: [{ t: 0.23, lat: 0, w: 8 }, { t: 0.52, lat: 0, w: 8 }, { t: 0.95, lat: 0, w: 8 }], ramps: [],
    hazardZones: [], deco: { buildings: 260, lamps: 110, boats: 10, ferris: 1, searchlights: 4 },
  },
  {
    id: 'volcano', name: 'Ember Vault', theme: 'lava', difficulty: 4,
    blurb: 'Lava on both sides and a bumpy back straight. Keep it on the rock.',
    rails: true, shoulder: 8, groundY: -1.2,
    sky: { top: 0x2a0d0d, bottom: 0x7a2a10, fog: 0x4a1c10, fogFar: 459, sun: 0xffb070, sunInt: 1.8, ambient: 0xff7040, ambInt: 1.6, sunDir: [0.2, 0.7, -0.6] },
    points: [
      [0, 0, 0.0, 17], [104, 0, 1.1, 17], [169, -32, 4.6, 16], [195, -98, 8.0, 16], [156, -150, 10.3, 16], [91, -124, 12.6, 15], [39, -156, 13.8, 15], [52, -221, 13.8, 15],
      [-13, -266, 12.6, 15], [-91, -247, 10.3, 15], [-117, -182, 8.0, 15], [-78, -124, 5.8, 15], [-130, -78, 3.4, 16], [-143, -20, 1.1, 16], [-78, 10, 0.0, 17],
    ],
    itemBoxes: [0, 1, 0.8, 5], coins: [0.26, 0.54, 0.8], boostPads: [{ t: 0.3, lat: 0, w: 8 }], ramps: [{ t: 0.78, lat: 0, w: 10 }],
    hazardZones: [{ type: 'bumps', t0: 0.47, t1: 0.55 }], deco: { rocks: 280, geysers: 18, lavafalls: 5 },
  },
  {
    id: 'starlight', name: 'Starlight Road', theme: 'space', difficulty: 5,
    blurb: 'No guard rails. Fall off and Lakitu will not be gentle.',
    rails: false, shoulder: 1.5, groundY: -200,
    sky: { top: 0x03020a, bottom: 0x100a2a, fog: 0x07051a, fogFar: 810, sun: 0xd0d8ff, sunInt: 1.6, ambient: 0x6050c0, ambInt: 1.0, sunDir: [0.4, 0.8, 0.2] },
    points: [
      [0, 0, 0.0, 18], [94, 0, 4.6, 18], [156, -42, 12.6, 17], [135, -104, 21.8, 16], [73, -114, 27.6, 16], [42, -166, 33.3, 15], [94, -218, 36.8, 15], [42, -260, 34.5, 15], [-42, -250, 31.0, 15], [-73, -187, 25.3, 15], [-135, -156, 20.7, 15], [-156, -83, 14.9, 15], [-114, -26, 8.0, 16], [-52, 10, 2.3, 17],
    ],
    itemBoxes: [0.1, 0.4, 0.7], coins: [0.25, 0.55, 0.85], boostPads: [{ t: 0.33, lat: 0, w: 8 }, { t: 0.78, lat: 0, w: 8 }], ramps: [{ t: 0.5, lat: 0, w: 11 }],
    hazardZones: [], deco: { planets: 9, crystals: 120, asteroids: 400, nebulae: 6, station: 1 },
  },
];

export const CUP = { name: 'Fable Cup', tracks: TRACKS.map((t) => t.id) };
