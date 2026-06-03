PoliticalJunkin's Election Night Overhaul
Version 1.1
Author: PoliticalJunkin

PoliticalJunkin's Election Night Overhaul is an NW/Executive mod for The Political Process that upgrades election-night map visuals while preserving the game's original county election engine.

Features
- Election-night map visuals for statewide races.
- New Hampshire and Massachusetts municipality map layers.
- Municipality estimates based on local baseline plus live county movement.
- County internals remain the source of truth.
- U.S. House state hover tooltip with delegation composition and seat flips.
- Live vote, lead-change, map-fill, and projection animations.
- Light and dark election-night themes.

Municipality Model
Municipalities are a visual subdivision layer only. They do not replace counties and they do not run a separate election engine.

Municipality estimate = municipality baseline + live county movement

This keeps The Political Process stable while allowing Massachusetts and New Hampshire to display town and city level election-night visuals.

Installation
1. Make sure The Political Process is installed.
2. Make sure the Executive/NW mod loader setup required by your TPP install is available.
3. Place the folder named politicaljunkins-election-night-overhaul here:

   C:\Program Files (x86)\Steam\steamapps\common\The Political Process\modFiles\

4. The installed folder should contain manifest.json, main.js, tooltip.js, data, styles, and third-party.
5. Launch The Political Process and enable/load the mod through the mod loader menu if your setup requires it.

Notes
- Counties remain the game's internal election source of truth.
- Massachusetts and New Hampshire municipalities are visual estimates.
- This mod does not replace the native county reporting system.
- This mod does not create a separate municipality election framework.
