// @ts-check
/**
 * What the fleet converter converts, and how. Edit here, not in fleet-convert.mjs.
 */

/**
 * The airframes converted (library airframe folders): the first batch, the types most seen at SFO; then, for every
 * airliner and freighter (the user, 15 Nov: "Yes, convert it"), the rest of the library's airliners. Business jets stay
 * the kit's (D-121: "keep plain is fine").
 */
export const BATCH = ['a320', 'a321', 'a20n', 'a21n', 'b738', 'b738-current', 'b38m', 'b39m', 'b77w', 'b789-current', 'a359', 'a35k', 'e75l',
  'a221', 'a223', 'a319', 'a332', 'a332-ge', 'a333', 'a339', 'a388', 'b737', 'b739', 'b744f', 'b748f', 'b752', 'b753', 'b762f', 'b763',
  'b763f', 'b772', 'b77f', 'b788', 'b78x', 'crj200', 'crj900', 'e295'];

/** never converted: the King Air B200 and C90 sources are CC BY-NC-SA 3.0 (non-commercial) */
export const EXCLUDE_AIRFRAMES = new Set(['be20', 'be9l']);

/**
 * Liveries left out of the manifest (the kit's stylised livery shows instead):
 *  - Frontier: every Frontier export carries an animal tail, and the library's own records call its tail art
 *    AI-generated look-alikes of the real motifs (the user's rule: avoid them);
 *  - legacy exports outside the SFO coverage (Ryanair, United's Continental-globe 737-800).
 */
export const SKIP_LIVERY = [/^frontier/, /^ryanair$/];
export const SKIP_SELECTOR = new Set(['b738/united', 'b738/ryanair']);

/** special liveries: converted (they exist on real aircraft) but never a type's default; matched by registration later */
export const SPECIAL = new Set(['b738-current/american-aircal', 'b738-current/united-star-alliance', 'a320/united-friend-ship', 'a35k/philippine-airlines-85-years']);

/** the coverage file's IATA airline codes → the ICAO codes livesfo's metadata carries (meta.al, the brand) */
export const IATA_ICAO = {
  AA: 'AAL', AC: 'ACA', AF: 'AFR', AI: 'AIC', AM: 'AMX', AS: 'ASA', AV: 'AVA', B6: 'JBU', BA: 'BAW', BF: 'FBU', BR: 'EVA',
  CA: 'CCA', CI: 'CAL', CM: 'CMP', CX: 'CPA', DL: 'DAL', EI: 'EIN', EK: 'UAE', F8: 'FLE', F9: 'FFT', FJ: 'FJI', HA: 'HAL',
  JL: 'JAL', JX: 'SJX', KE: 'KAL', KL: 'KLM', LH: 'DLH', LX: 'SWR', MX: 'MXY', NH: 'ANA', NZ: 'ANZ', OZ: 'AAR', PR: 'PAL',
  QF: 'QFA', SQ: 'SIA', TK: 'THY', TP: 'TAP', UA: 'UAL', VN: 'HVN', VS: 'VIR', WN: 'SWA', YP: 'APZ', ZG: 'TZP', PD: 'POE',
  // freight: the library's FedEx, Amazon (flown by ATI), ABX and Air Zeta (formerly Air Incheon) exports, and UPS
  FX: 'FDX', '8C': 'ATN', GB: 'ABX', KJ: 'AIH', '5X': 'UPS',
  'ABX Air': 'ABX'   // (one coverage entry names the operator instead of its code)
};

/**
 * Parts that are never seen from outside and are dropped: the 777 family's cabin interior (walls, galley carts, a
 * coffee maker, drinks cans, toilets, curtains; about 74k triangles and 17.8 MB of PNG), found by the textures they
 * use; and the parts the library's own runtime hides (the spinning-fan discs and the stowed RAT).
 */
export const INTERIOR_TEXTURES = new Set(['bar', 'bouteille 3', 'cafetiere', 'cloison', 'canette1', 'canette2', 'canette3', 'galley-cart', 'wall', 'placar', 'plafond', 'plancher', 'rideau', 'wctoilette', 'wctoilettelumiere']);
export const HIDDEN_NODES = /FanSpinning|^Rat$|^RatSpinner$/;

