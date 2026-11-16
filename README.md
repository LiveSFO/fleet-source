# livesfo hi-fi aircraft: corresponding source

livesfo.com shows live traffic at San Francisco International in 3D. On a computer, the aircraft you select can be
drawn with a detailed model: a conversion of a community model for the FlightGear flight simulator, with its
airline paint, moving gear, flaps, spoilers, thrust reversers and fans. Those models are free software
under the GNU General Public License, and so are livesfo's conversions of them. This repository is their
corresponding source.

It covers the converted files livesfo serves under `/m/`, as listed in its index generated
2026-11-16T06:40:57.461Z: 120 liveries of 37 airframes. [SERVED.json](SERVED.json) names every served file
with its SHA-256. The rest of the website isn't part of these models: they're separate files the page loads.

**Where the files are.** This git tree holds everything but the paint maps (200 MB of PNG), the baked liveries' images (52 MB) and the redrawn paint of livesfo's liveries on the library's airframes (50 MB). The release
[`index-2026-11-16`](../../releases/tag/index-2026-11-16) holds the whole of it as one zip, paint maps included.

## How the served files are made

1. **Upstream models.** FlightGear community aircraft, GPL. The files the library used unchanged aren't
   copied here: [UPSTREAM-LINKS.json](UPSTREAM-LINKS.json) pins each one by repository, git tree, path, git blob and
   SHA-256, with a link that serves exactly that content. Each package's own notices are copied, under
   `library/sfo-aircraft-library/assets/airliners/preparation/<package>/upstream/`. Repositories:
- [YV3399/737-800YV](https://github.com/YV3399/737-800YV) (tree `9d967d89dd2e`, 129 files)
- [REXO-77/737-MAX](https://github.com/REXO-77/737-MAX) (tree `fc4316a01c1e`, 95 files)
- [omega13a/737-Next-Generation](https://github.com/omega13a/737-Next-Generation) (tree `f0cbdc58213a`, 538 files)
- [FGMEMBERS/747-400](https://github.com/FGMEMBERS/747-400) (tree `887ff4746c37`, 93 files)
- [LincolnWorks-FlightGear/747-8i](https://github.com/LincolnWorks-FlightGear/747-8i) (tree `322e77bb5a45`, 90 files)
- [FGMEMBERS/757-200](https://github.com/FGMEMBERS/757-200) (tree `873a9a12ec1a`, 81 files)
- [dogsaysmoo/767-300](https://github.com/dogsaysmoo/767-300) (tree `bc582834f42d`, 52 files)
- [FGMEMBERS/787-9](https://github.com/FGMEMBERS/787-9) (tree `f58fce9fa085`, 66 files)
- [IskenderWang/787-family](https://github.com/IskenderWang/787-family) (tree `02626b5b659d`, 119 files)
- [Bombbird2001/A320Family](https://github.com/Bombbird2001/A320Family) (tree `f30d0f9c5d35`, 558 files)
- [FGMEMBERS/A350XWB](https://github.com/FGMEMBERS/A350XWB) (tree `04da937ab1ba`, 60 files)
- [FGMEMBERS/A380-omega](https://github.com/FGMEMBERS/A380-omega) (tree `0d1e6ad7e338`, 56 files)
- [franck-vmd/Boeing-777-Flightgear](https://github.com/franck-vmd/Boeing-777-Flightgear) (tree `cfa61378d121`, 435 files)
- [FGMEMBERS/CRJ200](https://github.com/FGMEMBERS/CRJ200) (tree `4ae57306711b`, 35 files)
- [FGMEMBERS/CRJ700-family](https://github.com/FGMEMBERS/CRJ700-family) (tree `4862db2fe6e4`, 76 files)
- [GodBoyBr/CSeries](https://github.com/GodBoyBr/CSeries) (tree `867b3cc7bb06`, 47 files)
- [FGMEMBERS/E-jet-family](https://github.com/FGMEMBERS/E-jet-family) (tree `45be9f83c479`, 17 files)
- [FGDATA/IDG-A33X](https://github.com/FGDATA/IDG-A33X) (tree `1956d9b49272`, 278 files)
- [Pilot2938/Pilot2938-FG-liveries](https://github.com/Pilot2938/Pilot2938-FG-liveries) (tree `2edd25282b93`, 33 files)
- [naviat-dev/FG-Liveries](https://github.com/naviat-dev/FG-Liveries) (tree `eae9eaf1d079`, 45 files)
2. **The aircraft library** (`library/sfo-aircraft-library/`, from the SFO aircraft library's
   release `sfo-fleet-2026-11-11.zip`, SHA-256 `d71006655684689f9a51ef00f04a2415d2af3be5c52184966bd339b2b029f49a`): what it changed or
   added.
   - `assets/airliners/<airframe>/generated/`: the paint maps it made, for the converted liveries (in the release zip).
   - `assets/airliners/<airframe>/lights.json` and `exports/*.rig.json`, `*.validation.json`: the lights, the rig
     (what moves, about which axis, how far) and the checks of each export.
   - `assets/airliners/*.json`: the catalogue, the handoff manifest (each export's source packages and SHA-256), the
     build configuration and the coverage records.
   - `assets/airliners/preparation/<package>/`: each upstream package's download and tree records.
   - `assets/airliners/preparation/brand-art/`: the logos' vector sources, and for each its Wikimedia Commons page and
     licence (`*.asset.json`).
   - `scripts/`: the build scripts (Python for Blender, and Node) that fetch the upstream models, assemble and paint
     each aircraft, and export it as glTF binary (GLB).
3. **livesfo's converter** (`converter/`, GPL-2.0-or-later): `tools/fleet-sync.mjs` unpacks the library's
   release, `tools/fleet-convert.mjs` turns each export into the served files (meshopt-compressed geometry, KTX2
   textures, a glTF with the rig and lights in `extras.livesfo`).
4. **The baked liveries** (`converter/tools/fleet/bake.mjs`), when SERVED.json lists them: each library livery
   projected onto the fuselage and fin textures of livesfo's own aircraft models (which aren't part of this source),
   so the site's crowd wears the paint its detailed models show. `bakes/` holds the image each was made from, the
   preferred form for changing it. The served textures are KTX2 (ETC1S, basisu 2.50: `-mipmap -y_flip
   -comp_level 2 -q 255`): the image as it is (L), and its 2× and 4× box averages (M, S).
5. **livesfo's liveries on the library's airframes** (`converter/tools/fleet/reverse.mjs`), when SERVED.json lists
   them (`reverse`): an airline the library has the aircraft type but no paint for gets a detailed model in the
   livery livesfo's other aircraft wear (a baked library livery from another of the airline's types, or a livery
   traced from photos): one of the library's liveries of that type (the template) with its paint images redrawn, the
   fuselage and fin from that livery, the rest the template's. `reverse/` holds the redrawn images (PNG); each entry
   names its template and what it was drawn from. Those drawn from photos credit them (CC BY 4.0; the credits are part
   of the terms).

## Rebuilding

1. Put the library together: this repository's `library/`, plus each file in UPSTREAM-LINKS.json at its
   `library` path. To fetch one without GitHub's API limits: `git clone --bare --filter=blob:none https://github.com/<repository>.git`, then
   `git cat-file blob <blob>` in the clone; check the SHA-256.
2. Build the exports with the library's scripts (Blender, Python 3, Node 20 or later): see
   `library/sfo-aircraft-library/assets/airliners/README.md`, and `scripts/run_fleet_builds.py` and
   `scripts/package_sfo_fleet.py` for the whole run.
3. Convert them: in `converter/`, `npm install` (meshoptimizer 1.1.1), and basisu 2.50 for the KTX2 textures. Put the
   library's `assets/airliners/` (its records and exports) at `converter/data/fleet/src/assets/airliners/`, which
   is what `tools/fleet-sync.mjs` does from the release zip, then `node tools/fleet-convert.mjs`. Its `tools/fleet/config.mjs` holds the
   batch, the exclusions and the texture rules.

## Left out

- The King Air B200 and C90: CC BY-NC-SA, not converted.
- All Frontier liveries: their tail animals are AI-generated look-alikes. Not converted.
- The library's Blender scenes and GLB exports: build outputs of its scripts.
- The paint maps of liveries livesfo doesn't convert, and the raster copies of the brand art (their vector sources
  and Commons records are here).
- The library's files for its other, unrelated projects.
- Two lines in its packaging scripts (`package_airliners.py`, `package_sfo_fleet.py`) that removed links to unrelated
  pages from the library's own viewer page. They don't touch the models.

## Licences

- The upstream models: the GNU General Public License, version 2 ([COPYING](COPYING)); A350XWB's notice adds "or any
  later version". Each package's notices are next to its records.
- The library's paint maps, records and scripts, as adaptations of those models and the means of building them: the
  same terms.
- livesfo's liveries written onto the library's airframes (`reverse/`): the same terms as the airframe they're on. Those
  drawn from photos (b763f-ups-rb, a359-sas-rb, a21n-fft-rb, a20n-fft-rb, a320-fft-rb, a321-fft-rb, a20n-voi-rb, a21n-voi-rb, a320-voi-rb, a339-ity-rb, a35k-qtr-rb, b77w-ces-rb, b77w-csn-rb) adapt photos published under CC BY 4.0,
  which allows that with credit: each photo, its author and licence are in SERVED.json.
- livesfo's converter: GPL-2.0-or-later ([converter/LICENSE](converter/LICENSE)). Version 3's text is in
  [COPYING.GPL-3.0](COPYING.GPL-3.0), for the parts that allow later versions.
- The logos' sources (`preparation/brand-art/`): each record names its Wikimedia Commons page and licence; most are
  public domain as text logos. American Eagle's (on the converted E175) is cut from a public-domain Commons logo; its
  derived record names that source but no licence of its own.
- **Airline names, logos and liveries are trademarks of their owners.** The GPL doesn't license them. The liveries are
  recreations, not official artwork, shown only to identify the airline operating a flight; livesfo isn't affiliated
  with any airline, aircraft manufacturer or the FlightGear project. Not for navigation.

## Written offer

The upstream files the library used unchanged are linked, not copied. So that the complete source never depends on
those repositories: for at least three years after livesfo last serves the files listed in SERVED.json, livesfo will
give anyone who asks a complete machine-readable copy of their corresponding source (this repository's files together
with every file listed in UPSTREAM-LINKS.json) for no more than the cost of physically distributing it. Ask by opening
an issue on this repository.
