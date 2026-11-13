import * as THREE from 'three'

const SPRINT = { position: new THREE.Vector3(0, -0.03, 0), rotation: new THREE.Euler(-0.15, 0.5, 0.15) }
const SIGHT_DISTANCE = 0.12 // how far ahead of the eye the sight sits when aiming
const HIP_FOV = 72
const smooth = (t) => t * t * (3 - 2 * t)

/**
 * One of the player's guns: animated hands and weapon, firing, recoil, aiming down the sights and reloading.
 * `model` is a rigged first-person pack and `spec` describes it (see `WEAPONS` in arsenal.js). `targets()`
 * returns the meshes bullets can hit; `onHit(hit, direction, weapon)` receives each impact.
 * The gun starts out of view; `draw()` raises it and `holster(then)` lowers it.
 */
export function createWeapon({ camera, model, spec, fx, targets, onHit }) {
  const holder = new THREE.Group()
  holder.visible = false
  camera.add(holder)
  holder.add(model)
  model.position.fromArray(spec.seat.position)
  model.rotation.set(spec.seat.pitch ?? 0, Math.PI, 0) // the packs point their guns at +Z; some hold them tilted
  model.scale.setScalar(spec.seat.scale)
  model.traverse((node) => {
    if (node.isMesh) Object.assign(node, { frustumCulled: false, castShadow: false })
  })

  // Each animation is a span of an action's timeline, which `update` steps through by hand. A pack has either one
  // long clip holding every animation (`spec.frames` gives each one's frames at 30 fps) or a clip per animation.
  const mixer = new THREE.AnimationMixer(model)
  const spans = {}
  if (spec.frames) {
    const action = mixer.clipAction(model.animations[0])
    for (const [name, [from, to]] of Object.entries(spec.frames)) spans[name] = { action, from: from / 30, to: to / 30 }
  } else {
    for (const clip of model.animations) {
      const start = Math.min(...clip.tracks.map((track) => track.times[0]))
      clip.tracks.forEach((track) => track.shift(-start))
      clip.resetDuration()
      spans[clip.name] = { action: mixer.clipAction(clip), from: 0, to: clip.duration }
    }
  }

  const raycaster = new THREE.Raycaster()
  raycaster.far = 400
  const direction = new THREE.Vector3()
  const origin = new THREE.Vector3()
  const point = new THREE.Vector3()
  const sightNode = model.getObjectByName(spec.sight.node)
  const muzzleNode = model.getObjectByName(spec.muzzle.node)
  const sprintQ = new THREE.Quaternion().setFromEuler(SPRINT.rotation)
  const weapon = {
    spec, holder, mag: spec.magSize, reserve: spec.reserve, ads: 0, scoped: false, reloading: false,
    update, reload, stow, draw, holster,
  }
  let current = null // the animation span being shown, with `time` its position and `rate` its speed
  let time = 0
  let rate = 1
  let busy = 0 // seconds until the running draw, reload or holster finishes; no firing meanwhile
  let after = null
  let cooldown = 0
  let released = true // the trigger has been let go since the last shot
  let kick = 0 // extra view model recoil, decays every frame
  let bob = 0
  let run = 0

  /** A point given in a node's own units, in the holder's space. */
  const inHolder = (node, at) => holder.worldToLocal(node.localToWorld(point.fromArray(at)))

  function start(name, speed = 1) {
    if (current && current.action !== spans[name].action) current.action.stop()
    current = spans[name]
    current.action.play().paused = true
    time = current.from
    rate = speed
    return (current.to - current.from) / speed
  }

  function play(name, speed, then = null) {
    busy = start(name, speed)
    after = then
  }

  function reload() {
    if (busy > 0 || weapon.mag === spec.magSize || weapon.reserve === 0) return
    weapon.reloading = true
    fx.play('reload', { volume: 0.7 })
    play(weapon.mag === 0 && spans.Reload_Empty ? 'Reload_Empty' : 'Reload', spec.reloadSpeed, () => {
      const loaded = Math.min(spec.magSize - weapon.mag, weapon.reserve)
      weapon.mag += loaded
      weapon.reserve -= loaded
      weapon.reloading = false
    })
  }

  function draw() {
    holder.visible = true
    play('Draw', spec.drawSpeed)
  }

  /** Lowers the gun out of view, then calls `then`. Returns false when the gun is busy. */
  function holster(then) {
    if (busy > 0) return false
    play('Holster', spec.drawSpeed, () => {
      holder.visible = false
      then()
    })
    return true
  }

  /** Lowers the gun, calls `whenDown` while the hands are out of view, then raises it again. */
  function stow(whenDown) {
    return holster(() => {
      whenDown()
      draw()
    })
  }

  function shoot(look, speed) {
    weapon.mag--
    cooldown = spec.interval
    released = false
    start('Fire', spec.fireSpeed)
    const spread = THREE.MathUtils.lerp(spec.spread, spec.aimedSpread, weapon.ads) + speed * 0.002
    camera.updateMatrixWorld()
    camera.getWorldPosition(origin)
    direction.set((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, -1).normalize()
      .transformDirection(camera.matrixWorld)
    raycaster.set(origin, direction)
    const hit = raycaster.intersectObjects(targets(), false)[0]
    const end = hit ? hit.point : origin.clone().addScaledVector(direction, 300)
    const muzzle = inHolder(muzzleNode, spec.muzzle.at).clone()
    fx.tracer(holder.localToWorld(muzzle.clone()), end)
    if (!weapon.scoped) fx.flash(muzzle, spec.flash, holder)
    fx.play(spec.sound, { volume: 0.8, detune: (Math.random() - 0.5) * 120 })
    if (hit) onHit(hit, direction, weapon)
    // Recoil climbs and wanders; aiming down sights steadies it.
    const steady = 1 - weapon.ads * 0.45
    look.pitch += spec.recoil * steady
    look.yaw += (Math.random() - 0.5) * spec.recoil * 0.7 * steady
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
    if (!fire) released = true
    if (weapon.mag === 0 && fire) reload()
    if (fire && (spec.automatic || released) && cooldown <= 0 && weapon.mag > 0 && busy <= 0) shoot(look, speed)
    time = Math.min(time + dt * rate, current.to)
    current.action.time = time
    mixer.update(0)

    const wantAds = aim && busy <= 0 ? 1 : 0
    weapon.ads += (wantAds - weapon.ads) * Math.min(1, dt * 14)
    // A scoped gun fills the view with its scope picture (drawn by the HUD) once it is fully raised.
    weapon.scoped = Boolean(spec.scope) && weapon.ads > 0.9
    model.visible = !weapon.scoped
    camera.fov = weapon.scoped ? spec.aimFov : THREE.MathUtils.lerp(HIP_FOV, spec.scope ? 50 : spec.aimFov, smooth(weapon.ads))
    camera.updateProjectionMatrix()

    kick = Math.max(0, kick - dt * 9)
    bob += dt * speed * 1.9
    run += ((sprinting && busy <= 0 ? 1 : 0) - run) * Math.min(1, dt * 9)
    const sway = (1 - weapon.ads * 0.9) * Math.min(speed / 5, 1.6)
    // Aiming slides the rig until the sight is on the view axis, wherever the animation has put the gun.
    const sight = inHolder(sightNode, spec.sight.at)
    holder.position.set(-sight.x, -sight.y, -sight.z - SIGHT_DISTANCE).multiplyScalar(smooth(weapon.ads)).addScaledVector(SPRINT.position, run)
    holder.position.x += Math.cos(bob * 0.5) * 0.005 * sway
    holder.position.y += Math.sin(bob) * 0.005 * sway
    holder.position.z += kick * 0.012
    holder.quaternion.identity().slerp(sprintQ, smooth(run))
  }

  return weapon
}