/**
 * Flap detents on the library's 0–1 visual travel (its FlightGear flap-pos-norm), for livesfo's take-off, approach
 * and landing settings. Boeing 737 FlightGear models step 1/8 per detent (1, 2, 5, 10, 15, 25, 30, 40); Airbus models
 * run CONF 1+F, 2, 3, FULL. Estimates where no source says: marked in the report.
 */
export const DETENTS = {
  default: { takeoff: 0.3, approach: 0.5, landing: 1.0 },
  b738: { takeoff: 0.375, approach: 0.625, landing: 0.875 }, 'b738-current': { takeoff: 0.375, approach: 0.625, landing: 0.875 },
  b38m: { takeoff: 0.375, approach: 0.625, landing: 0.875 }, b39m: { takeoff: 0.375, approach: 0.625, landing: 0.875 },
  a320: { takeoff: 0.3, approach: 0.6, landing: 1.0 }, a321: { takeoff: 0.3, approach: 0.6, landing: 1.0 },
  a20n: { takeoff: 0.3, approach: 0.6, landing: 1.0 }, a21n: { takeoff: 0.3, approach: 0.6, landing: 1.0 },
  // the rest of the library (15 Nov): the 737 NG's 1/8 steps as the 737-800's; the IDG A320 and A330 families' CONF
  // detents as the A320's; the others the default (estimates, marked in the report)
  b737: { takeoff: 0.375, approach: 0.625, landing: 0.875 }, b739: { takeoff: 0.375, approach: 0.625, landing: 0.875 },
  a319: { takeoff: 0.3, approach: 0.6, landing: 1.0 }, a332: { takeoff: 0.3, approach: 0.6, landing: 1.0 },
  'a332-ge': { takeoff: 0.3, approach: 0.6, landing: 1.0 }, a333: { takeoff: 0.3, approach: 0.6, landing: 1.0 },
  a339: { takeoff: 0.3, approach: 0.6, landing: 1.0 }
};

/**
 * Textures. The GPU cost of a texture is set by its pixels (compressed formats are 0.5 or 1 byte a pixel, plus a third
 * for mipmaps), its download by its content. Paint atlases (the textures that differ between an airframe's liveries)
 * are capped at 2048, everything else at 2048 too but shrunk first when a hero is over its GPU budget. Images that
 * are a single colour become a material colour; a cabin-window mask is kept as the emissive map (D-144).
 */
/**
 * Engines moved to the makers' published stations (D-149; tools/research/fleet/spec.json, docs/research/
 * fleet-size-match.md): the parts matching `parts` (the nacelle, fan, spinner, reversers, core, the forward pylon) moved
 * along the aircraft by dz (m, + aft) and across so the engine's axis (its fan's spin centre) lands at x (m out from the
 * centreline; left and right moved apart: the library's NG 737s are drawn asymmetric, the left engine 0.29 m further
 * out); the motions that turn only those parts move with them; parts matching `near` move only their vertices within
 * the engine's radius and length. The library's NG 737 nacelles sit 0.8–1.2 m aft of
 * Boeing's inlet stations (D6-58325-7 Rev C), its 787 nacelles 0.6–0.9 m forward (D6-58333 Rev O).
 */
