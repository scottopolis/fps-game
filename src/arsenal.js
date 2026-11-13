import * as THREE from 'three'
import { createWeapon } from './weapon.js'

/**
 * The guns, in slot order. `seat` puts the pack's own viewpoint on the camera. `sight` and `muzzle` are points
 * in a named node's own units. `frames` cuts a pack's single 30 fps timeline into clips.
 */
const WEAPONS = [
  {
    name: 'M4A1', model: 'm4_fp', automatic: true, interval: 60 / 750, damage: 34, magSize: 30, reserve: 150,
    spread: 0.022, aimedSpread: 0.002, recoil: 0.011, aimFov: 46, sound: 'm4_shot', flash: 0.16,
    fireSpeed: 1, reloadSpeed: 1.5, drawSpeed: 2,
    seat: { position: [-0.0109, -1.5393, 0.1006], scale: 1 },
    sight: { node: 'Main_M4_D_0', at: [-6.02, 152.9, -5] },
    muzzle: { node: 'Main_M4_D_0', at: [-6.09, 147.43, 66.06] },
  },
  {
    name: 'PISTOL', model: 'pistol_fp', automatic: false, interval: 0.16, damage: 50, magSize: 12, reserve: 48,
    spread: 0.02, aimedSpread: 0.004, recoil: 0.02, aimFov: 55, sound: 'pistol_shot', flash: 0.12,
    fireSpeed: 1.5, reloadSpeed: 1.3, drawSpeed: 1.6,
    frames: { Fire: [0, 14], Reload: [15, 69], Reload_Empty: [70, 157], Holster: [158, 170], Draw: [170, 218] },
    seat: { position: [0.062, -0.165, -0.445], pitch: -0.253, scale: 0.01 },
    sight: { node: 'slide', at: [0, 4.8, -7] },
    muzzle: { node: 'slide', at: [0, 2.5, 18.5] },
  },
  {
    name: 'SNIPER', model: 'sniper_fp', automatic: false, interval: 1.45, damage: 200, magSize: 5, reserve: 20,
    spread: 0.07, aimedSpread: 0, recoil: 0.045, aimFov: 13, scope: true, sound: 'sniper_shot', flash: 0.22,
    fireSpeed: 1.4, reloadSpeed: 1.2, drawSpeed: 1.2,
    // Firing runs on into working the bolt.
    frames: { Fire: [0, 60], Reload: [61, 115], Holster: [116, 127], Draw: [127, 142] },
    seat: { position: [0.09, -0.28, -0.5], scale: 0.01 },
    sight: { node: 'scope', at: [0, 0, -22] },
    muzzle: { node: 'base', at: [0, 3, 116] },
  },
]
const REACH = 1.6 // metres from a gun at which the player picks it up

/**
 * The player's guns. The player starts with the first and picks the others up from `pickups`
 * (`{ weapon: model name, position, turn }`) by walking up to them; `onPickup(weapon, slot)` reports each.
 * `weapon` is the gun in hand; `select(slot)` and `next()` switch between the guns owned.
 */
export function createArsenal({ scene, camera, models, fx, targets, onHit, pickups, onPickup }) {
  const weapons = WEAPONS.map((spec) => createWeapon({ camera, model: models[spec.model], spec, fx, targets, onHit }))
  const owned = new Set([weapons[0]])
  let held = weapons[0]
  let wanted = held
  held.draw()

  // A gun waiting to be picked up is its first-person pack without the arms, lying on its side.
  const lying = pickups.map(({ weapon: name, position, turn = 0 }) => {
    const weapon = weapons.find(({ spec }) => spec.model === name)
    const gun = models[name].clone()
    gun.getObjectsByProperty('isSkinnedMesh', true).forEach((arms) => arms.removeFromParent())
    gun.position.set(0, 0, 0)
    gun.rotation.set(0, 0, Math.PI / 2)
    const bounds = new THREE.Box3().setFromObject(gun)
    gun.position.sub(bounds.getCenter(new THREE.Vector3())).y += (bounds.max.y - bounds.min.y) / 2
    const object = new THREE.Group().add(gun)
    object.position.copy(position)
    object.rotation.y = turn
    scene.add(object)
    return { weapon, object }
  })

  const arsenal = {
    get weapon() { return held },
    get owned() { return weapons.filter((weapon) => owned.has(weapon)) },
    /** Where the guns not yet picked up lie. */
    get lying() { return lying.map(({ object }) => object.position) },
    /** Switches to the gun in `slot` (counted from 1) if the player owns it, as soon as the hands are free. */
    select(slot) {
      if (owned.has(weapons[slot - 1])) wanted = weapons[slot - 1]
    },
    next() {
      const list = arsenal.owned
      wanted = list[(list.indexOf(wanted) + 1) % list.length]
    },
    /** Gives every gun owned two more magazines, up to two above what it starts with. */
    resupply() {
      for (const weapon of owned) {
        const extra = 2 * weapon.spec.magSize
        weapon.reserve = Math.min(weapon.reserve + extra, weapon.spec.reserve + extra)
      }
    },
    update(dt, input) {
      const next = wanted
      if (next !== held) held.holster(() => { held = next; held.draw() }) // does nothing while the hands are busy
      held.update(dt, input)
      for (let i = lying.length - 1; i >= 0; i--) {
        const { weapon, object } = lying[i]
        if (Math.hypot(object.position.x - camera.position.x, object.position.z - camera.position.z) > REACH) continue
        object.removeFromParent()
        lying.splice(i, 1)
        owned.add(weapon)
        onPickup(weapon, weapons.indexOf(weapon) + 1)
      }
    },
  }
  return arsenal
}
