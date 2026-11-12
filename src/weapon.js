import * as THREE from 'three'

const FIRE_INTERVAL = 60 / 750
const RELOAD_SPEED = 1.5
const SIGHT = new THREE.Vector3(-6.02, 152.9, -5) // the rear sight, in the rifle mesh's own units
const SIGHT_DISTANCE = 0.12 // how far ahead of the eye the rear sight sits when aiming
const MUZZLE = new THREE.Vector3(0.05, -0.065, -0.56) // in the holder's space
const SPRINT = { position: new THREE.Vector3(0, -0.03, 0), rotation: new THREE.Euler(-0.15, 0.5, 0.15) }
const smooth = (t) => t * t * (3 - 2 * t)

/**
 * The player's M4: animated hands and rifle, automatic fire, recoil, aiming down sights, and reloading.
 * `model` is the rigged hands-and-rifle pack with Draw, Fire, Reload, Reload_Empty and Holster clips.
 * `targets()` returns the meshes bullets can hit; `onHit(hit, direction)` receives each impact.
 */
export function createWeapon({ camera, model, fx, targets, onHit }) {
  const holder = new THREE.Group()
  camera.add(holder)
  holder.add(model)
  model.traverse((node) => {
    if (node.isMesh) Object.assign(node, { frustumCulled: false, castShadow: false })
  })
  // The pack is authored around its own camera joint; put that joint on our camera.
  holder.updateMatrixWorld(true)
  const eye = model.getObjectByName('FPS_Camera_j_01')
  model.quaternion.copy(eye.getWorldQuaternion(new THREE.Quaternion()).premultiply(holder.getWorldQuaternion(new THREE.Quaternion()).invert()).invert())
  model.position.copy(holder.worldToLocal(eye.getWorldPosition(new THREE.Vector3()))).applyQuaternion(model.quaternion).negate()

  // The clips sit one after another on a shared timeline; move each to start at zero.
  const mixer = new THREE.AnimationMixer(model)
  const actions = {}
  for (const clip of model.animations) {
    const start = Math.min(...clip.tracks.map((track) => track.times[0]))
    clip.tracks.forEach((track) => track.shift(-start))
    clip.resetDuration()
    actions[clip.name] = mixer.clipAction(clip).setLoop(THREE.LoopOnce)
    actions[clip.name].clampWhenFinished = true
  }

  const raycaster = new THREE.Raycaster()
  raycaster.far = 400
  const direction = new THREE.Vector3()
  const origin = new THREE.Vector3()
  const rifle = model.getObjectByName('Main_M4_D_0')
  const sight = new THREE.Vector3()
  const sprintQ = new THREE.Quaternion().setFromEuler(SPRINT.rotation)
  const weapon = { holder, mag: 30, reserve: 150, ads: 0, reloading: false, update, reload, stow }
  let current = null
  let busy = 0 // seconds until the running draw, reload or stow finishes; no firing meanwhile
  let after = null
  let cooldown = 0
  let kick = 0 // extra view model recoil, decays every frame
  let bob = 0
  let run = 0

  function start(name, speed = 1) {
    current?.stop()
    current = actions[name]
    current.timeScale = speed
    current.reset().play()
    return current.getClip().duration / speed
  }

  function play(name, speed, then = null) {
    busy = start(name, speed)
    after = then
  }

  function reload() {
    if (busy > 0 || weapon.mag === 30 || weapon.reserve === 0) return
    weapon.reloading = true
    fx.play('reload', { volume: 0.7 })
    play(weapon.mag === 0 ? 'Reload_Empty' : 'Reload', RELOAD_SPEED, () => {
      const loaded = Math.min(30 - weapon.mag, weapon.reserve)
      weapon.mag += loaded
      weapon.reserve -= loaded
      weapon.reloading = false
    })
  }

  /** Lowers the rifle, calls `whenDown` while the hands are out of view, then raises it again. */
  function stow(whenDown) {
    if (busy > 0) return false
    play('Holster', 2, () => {
      whenDown()
      play('Draw', 2)
    })
    return true
  }

  function shoot(look, speed) {
    weapon.mag--
    cooldown = FIRE_INTERVAL
    start('Fire')
    const spread = THREE.MathUtils.lerp(0.022, 0.002, weapon.ads) + speed * 0.002
    camera.updateMatrixWorld()
    camera.getWorldPosition(origin)
    direction.set((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, -1).normalize()
      .transformDirection(camera.matrixWorld)
    raycaster.set(origin, direction)
    const hit = raycaster.intersectObjects(targets(), false)[0]
    const end = hit ? hit.point : origin.clone().addScaledVector(direction, 300)
    fx.tracer(holder.localToWorld(MUZZLE.clone()), end)
    fx.flash(MUZZLE, 0.16, holder)
    fx.play('m4_shot', { volume: 0.8, detune: (Math.random() - 0.5) * 120 })
    if (hit) onHit(hit, direction)
    // Recoil climbs and wanders; aiming down sights steadies it.
    const steady = 1 - weapon.ads * 0.45
    look.pitch += 0.011 * steady
    look.yaw += (Math.random() - 0.5) * 0.008 * steady
    kick = 1
  }

  /** Advances the weapon. `look` is the camera's `{ yaw, pitch }`, which recoil pushes. */
  function update(dt, { fire, aim, sprinting, speed, look }) {
    cooldown -= dt
    if (busy > 0 && (busy -= dt) <= 0) {
      const done = after
      after = null
      done?.()
    }
    if (weapon.mag === 0 && fire) reload()
    if (fire && cooldown <= 0 && weapon.mag > 0 && busy <= 0) shoot(look, speed)
    mixer.update(dt)

    const wantAds = aim && busy <= 0 ? 1 : 0
    weapon.ads += (wantAds - weapon.ads) * Math.min(1, dt * 14)
    camera.fov = THREE.MathUtils.lerp(72, 46, smooth(weapon.ads))
    camera.updateProjectionMatrix()

    kick = Math.max(0, kick - dt * 9)
    bob += dt * speed * 1.9
    run += ((sprinting && busy <= 0 ? 1 : 0) - run) * Math.min(1, dt * 9)
    const sway = (1 - weapon.ads * 0.9) * Math.min(speed / 5, 1.6)
    // Aiming slides the rig until the rear sight is on the view axis, wherever the animation has put the rifle.
    holder.worldToLocal(rifle.localToWorld(sight.copy(SIGHT)))
    holder.position.set(-sight.x, -sight.y, -sight.z - SIGHT_DISTANCE).multiplyScalar(smooth(weapon.ads)).addScaledVector(SPRINT.position, run)
    holder.position.x += Math.cos(bob * 0.5) * 0.005 * sway
    holder.position.y += Math.sin(bob) * 0.005 * sway
    holder.position.z += kick * 0.012
    holder.quaternion.identity().slerp(sprintQ, smooth(run))
  }

  play('Draw', 1)
  return weapon
}