// (the reverser halves, lreverserib_0 and _1, and the 737-800's ReverserCascade1 and -1 with them: missed until 15 Nov,
// they stood 0.8–1.2 m behind the moved nacelles, a gap like reversers out at rest; the converter now refuses an engine
// move that leaves a part the reversers turn behind)
const NG_ENGINE = /^(engnose|engcore|tailpipe|ductinner|lreverserib(_\d)?|ReverserCascade(-?\d)?|fan|fan_1|fwdpylon|rhnacascoop)(\.\d+)?$/;
const A330_ENGINE = /^(intake(\.001)?|fan[01]|fan\.cone[01]|cylinder\.00[78]|pw\.nacelle0_(\.001)?|rr\.(exhaust(\.001)?|nacelle[01]|pylon[01]|reverser\.[du][lr][01]i?)|ge\.(exhaust([01]|\.001)?|nacelle[01]|nozzle[01]|pylon[01]|reverser[01]|rim[01]))$/;
const B787_ENGINE = /^(rh|lh)(cone|inside|reverser|enginecore|fans|reversergrid|fan|ring|fancasing)$|^no[12]enge$|^eng[12]fanb?$/;
export const ENGINE_FIX = {
  b737: { parts: NG_ENGINE, dz: -1.23, x: 4.83 },
  b738: { parts: NG_ENGINE, dz: -1.11, x: 4.83 },
  'b738-current': { parts: NG_ENGINE, dz: -1.10, x: 4.83 },
  b739: { parts: NG_ENGINE, dz: -0.77, x: 4.83 },
  // (the 787's inlet lips and their chrome rings are in parts that span both engines and more: `near` moves only their
  // vertices round each engine's axis, within the moved parts' radius and length)
  // (and across to 9.72 m, the kit's from Boeing's D6-58333 Rev Q: the library's fans at 9.505, 0.215 m in)
  b788: { parts: B787_ENGINE, near: /^(front|chrome)$/, dz: 0.91, x: 9.72 },
  'b789-current': { parts: B787_ENGINE, near: /^(front|chrome)$/, dz: 0.61, x: 9.72 },
  b78x: { parts: B787_ENGINE, near: /^(front|chrome)$/, dz: 0.67, x: 9.72 },
  // the A330s (Airbus A330 Aircraft Characteristics, Dec 2025, figure 2-2-0-991-001: the -300's inlets GE 21.14, PW
  // 21.45, RR 21.28 m; the -200's 3.20 m sooner, its main gear at 28.85 m to the -300's 32.05: GE 17.94, RR 18.08): the
  // library's nacelles 1.6–2.0 m aft, each measured at its own inlet lip (the kit's checked against the same pages,
  // 15 Nov); the -900's Trent 7000 already at 21.05 m, the kit's. Across: the library's 9.37 m, the kit's
  a333: { parts: A330_ENGINE, dz: -1.64 },        // Fiji's A330-343, Trent 772: its inlet at 22.92 m
  a332: { parts: A330_ENGINE, dz: -2.03 },        // Hawaiian's A330-243, Trent 772B: 20.11 m
  'a332-ge': { parts: A330_ENGINE, dz: -1.63 },   // Aer Lingus's A330-203, CF6-80E1: its lip ring at 19.57 m
  // the E175's CF34-8E5: no document gives its inlet, so measured on four Commons photos (15 Nov, docs/FLEET.md "The
  // E175's inlet, measured"): the lip at 10.6 ± 0.1 m, 4.0 ± 0.1 out, 1.36 up; the library's lip at 9.93 (its fans at
  // 4.04 out and 1.34 up: kept), the kit's estimate 10.9 and ~4.5. The library's 4.0 m from lip to plug matches the
  // photos' 3.85, so the whole engine moves
  e75l: { parts: /^(nacelle(\.001)?|fan\.[lr]|cylinder\.00[12]|exhaust(\.001)?|reverser(\.001)?|pylon(\.001)?)$/, dz: 0.67 }
};
/**
 * Parts stretched aft to a published station (D-149): each matching part's vertices behind its own front (its least z,
 * kit frame) spread so its aft end (its greatest z) lands on `aftTo`; for static parts only (nothing turns them).
 */
/**
 * Main gear moved to the published station (D-149, as ENGINE_FIX: the parts matching `parts` along the aircraft by dz,
 * the motions turning only them with them; the dims' mainZ with them). The library's E175 stands its main gear at
 * 14.25 m, the kit's (checked against Embraer's documents, 15 Nov) at 15.62: 1.37 m forward (photos agree: 15.68 and
 * 15.50 m, docs/FLEET.md "The E175's inlet, measured"). It folds sideways, so aft it still folds into the belly.
 */
export const STRETCH_FIX = {
  // the 757s' pylons to the kit's ends (D6-58327 §2.2.1–2.2.2, the kit's v0.8 reading: 26.0 m on the -200, 30.06 on the
  // -300, ahead of the wing's trailing edge): the library's end at 24.88 and 28.89, their fronts at the nacelle kept
  b752: { parts: /^Pylon[LR]$/, aftTo: 26.0 },
  b753: { parts: /^[LR]Pylon$/, aftTo: 30.06 }
};
export const GEAR_FIX = {
  e75l: { parts: /^(gear\.[lr](\.001)?|tire\.[lr])$/, dz: 1.37 }
};
/**
 * Fins moved to the published station (15 Nov, the user: "can we fix these?" of a 777's fin shifting at the swap): the
 * parts matching `parts` along the aircraft by dz, the motions turning only them (the rudder's hinge) with them. The
 * library's 777 fins stood forward of the kit's, which follows Boeing's airport planning drawing (the kit's v0.8 batch
 * 3 moved its fin 0.75–0.86 m aft; photos agree, docs/FLEET.md): measured on the converted models against the kit's fin
 * (tools/research/fleet/fin-fit.mjs), the chord's middle at half the fin's height 0.54 m forward on the -300ER, 0.51 on
 * the -200, 0.53 on the freighter (the leading edge 0.62–0.76, the trailing edge 0.40: the library's chord a little
 * shorter); moved by that, each edge is within 0.15 m of the kit's. `Tail` is the fin, `Rudder` and `LRudder` its
 * rudder (not `RUdamper`, a gear damper)
 */
