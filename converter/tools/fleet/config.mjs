// @ts-check
/**
 * What the fleet converter converts, and how. Edit here, not in fleet-convert.mjs.
 */

/** the first batch: the types most seen at SFO (library airframe folders) */
export const BATCH = ['a320', 'a321', 'a20n', 'a21n', 'b738', 'b738-current', 'b38m', 'b39m', 'b77w', 'b789-current', 'a359', 'a35k', 'e75l'];

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
  QF: 'QFA', SQ: 'SIA', TK: 'THY', TP: 'TAP', UA: 'UAL', VN: 'HVN', VS: 'VIR', WN: 'SWA', YP: 'APZ', ZG: 'TZP', PD: 'POE'
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
  a20n: { takeoff: 0.3, approach: 0.6, landing: 1.0 }, a21n: { takeoff: 0.3, approach: 0.6, landing: 1.0 }
};

/**
 * Textures. The GPU cost of a texture is set by its pixels (compressed formats are 0.5 or 1 byte a pixel, plus a third
 * for mipmaps), its download by its content. Paint atlases (the textures that differ between an airframe's liveries)
 * are capped at 2048, everything else at 2048 too but shrunk first when a hero is over its GPU budget. Images that
 * are a single colour become a material colour; cabin-light masks are dropped (no night window glow yet).
 */
export const TEX = {
  paintCap: 2048, otherCap: 2048, minPaint: 1024, minOther: 512,
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
export const converterFiles = (root, list) => ['tools/fleet-sync.mjs', 'tools/fleet-convert.mjs', ...list(root + '/tools/fleet').filter(f => f.endsWith('.mjs') && !f.startsWith('bundle-')).sort().map(f => 'tools/fleet/' + f)];
