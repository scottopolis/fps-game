# Factory — modern warfare FPS

A browser first-person shooter built on three.js. You hold an abandoned factory hall with an M4A1 against waves of
AKM riflemen. It is a standalone project and is not part of the pnpm workspace.

```sh
cd games/fps
pnpm install --ignore-workspace
pnpm --ignore-workspace exec vite        # dev server
pnpm --ignore-workspace exec vite build  # static build in dist/
```

Controls: WASD move, Shift sprint, Space jump, left mouse fire, E aim down sights or scope, R reload, G frag grenade, 1/2/3 or Q switch weapon. Walk up to a weapon to pick it up: the pistol lies on a barrel near the start and the sniper rifle on the HESCO barriers mid-hall.

## Code

| File | Owns |
| --- | --- |
| `src/assets.js` | Loading models, sounds and the sky; PBR materials |
| `src/level.js` | The factory hall, the cover placed in it, and its collision geometry |
| `src/weapon.js` | One animated first-person gun, built from a spec: fire, recoil, aiming or scope, reload, draw, holster |
| `src/arsenal.js` | The weapon table (M4A1, pistol, sniper rifle), the pickups lying in the level, and switching between owned guns |
| `src/grenades.js` | Frag grenades: flight, bounces, fuse |
| `src/enemies.js` | Riflemen: route finding, line of sight, bursts, hitboxes |
| `src/ik.js` | Two-bone arm IK that puts enemy hands on their rifles |
| `src/fx.js` | Tracers, muzzle flashes, impacts, explosions, positional audio |
| `src/main.js` | Renderer, player controller, input, waves, score, radar, HUD |

`window.game` exposes the live objects and `step(dt)` for checks from the console.

## Asset credits

| Asset | Source | Licence |
| --- | --- | --- |
| AKM, shipping container, HESCO barrier | OpenGameArt | CC0 |
| Player hands, M4 and its animations: "M4 - FPS Weapon Animations Pack (v.1)" by BarcodeGames (https://sketchfab.com/3d-models/m4-fps-weapon-animations-pack-v1-662fc74dda2646cfb48fc610705768ef) | Sketchfab | CC-BY-4.0 |
| Pistol and sniper rifle with their hands and animations: "Animated Pistol" (https://sketchfab.com/3d-models/animated-pistol-30d1b612b2334a8294b02692b8c10cf1) and "Sniper Animated" (https://sketchfab.com/3d-models/sniper-animated-eae1ba5b43ae4bc89b0647fb5d8a2d27) by DJMaesen | Sketchfab | CC-BY-4.0 |
| Road barrier, barrels, covered car, jerrycan, ammo box, utility box, trash can, crate | Poly Haven | CC0 |
| Concrete texture; `kloofendal_48d_partly_cloudy_puresky` sky | Poly Haven | CC0 |
| Rifle, pistol and sniper shots (Free Firearm Sound Library), reload, grunts, footsteps, impacts, wind | OpenGameArt | CC0 |
| Map: "old factory FREE" by dasy444 (https://sketchfab.com/3d-models/old-factory-free-9d0acdbe78944c098689c0d34853e57b) | Sketchfab | Sketchfab Standard, which is not Creative Commons — check its terms before redistributing |
| Enemy soldier mesh: "Federation" by #3D $Resource$ (https://sketchfab.com/3d-models/federation-745a08d7b90941f1aa4ea2e9a34b315e) | Sketchfab | Listed as CC-BY-4.0; the mesh appears to originate from Call of Duty: Ghosts, so treat it as personal-use only |
| Enemy skeleton and Idle/Run/Walk animations: `Soldier.glb` | three.js examples (Mixamo rig) | Not verified — check before redistributing |

The Federation mesh ships unrigged. `soldier.glb` was produced by fitting the Mixamo skeleton to it in Blender and weighting each vertex by distance to the bones.

`m4_fp.glb` is the Sketchfab pack converted with `gltf-transform metalrough`, `resize` to 1024 px and `webp`. The grenade explosion sound is synthesised in `fx.js`.

`factory.glb` is the Sketchfab map with its textures converted by `gltf-transform webp`; the game draws it at twice
its modelled size. `factory_collision.glb` is what the player, bullets and enemies collide with: the hall's shell plus
one box per fitting. Rebuild it after changing the map:

```sh
blender -b --python-exit-code 1 -P tools/level_collision.py -- <source map>.glb $PWD/public/assets/models/factory_collision.glb
```

The player has 250 health, shown by the life meter, and regenerates after five seconds without being hit.