/**
 * Operator paint finishes set aside (15 Nov, the user: "Some of alaska's engines were drawn as blue and some are white,
 * even for the same model between the hifi and lowfi models"): the library painted Alaska's 737-8 nacelles navy (its
 * finish alaska-nacelles), where Commons' photos of the current fleet show every Alaska type's nacelles white (the
 * 737-800, -900, 737-8 and -9, the A321neo, the E175s; "Current Boeing 737-8 MAX of Alaska Airlines" and the like).
 * The finish's parts take the material it was laid over (its name less the finish): the engine's own paint.
 */
export const DROP_FINISH = { 'b38m/alaska': ['alaska-nacelles'] };

/**
 * Materials corrected (16 Nov, the user: "delta's 767-300's door doesn't seem right"): the 767-300's passenger door
 * skins are parts of their own over the fuselage; the library painted them (its finish "Painted passenger door skins",
 * near white) on every 767 livery but Delta's, whose doors kept the bare material, black. Delta's take the same paint.
 * Keyed by selector, then the material's name: its base colour.
 */
export const MAT_FIX = { 'b763/delta': { '_Gray_Gl_surface': [0.9301, 0.9387, 0.9473, 1] } };

/**
 * Paint corrected in the library's images (15 Nov, the user: "alaska's E75L seems to have a front half of the plane's
 * livery brighter than the 2nd half"). The library's E175 Alaska fuselage is a light grey white (228) with a pure-white
 * box (250) pasted over an older title on the forward fuselage, both sides: the front half read brighter (the bake took
 * it to the crowd). `lift` scales the image's near-white greys (saturation at most `sat`, value from `lo` to `hi`) by
 * to / from, so the fuselage is the box's white throughout; the title, the stripes, the belly's greys and the panel
 * lines are left.
 */
export const TEX_FIX = { 'e75l/alaska': { image: 'authored-color-0', lift: { lo: 200, hi: 244, from: 228, to: 250, sat: 14 } } };

/**
 * Cockpit windows the library left open (15 Nov, the user: "the windshield is transparent and leaking the details through
 * from the other side"): on these airframes the cockpit glazing is drawn as the windows' frame, one piece with a hole
 * for each pane (the 737-700 and -900: an outline and six holes, the very panes the 737-800 draws; the 737 MAX's alike),
 * so you looked through the cockpit to its far side. The converter gives each hole its pane (geometry.mjs capHoles).
 * Only these: elsewhere the panes are drawn, some as one joined piece whose seams aren't holes (the A330s, the E2)
 */
export const COCKPIT_PANES = new Set(['b737', 'b739', 'b38m', 'b39m']);
const B777_FIN = /^(Tail|Rudder|LRudder)$/;
export const FIN_FIX = {
  b77w: { parts: B777_FIN, dz: 0.54 },
  b772: { parts: B777_FIN, dz: 0.51 },
  b77f: { parts: B777_FIN, dz: 0.53 }
};

export const TEX = {
  paintCap: 2048, otherCap: 2048, minPaint: 1024, minOther: 512,
  maskCap: 1024,   // a cabin-window mask (737 MAX), black with white windows: ETC1S, outside the budget (on top of it)
  gpuBudget: 13e6,          // textures, bytes on a desktop GPU (geometry comes on top: the whole hero aims at ≤ 15 MB)
  maxDensity: 40000,        // texels per m² of surface (5 mm a texel): finer is never seen, and is halved
  busyEtc1s: 0.3,           // share of noisy 4×4 blocks above which a non-paint map goes straight to ETC1S
  // dB: ETC1S is kept for paint (lettering, logos) only this close to the source, else UASTC; and for everything else.
  // 37/35 meets the ~1 MB median wire budget (on the replay's views ETC1S paint looks the same; at 2× zoom its edges
  // are slightly blocky). For UASTC liveries everywhere (sharper close-ups, about 2× the bytes and GPU memory): 99/99
  etc1sPsnrPaint: 37,
  etc1sPsnrOther: 35,
  uastc: { level: 2, rdo: 2.0, dict: 65536, zstd: 19 },   // measured on the Alaska 737 body: 733 KB at 47 dB (λ 1, default dict: 820 KB, 51 dB)
  etc1s: { comp: 2, q: 255 }                             // (q 160 → 255: +15 % bytes, +0.7 dB)
};

