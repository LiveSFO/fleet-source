# Animated airliner exterior library

Animated aircraft props for Three.js and video staging. The November 11 SFO inventory and the original nine-variant release share the same controller.

Open [Airliner studio](http://127.0.0.1:8080/viewer/airliners.html). Start the workspace server with `npm start` if necessary.

## SFO fleet and file handoff

Use [sfo-build-coverage.json](sfo-build-coverage.json) to look up an airframe and livery from the saved November 11, 2026 SFO traffic. It records the two official snapshot intervals, flight-identification corrections, exact export paths and review state. [The dated inventory](traffic/2026-11-11-build-inventory.json) contains the flight rows and their source evidence.

For each selected asset, copy the GLB and its same-name `.rig.json` from `<airframe>/exports/` and copy `<airframe>/lights.json`. Keep that directory layout under the URL you pass as `baseURL`. The GLB has packed textures and the clips supported by that airframe. Include `viewer/airliner-runtime.js` and `viewer/fleet-catalog.js` for the controller and light controls. The matching editable scene is `<airframe>/<livery>.blend`. Examples include `e295/exports/porter.glb` and `a35k/exports/philippine-airlines-85-years.glb`. [asset-handoff-manifest.json](asset-handoff-manifest.json) lists these files, export hashes, source packages and license evidence for all 138 selected exports.

The 18 entries built from authored sections use [reference-jet-profiles.json](reference-jet-profiles.json) and `scripts/build_reference_jets.py`. Their records identify published views, dimension references and paint references. Several private-aircraft variants reuse adapted station curves and representative stripe layouts; passing an envelope check does not establish close-up contour or registration accuracy. For adapted aircraft, follow `provenance` in the rig sidecar and the handoff manifest to pinned source directories, licenses and download manifests. Preserve the applicable notices and corresponding source when redistributing adapted assets. Airline marks identify the depicted operator.

The B200 (`be20`) and C90 (`be9l`) source is **CC BY-NC-SA 3.0**, with a noncommercial restriction. Most adapted airliners have GPL notices; the modern 767 and Global 5000 include GPL version 3 text. Assemblies can combine separately licensed geometry and paint: retain each notice and verify the exact file-level grants before redistribution. There is no blanket commercial clearance for the whole library. The unused Headwind A330neo candidate has a model-specific permission exception and was **not converted**; do not include that candidate in a handoff of the adapted A330neo prop.

Use `scripts/render_fleet_review.py` in Blender background mode with `airframe/livery/view` selectors for consistent exterior checks. The `mechanisms` view poses flaps, spoilers and reversers and the `cabin` view shows illumination with retracted gear. [fleet-validation-summary.json](fleet-validation-summary.json) records the GLB checks and repeated runtime gear cycles. [visual-reviews.json](visual-reviews.json) records evidence tied to the corresponding GLB hash.

## Original A320neo and 737-800 release

| Aircraft | Livery | Engine | Self-contained animated GLB |
| --- | --- | --- | --- |
| A320neo | British Airways, G-TTNR | CFM LEAP-1A | `a320neo/exports/british-airways.glb` |
| A320neo | SAS, SE-ROJ | CFM LEAP-1A | `a320neo/exports/sas.glb` |
| A320neo | Lufthansa, D-AINK | Pratt & Whitney PW1100G | `a320neo/exports/lufthansa.glb` |
| 737-800 | Ryanair | CFM56-7B | `b738/exports/ryanair.glb` |
| 737-800 | Southwest, Heart | CFM56-7B | `b738/exports/southwest.glb` |
| 737-800 | American Airlines | CFM56-7B | `b738/exports/american.glb` |
| 737-800 | United, Continental globe era (historical paint) | CFM56-7B | `b738/exports/united.glb` |
| 737-800 | Alaska Airlines | CFM56-7B | `b738/exports/alaska.glb` |
| 737-800 | Delta Air Lines | CFM56-7B | `b738/exports/delta.glb` |

These are **adapted FlightGear exterior models and community-authored paint maps**, with preserved source credit and GPL notices. They are detailed visualization assets checked against published manufacturer dimensions, not newly authored OEM CAD. Airline markings are reproductions from the source paint maps; no airline endorsement or official paint certification is represented. Registration and configuration describe the supplied artwork, not a live fleet registry.

## What is included

- Detailed aircraft skins, cockpit glazing, wings, sharklets/blended winglets, flap tracks, landing gear and nacelles.
- Three A320neo 4K fuselage paint maps with corresponding engine maps; six 737-800 2K airline maps. The original UV layouts, logos, registrations and painted markings are retained.
- Flaps/slats, spoilers, landing gear and doors, translating thrust-reverser sleeves, and fan rotation.
- Navigation, upper/lower red beacon, white strobe, landing, taxi/turnoff, tail-logo and wing-inspection lighting in the runtime.
- Cabin window illumination that can be switched independently of exterior lights. A320 uses an embedded UV-aligned window mask (80 illuminated regions, including four passenger-door peepholes; other windows can read as closed shades); the 737 uses its separate passenger-window surfaces plus four curved panes fitted to the existing door openings. This is an exterior illumination effect without a modeled passenger cabin.
- Native glTF animation clips, editable `.blend` scenes, separate source meshes/XML/paint maps, conversion scripts, JSON rig definitions, light positions and validation reports.

The runtime is deterministic with an explicit time argument; light flashes do not depend on wall-clock timers. Retraction and flap movement interpolate over time; direct state positioning is available for rendering exact frames.

## Integration in another Three.js project

Copy the selected assets and both viewer modules described above. Configure the `three` and `three/addons/` imports for Three.js 0.186.1.

```js
import { loadAirliner } from './airliner-runtime.js';

const airplane = await loadAirliner({
  aircraft: 'a320neo',
  livery: 'british-airways',
  baseURL: '/models/airliners/',
});
scene.add(airplane.root);

airplane.setState({
  gear: 0,          // 0 retracted, 1 extended
  flaps: 0,        // 0 retracted, 1 full visual travel; slats follow
  reversers: 0,    // 0 stowed, 1 deployed
  spoilers: 0,
  engineSpeed: .6, // visual fan-speed fraction, not a calibrated N1 simulation
  cabin: true,
  navigation: true,
  beacon: true,
  strobe: true,
  landing: false,
  taxi: false,
  logo: true,
  wing: false,
}, { instant: true });

// In your animation/render loop:
airplane.update(elapsedSeconds, deltaSeconds);
// airplane.root.position / quaternion place it in your scene.
// airplane.dispose() releases its resources.
```

Numeric controls are clamped to 0..1. `instant: false` (default) moves toward the requested state. Boolean light controls switch immediately. The runtime permits independent posing, including reversers while airborne, so a filmmaker can inspect mechanisms; it does not implement operational interlocks or flight dynamics.

Models use **meters, +Y up, +X aft, +Z port (left)**. `airplane.root` recenters the source model horizontally and raises the raw gear-down envelope to ground level. Move the root up for flight shots. Aircraft attitude, wheel loading, gear compression, flexible wing bending and aerodynamic control laws are outside the current rig.

Use a PBR environment, tone mapping and correct color management. Night mode in the demo changes scene illumination independently of the aircraft's light controls. Strong lights and emissive windows can optionally drive your renderer's bloom effect; the loader itself has no postprocessing dependency.

### Standard GLB animation clips

The original release embeds five standard glTF clips: `Gear`, `Flaps`, `Reversers`, `Spoilers`, `Fans`. Expansion models omit mechanisms absent from their configuration; consult `expectedAnimations` and `capabilities` in each rig. CJ3 and Phenom 300 have no invented reverser sleeves. Skid-equipped EC135s expose rotor rotation without retractable gear/flaps. Propeller reverse, where supplied, changes blade pitch. All mechanism clips use a 0..1-second timeline for direct scrubbing. `Gear` runs **retracted → extended**; the other mechanisms run **stowed → deployed**. `Fans` is a looping fan/propeller/rotor display rotation. Disable looping and clamp at the end for mechanism clips. Original mesh rest pose is gear down, other controls stowed.

Load those clips with a normal glTF animation system for geometry motion. Cabin/exterior lighting, light flash timing and state coordination are supplied by the Three.js runtime and adjacent `lights.json` / `.rig.json` files. The standard GLB alone does not install the runtime light objects. Use the supplied loader for the complete behavior.

## Official drawing checks

The official documents were downloaded and visually reviewed locally on 2026-11-11:

- [Airbus Aircraft Characteristics landing page](https://www.aircraft.airbus.com/en/customer-care/fleet-wide-care/airport-operations-and-aircraft-characteristics/aircraft-characteristics); [A320 July 2026 document](https://mediaassets.airbus.com/pm_38_916_916266-iujedqawwy.pdf?fileName=aca32001-jul-2026-2.pdf). A320neo general dimension drawings: PDF pages 48–49, section 2-2-0, figure 991-009-A01. Exterior lighting: pages 111–117, section 2-10-0, especially the neo illustration on page 113.
- [Boeing airport planning manuals](https://www.boeing.com/commercial/airports/plan-manuals); [737NG Rev C, October 2025](https://www.boeing.com/content/dam/boeing/v2/airports/acaps/737NG_REV_C.pdf). 737-800W drawing: PDF page 35, section 2.2.6, printed page 2-14.

| Model | Measured GLB length | Reference length | Measured GLB span | Reference span |
| --- | --- | --- | --- | --- |
| A320neo | 37.606 m | 37.570 m | 35.767 m | 35.800 m |
| 737-800 | 39.421 m | 39.470 m | 35.867 m | 35.790 m |

The largest length/span difference is 0.215%. Source contours were preserved rather than globally stretched to hide small differences. The raw unloaded gear-down bounding heights are 12.245 m and 12.987 m respectively; these exceed the manufacturer parking illustrations (11.91 m and 12.55 m). Oleo compression and loaded ground attitude are not calibrated in this version. Do not infer factory accuracy for every contour or mechanical mounting from the envelope checks.

Planning drawings establish exterior dimensions, layout, clearances and light groups. They do **not** supply the full production surface CAD, actuator geometry or paint reflectance. Mechanism trajectories and hinge locations primarily follow the published FlightGear XML. Secondary A320 gear stays and torque links follow the primary leg where simulator-side folding constraints have not been ported; their independent folding is simplified. Light timing is a representative animation, not certified aircraft electrical behavior.

## Source provenance and changes

### A320neo

- Source: [legoboyvdlp/A320-family](https://github.com/legoboyvdlp/A320-family), pinned revision `fec1ecba767c8fffd145337b27012e89c01e3ade`.
- Source notice: Josh Davidson, Jonathan Redpath, merspieler, Matthew Maring, Thorsten Herrmann, Semir Gebran and other upstream contributors. See `a320neo/upstream/README.copyright.md`, `LICENSE`, source headers and livery XML.
- Selected fuselage, LEAP and PW exterior meshes, relevant textures, light offsets and livery definitions are preserved under `upstream/`.

### Boeing 737-800

- Source: [YV3399/737-800YV](https://github.com/YV3399/737-800YV), pinned revision `9d967d89dd2ee0ae1bf01d00c49839a574aa9da5`.
- Original authors and contributors include Innis Cunningham, David Culp, Syd Adams, Michael Soitanen, Omega13a and the 737-800YV contributors; retain `b738/upstream/THANKS`, `LICENSE`, `README.md`, source headers and livery XML.
- Boeing left aft outboard flap hinge Y coordinate `-5.5.88` in `LWing.xml` is malformed. The converter uses **-5.88 m**, mirroring the explicit +5.88 m right-wing coordinate, while preserving the original source file unchanged.
- Added a fixed illustrative reverser cascade lattice fitted to the source nacelle/sleeve envelope, and a dark inner backing. The original vane section is a visual approximation.
- Southwest source artwork used pure RGB blue/red/yellow fills. `generated/SWA-heart-corrected.png` maps those fills and their antialiasing to the published Heart brand RGB palette: 48/76/178, 213/21/46, 255/191/39. Grayscale and marking layout are preserved. This is an sRGB visual approximation, not a measured aircraft coating. [Southwest's Heart livery history](https://history.southwest.com/our-stories/our-heart-livery/); [authored brand guide, reproduced online](https://relayto.com/explore/southwest-airlines-brand-book-oencohq6wqro8). Exact transformation is reproducible in `scripts/refine_southwest_palette.py`.

### Glazing, doors and mechanism revision — 2026-11-11

- Cockpit panes now have a dedicated opaque smoke-tinted PBR material, independent of the livery texture: linear RGB 0.009/0.018/0.028, roughness 0.24, metalness 0.12, clear coat 0.22, specular IOR level 0.25. This is an exterior visualization treatment to conceal the unfinished flight deck; it is not a measured glass transmittance. Daylight reflections remain.
- The A320 emission mask now includes all four small door windows at their existing paint-map coordinates. The 737 has real 14 cm circular holes in its source door meshes: these are filled with individual panes using the exact boundary vertices and curvature, and join the cabin-light switch. No arbitrary flat panels cover the door.
- The 737 cascade is inset into each actual engine backing. The original engines are offset rather than perfect mirror images, so a single mirrored ring was misaligned. The new lattice follows separate engine bounds and is smaller than the outer cowl envelope.
- A320 secondary stay motion remains approximate. All bay-internal hardware, including generically named NurbsPath hoses, is explicitly masked once enclosed at full retraction; the doors remain visible. Runtime uses absolute transforms on every frame, disables culling for moving parts, and restores hardware on extension. The same final stow treatment is baked into the native Gear clip with scale channels. This prevents enclosed links protruding through closed bays; it does not turn the simplified linkages into a full constraint simulation.
- Studio close-up views now include Cockpit and Door window for checking both treatments.

### Shared adaptations

Data-only AC3D conversion retains named exterior parts, face UVs and source materials. Added PBR material parameters, glass/decals handling, standard glTF mechanism clips, runtime lighting and cabin glow. The 737's coincident inner glazing layer is omitted from the exterior-only export. A320 fence tips are omitted in favor of sharklets; alternate spinning fan discs and the undeployed RAT are omitted from the exterior exports. No third-party source scripts are executed. PNG ancillary color/profile metadata is stripped for glTF portability without altering compressed image pixel data.

The original assets and their adaptations are supplied with their **GPL-2.0 source notices**. Preserve those notices and provide corresponding source with redistributed adapted asset files. Airline/trade names and markings identify the depicted liveries. Manufacturer PDF documents are reference material and are not part of the portable redistributed asset package.

## Build / checks

```sh
# Palette and emission-mask generation use the Python environment with PIL/numpy.
python3 scripts/refine_southwest_palette.py
python3 scripts/create_airliner_window_mask.py
npm run build:airliners
npm run validate:airliners
python3 scripts/package_airliners.py
```

`build:airliners` converts the pinned data using the installed Blender app, bakes native animation channels and normalizes PNG metadata. The asset reader executes no source-repository code. Raw downloads and exact Git blob identifiers are recorded in the upstream download manifests.

Validation checks all nine GLBs, resolves source texture dependencies, verifies five native clips, tests finite scale-preserving mechanism transforms, independently imports the geometry/animation in Three.js, checks length/span within 0.5% of the cited references, and verifies that each native nose-gear animation retracts upward. It also runs 12 actual-controller gear cycles per asset, including interrupted reversals at variable frame rates, checks exact endpoint repeatability, checks the dedicated cockpit material, and tests cabin/door illumination on/off. Native clips get a separate cycle test. Browser review covers paint maps, close-up flaps/reversers, gear states and night lighting. Passing those checks does not establish full mechanical collision clearance or flightworthiness.

See `validation-summary.json` for measured values. The portable bundle is `releases/airliners.zip` at the workspace root.

## SFO fleet expansion — captured inventory build

The captured inventory has **142 reported aircraft/operator/paint combinations mapped to 138 unique GLBs across 62 airframe entries**. Aliased reported type codes can share an export. All selected exports pass automated validation. The final review pass supplies eight views for every selected export (1,104 images on 35 contact sheets): overview, opposite side, front, rear, plan, deployed mechanisms, fully stowed gear, and cabin lighting. Review records are tied to GLB and image hashes. **Eight-view reviewed** records exterior inspection at the saved render resolution; it does not certify exact registration paint, every close-up contour or engineering mechanism clearance. The earlier `releases/airliners.zip` remains the nine-asset release described above. The expanded handoff is `releases/sfo-fleet-2026-11-11.zip`; its package manifest distinguishes the captured fleet from the five additional legacy exports retained for the original viewer defaults.

`traffic/2026-11-11-build-inventory.json` includes **848 unique operating flights** from two official snapshot intervals, **00:01–14:00 and 17:00–23:59 local** on November 11, 2026. Codeshares are excluded from this count. The independently attributed AeroPattern log contains **998 dated event/schedule rows**, supplemented by public receiver-board entries and registration identifications. These sources overlap: their counts must not be summed. Scheduled assignments retain that meaning and are not all confirmed movements. The afternoon gap and unpublished/private movements prevent a claim that this is every actual SFO operation. The asset checklist is `sfo-build-coverage.json`; source eras and pending detail reviews remain explicit.

The newer additions include Virgin Atlantic 787-9, TAP A330-900, Frontier Chopper A321neo, Citation X, King Air 350/B200/C90, PC-12, Epic E1000, additional private-jet families and REACH/CALSTAR EC135 studies. TAP uses an adapted A330 airframe, original neo tips and an original Trent 7000 exterior built from the station sections in Airbus A330 AC December 2025, figure 2-12-0-991-027-A01. The borrowed Trent 1000 assembly has been removed. Fans, pylon fairings and cascade engineering remain authored visualization details. The REACH helicopter uses a P2-family source for a reported P3 aircraft. Several private-aircraft paints are representative, not exact-tail reproductions. Virgin's source registration is G-VZIG; it is not the G-VCRU registration identified for the captured flight.

Frontier Chopper uses an original shark bitmap generated with the built-in image generation tool. It approximates the real motif. The [saved decal](preparation/brand-art/frontier-chopper-shark-original.png) and [exact final prompt/asset record](preparation/brand-art/frontier-chopper-shark-original.asset.json) are preserved for reuse.

### United 767 proportion and paint correction

The 767-300ER retains Boeing's **54.94 m** length and approximately **5.41 m** vertical body section. Its transverse stations now preserve **5.03 m** body width and **50.9 m** span with winglets. The earlier global span calibration narrowed the body and incorrectly used the **47.57 m baseline-wing** reference for a winglet-equipped model. The correction maps body, wing and winglet transverse stations separately, including mechanism pivots and light positions; it does not shorten the aircraft. See Boeing D6-58328 Rev K section 2.2.2 and the [Boeing/APB winglet span table](https://www.boeing.com/content/dam/boeing/v2/airports/faq/wingletspans.pdf).

United now uses the GPL source author's **exact-mesh 2019 repaint**, preserving the curved belly stripe, correctly proportioned lettering, tail globe and panel markings. The N656UA source registration is retained as representative paint. `scripts/refine_767_livery.py` darkens reviewed passenger-pane interiors while preserving the upstream image. Native `Glass_Front` is classified as cockpit glazing, so cabin illumination cannot light it. Daylight review renders explicitly switch off cabin emission; source scenes store a mask strength for runtime control and previously produced pale profile panes when that strength was left on.

The expanded converter is `scripts/build_fleet_aircraft.py`, driven by `fleet-build-config.json`. `scripts/run_fleet_builds.py` builds selected families sequentially and retains failures in `build-progress.json` and `build-logs/`. `scripts/update_fleet_catalog.py` exposes existing exports. `scripts/validate_fleet.mjs` produces `fleet-validation-summary.json`; `scripts/update_fleet_coverage.py` reconciles exports with the captured traffic list. Rebuilds must be baked and checked before review:

```sh
python3 scripts/run_fleet_builds.py a319 a320 a321 a21n
node scripts/bake_airliner_animations.mjs
python3 scripts/normalize_airliner_pngs.py
node scripts/validate_fleet.mjs
python3 scripts/update_fleet_catalog.py
python3 scripts/update_fleet_coverage.py
```

The newer 777 source is `franck-vmd/Boeing-777-Flightgear`, pinned in `preparation/Boeing-777-Flightgear/repository.json`, with its root GPL license and selected data preserved. This is separate from the older 777 candidate whose exterior license was unresolved. The maintained `IskenderWang/787-family` source supplies distinct -8/-9/-10 geometry and GEnx/Trent engine options. Repaint compatibility is verified against the author's documented aircraft family; a familiar airline name is insufficient to establish UV compatibility.

### Reusable modeling and conversion lessons

- Resolve the entire assembly, including XML wrappers that contain animations but no mesh, includes with `omit-node`, property aliases and per-engine parameter overlays. These are data, not a reason to execute simulator scripts.
- Identify parts with assembly-scoped IDs. Repeated source names such as `cylinder` must not bind unrelated gear or engine parts. Named animation nodes also create groups: a tire can inherit retraction through its named wheel-spin group even though tire spin itself is not exported.
- Select physical options before measuring. Fences and sharklets can be controlled by simulator proxy properties rather than the repaint's public flag. Including both and then shrinking the span hides a configuration error. Use the matching span for each selected configuration.
- A livery texture must reach shared tail, door and nacelle components. Several source component XML files rely on the parent material state. The converter supports explicit texture-property overrides for the common paint atlas, preserving separate wing, wheel and fan maps.
- Use a dedicated smoke-tinted cockpit material. Neutral transparency alone is insufficient evidence of a cabin pane: nav lenses, landing-light covers and simulator halos must not illuminate with the passenger cabin.
- Fill actual open glazing boundaries when possible, retaining every source outline vertex. Screen for location, aspect ratio and topology. Door handle recesses and bay openings are not passenger windows. A painted window instead needs a UV-aligned emission mask; connected-component detections are only candidates until visually reviewed.
- The MAX 9 template has four distinct round door viewing windows. Their reviewed neutral-map regions are preserved in the MAX emission mask. Generic dark-component detection also found drains and lettering; those detections were not accepted as windows.
- Upstream syntax can be malformed. Retain the original bytes and document narrowly scoped repairs. The selected PW1100G AC file declares nine root children but supplies eight; parsing preserves those eight and never waits forever for an absent ninth. Other truncated or malformed files fail explicitly.
- A mislabeled variant is not a new airframe. The selected source's `737-8.ac` repeats the MAX 9 part positions. The MAX 8 draft is constructed with explicit forward/aft plug removal, preserving wing geometry and remapping gear pivots. Boeing D6-38A004 Rev K drawings 2.2.2/2.2.3 give 39.47/42.11 m lengths, 35.92 m spans, a 1.58 m forward difference and a 1.06 m aft difference. Nacelle fronts and 4.82 m centerline offsets are checked separately. These are airport-planning drawings with stated ±6 inch accuracy, not production CAD.
- Paint transfer retains destination geometry, hinges and UVs. The experimental surface-coordinate workflow uses cylindrical fuselage and planar fin charts to rasterize licensed donor artwork into portable target maps. Check registration markings, door alignment, cheatline seams, engine finish and cabin masks before accepting a transfer. Operator-specific engine paint is tracked separately and must not be implied by a successful fuselage transfer.
- Small envelope corrections are recorded, never treated as proof of surface accuracy. An enhanced-winglet E175 is not covered by the legacy-winglet prototype; a passenger 767 is not a freighter merely because its windows disappear from a texture. Business jets and helicopter types likewise require their actual geometry and operator evidence.

The broader build includes passenger and cargo families, business aircraft and rotorcraft. REACH and CALSTAR EC135 studies represent the captured medical-helicopter assignments. The earlier Coast Guard MH-65E candidate is not counted as a completed export in this captured inventory. A regional candidate or an old repaint is not silently counted as today's accepted aircraft.

For an airport scene with many simultaneous aircraft, add LODs, shared geometry/material caching and texture budgets after exterior review. These inspection exports are not yet a performance-tuned airport traffic library.

### Exterior refinement pass

- The 757-200/-300 now carry separate physical APB winglets and the 41.1 m winglet span. A transverse station map preserves the inboard body section; adding tips is not implemented by widening the fuselage. United's retained 757 source paint is the globe era, not a verified current repaint.
- A220 inlet-lip faces have their own metallic material, leaving painted cowls independent. Air Canada's tail roundel is a fitted decal on black fin paint, instead of a distorted donor atlas. Fan blade colors are independent of cowl paint.
- The 787 fan/liner finishes are independent of the operator nacelle paint; simulator blur discs are omitted. CRJ200 simulator halo billboards are omitted while runtime light fixtures remain.
- G500/G650 pressure-shell widths use separate EASA section references. Challenger 300/350 sections follow the 2.34 m manufacturer drawing and circular section; G450's approximately 2.43 m exterior section is measured from the manufacturer front view. These changes do not rescale the wings.
- Global 6000 now uses the pinned GPL Global-family exterior, with an explicit 0.80 m cabin insertion and added panes, rather than a scaled Gulfstream loft. NetJets registration patches and VistaJet silver/red paint are recorded separately. VistaJet text uses fitted surface decals to avoid overlapping source UV islands. The native source's unloaded height and small variant fittings remain approximate.
- Global 7500 cabin glazing uses fifteen port-side panes from the manufacturer exterior reference. Pane stations, exact tail fittings and operator stripes are authored approximations. It remains an exterior study, as do the other section-authored private-aircraft props.

Reuse lessons: measure body and wing sections independently; separate raw source paint, unpainted engine parts and cabin emission; inspect both paint sides and gear-up views; rebuild before baking clips, then bind validation and review evidence to the final GLB hash. A source-scene render is visual evidence for that scene, while the independent Three.js import and controller-cycle tests verify the exported geometry and motion separately. Browser visual testing was unavailable for this pass.