/** geometry: positions on one grid per aircraft (≈ 2.5 mm), 8-bit octahedral normals, 14-bit UVs */
export const GEO = { posStep: 0.0025, uvBits: 14, normalBits: 8, heroTris: 160000, lodErrors: { lod1: 0.02, lod2: 0.08 }, heroError: 0.005 };

/**
 * Licence records for the sources the first batch adapts (the library's asset-handoff-manifest.json lists each
 * export's source packages; these are the summaries the credits page shows, and the source bundle carries the full
 * notices). Filled from the manifest at conversion time; this table adds what the page needs to say about each.
 */
export const LICENCE_NAMES = {
  'gpl-2.0-or-later': 'GNU GPL version 2 or later',
  'gpl-3.0': 'GNU GPL version 3',
  'cc-by-nc-sa-3.0': 'CC BY-NC-SA 3.0 (non-commercial: not used)'
};

/**
 * The GNU GPL versions each upstream package's own notice allows, for what may be combined in one image (the reverse
 * bake, tools/fleet/reverse.mjs). The library's records say gpl-2.0-or-later for most packages, but their own notices
 * are what count (docs/FLEET.md, "Licences and publishing the source"): most ship the GPL-2.0 text and say no more, read
 * here as version 2 only (the conservative reading; a package naming no version arguably allows any, GPLv2 §9: the
 * user's call); A350XWB's README says "Released under GPL2+"; the 767-300's says "GNU GPL" with no version (any).
 * Combining: GPL paint with GPL paint of a version both allow; CC BY 4.0 or CC0 with any; CC BY-SA 4.0 only into
 * GPL-3.0, its one compatible GPL (creativecommons.org/compatiblelicenses). `--or-later` in reverse.mjs takes the
 * library's records instead.
 */
export const GPL_VERSIONS = { 'FGMEMBERS/A350XWB': [2, 3], 'dogsaysmoo/767-300': [2, 3] };
/** @param {string} repo @param {string} [recorded] the library's record (gpl-2.0-or-later, gpl-3.0) @param {boolean} [orLater] */
export function gplVersions(repo, recorded = '', orLater = false) {
  if (GPL_VERSIONS[repo]) return GPL_VERSIONS[repo];
  if (orLater && /^gpl-2\.0-or-later$/.test(recorded)) return [2, 3];
  return /^gpl-3\.0/.test(recorded) ? [3] : [2];
}

/**
 * What the handoff manifest leaves out about a source package: the legacy 737-800's upstream (its README and
 * upstream-revision.json name it) and the E-jet family's pinned tree (its repository-tree.json).
 */
export const PACKAGE_INFO = {
  b738: { repo: 'YV3399/737-800YV', url: 'https://github.com/YV3399/737-800YV', rev: '9d967d89dd2ee0ae1bf01d00c49839a574aa9da5' },
  'preparation/E-jet-family': { rev: 'tree 45be9f83c479c5df6a03b117513aae740ffe9cc3' }
};

/**
 * livesfo's converter as it goes out with the models' corresponding source (tools/fleet-sync.mjs --bundle): every
 * file it runs. The bundle adds a package.json that pins meshoptimizer, the one dependency, and a README on running
 * it; docs/FLEET.md stays out (it describes our hosting), and so do the bundle's own tools (tools/fleet/bundle-*.mjs).
 * @param {string} root the checkout @param {(dir: string) => string[]} list a directory's file names
 */
export const converterFiles = (root, list) => ['tools/fleet-sync.mjs', 'tools/fleet-convert.mjs', ...list(root + '/tools/fleet').filter(f => (f.endsWith('.mjs') && !f.startsWith('bundle-')) || f === 'bake-siblings.json').sort().map(f => 'tools/fleet/' + f)];
