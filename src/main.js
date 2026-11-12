import * as THREE from 'three'
import { Octree } from 'three/addons/math/Octree.js'
import { Capsule } from 'three/addons/math/Capsule.js'
import { loadAssets } from './assets.js'
import { buildLevel } from './level.js'
import { createFx } from './fx.js'
import { createWeapon } from './weapon.js'
import { createEnemies } from './enemies.js'
import { createGrenades } from './grenades.js'

const GRAVITY = 26
const EYE = 1.62
const MAX_HEALTH = 250
const $ = (id) => document.getElementById(id)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.9
document.body.prepend(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.03, 600)
camera.rotation.order = 'YXZ'
scene.add(camera)
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

const assets = await loadAssets()
// Indoors: the sky only gives a dim ambient fill, and one overhead light stands in for the ceiling lamps.
scene.environment = assets.sky
scene.environmentIntensity = 0.3
scene.background = new THREE.Color(0x0c0d0f)
scene.fog = new THREE.Fog(0x0c0d0f, 25, 110)
const LAMPS = new THREE.Vector3(0.18, 1, 0.1).normalize()
const lamps = new THREE.DirectionalLight(0xffe6c4, 2.2)
lamps.castShadow = true
lamps.shadow.mapSize.set(2048, 2048)
lamps.shadow.bias = -0.0004
lamps.shadow.normalBias = 0.03
Object.assign(lamps.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35, near: 1, far: 120 })
scene.add(lamps, lamps.target, new THREE.HemisphereLight(0x8f8a80, 0x6b665e, 0.7))

const level = buildLevel(scene, assets)
const octree = new Octree().fromGraphNode(level.solid)
const fx = createFx(scene, camera, assets.sounds)

// --- Player -----------------------------------------------------------------------------------------
const start = level.playerStart
const body = new Capsule(new THREE.Vector3(start.x, 0.35, start.z), new THREE.Vector3(start.x, EYE, start.z), 0.35)
const velocity = new THREE.Vector3()
const look = { yaw: level.playerYaw, pitch: 0 }
const keys = new Set()
const mouse = { fire: false, aim: false }
const player = { eye: camera.position, sprinting: false, health: MAX_HEALTH, hurtAt: -10, damage }
let onFloor = false
let stride = 0
let playing = false
let clock = 0
let wave = 0
let kills = 0
let score = 0
let grenades = 4
let popupTimer = 0
let nextWaveAt = 2

function damage(amount) {
  if (player.health <= 0) return
  player.health -= amount
  player.hurtAt = clock
  if (Math.random() < 0.4) fx.play('impact_flesh', { volume: 0.6 })
  if (player.health <= 0) {
    playing = false
    document.exitPointerLock()
    $('prompt').textContent = `KILLED IN ACTION — wave ${wave}, ${kills} kills, ${score} points. Click to redeploy.`
    $('overlay').style.display = 'flex'
    $('overlay').onclick = () => location.reload()
  }
}

const enemies = createEnemies({ scene, models: assets.models, fx, level, player })
const weapon = createWeapon({
  camera,
  model: assets.models.m4_fp,
  fx,
  targets: () => [...level.colliders, ...enemies.hitboxes],
  onHit(hit, direction) {
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
    if (hit.object.userData.enemy) {
      fx.puff(hit.point, direction.clone().negate(), 0x7a0c0c, 0.45)
      fx.play('impact_flesh', { at: hit.point, volume: 0.8 })
      if (enemies.damage(hit.object)) award(hit.object.userData.head ? 150 : 100, hit.object.userData.head ? 'HEADSHOT' : 'KILL')
      $('hitmarker').style.opacity = 1
      setTimeout(() => { $('hitmarker').style.opacity = 0 }, 90)
      return
    }
    const { surface, proxy } = hit.object.userData
    fx.puff(hit.point, normal, surface === 'metal' ? 0xd8d2c4 : 0x9a938a)
    if (!proxy) fx.hole(hit.point, normal)
    if (Math.random() < 0.5) fx.play(`impact_${surface}`, { at: hit.point, volume: 0.5 })
  },
})

const frags = createGrenades({
  scene,
  fx,
  level,
  /** Kills enemies within 6 m, wounds them out to 10 m, and hurts the player if they stand too close. */
  onExplode(point) {
    for (const box of enemies.hitboxes.filter((hitbox) => !hitbox.userData.head)) {
      const distance = box.userData.enemy.root.position.distanceTo(point)
      const hits = distance < 6 ? 3 : distance < 10 ? 1 : 0 // three body hits kill
      for (let i = 0; i < hits; i++) {
        if (!enemies.damage(box)) continue
        award(100, 'FRAG KILL')
        break
      }
    }
    const distance = camera.position.distanceTo(point)
    if (distance < 9) damage(130 * (1 - distance / 9))
  },
})

function throwGrenade() {
  if (grenades === 0 || !weapon.stow(() => {
    const aim = camera.getWorldDirection(new THREE.Vector3())
    frags.throw(camera.position.clone().addScaledVector(aim, 0.5), aim)
  })) return
  grenades--
}

/** Scores a kill and flashes it under the crosshair. */
function award(points, label) {
  kills++
  score += points
  $('popup').textContent = `${label} +${points}`
  $('popup').style.opacity = 1
  clearTimeout(popupTimer)
  popupTimer = setTimeout(() => { $('popup').style.opacity = 0 }, 1200)
}

addEventListener('keydown', (event) => {
  keys.add(event.code)
  if (event.code === 'KeyR' && playing) weapon.reload()
  if (event.code === 'KeyG' && playing && !event.repeat) throwGrenade()
})
addEventListener('keyup', (event) => keys.delete(event.code))
addEventListener('mousedown', (event) => { if (playing) mouse[event.button === 2 ? 'aim' : 'fire'] = true })
addEventListener('mouseup', (event) => { mouse[event.button === 2 ? 'aim' : 'fire'] = false })
addEventListener('contextmenu', (event) => event.preventDefault())
addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== renderer.domElement) return
  const sensitivity = 0.0022 * (1 - weapon.ads * 0.45)
  look.yaw -= event.movementX * sensitivity
  look.pitch -= event.movementY * sensitivity
})
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement || player.health <= 0) return
  playing = false
  $('prompt').textContent = 'Paused — click to resume'
  $('overlay').style.display = 'flex'
})
$('prompt').textContent = 'Click to deploy'
$('overlay').onclick = () => {
  $('overlay').style.display = 'none'
  playing = true
  renderer.domElement.requestPointerLock()?.catch?.(() => {})
  fx.listener.context.resume()
  if (clock === 0) fx.play('wind', { volume: 0.35, loop: true })
}

function movePlayer(dt) {
  const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0)
  const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
  player.sprinting = keys.has('ShiftLeft') && forward > 0 && !mouse.aim
  const acceleration = (onFloor ? (player.sprinting ? 42 : mouse.aim ? 14 : 27) : 5) * dt
  const sin = Math.sin(look.yaw)
  const cos = Math.cos(look.yaw)
  const length = Math.hypot(forward, strafe) || 1
  velocity.x += ((-sin * forward + cos * strafe) / length) * acceleration
  velocity.z += ((-cos * forward - sin * strafe) / length) * acceleration
  if (onFloor && keys.has('Space')) velocity.y = 7.2

  let damping = Math.exp(-4 * dt) - 1
  if (!onFloor) {
    velocity.y -= GRAVITY * dt
    damping *= 0.1
  }
  velocity.addScaledVector(velocity, damping)
  body.translate(velocity.clone().multiplyScalar(dt))
  const contact = octree.capsuleIntersect(body)
  onFloor = false
  if (contact) {
    onFloor = contact.normal.y > 0.5
    if (!onFloor) velocity.addScaledVector(contact.normal, -contact.normal.dot(velocity))
    else velocity.y = Math.max(velocity.y, 0)
    if (contact.depth >= 1e-10) body.translate(contact.normal.multiplyScalar(contact.depth))
  }
}

function updateHud() {
  $('mag').textContent = weapon.reloading ? '--' : weapon.mag
  $('grenades').textContent = `FRAG × ${grenades}`
  $('score').textContent = score
  drawRadar()
  $('reserve').textContent = `/ ${weapon.reserve}`
  $('wave').textContent = `WAVE ${wave} · ${enemies.alive} HOSTILE · ${kills} KILLS`
  const life = THREE.MathUtils.clamp(player.health / MAX_HEALTH, 0, 1)
  $('hp').textContent = Math.ceil(life * MAX_HEALTH)
  $('health').firstElementChild.style.width = `${life * 100}%`
  $('life').classList.toggle('low', life < 0.3)
  $('vignette').style.opacity = Math.min(1, (1 - life) * 1.2 + Math.max(0, 0.5 - (clock - player.hurtAt)))
  $('crosshair').style.opacity = weapon.ads > 0.5 || weapon.reloading ? 0 : 0.8
}

/** Minimap: the player at the centre facing up, hostiles as red dots within 45 m (pinned to the rim beyond). */
const radar = $('radar').getContext('2d')
function drawRadar() {
  const sin = Math.sin(look.yaw)
  const cos = Math.cos(look.yaw)
  radar.clearRect(0, 0, 150, 150)
  radar.strokeStyle = 'rgba(255,255,255,0.25)'
  for (const radius of [35, 70]) {
    radar.beginPath()
    radar.arc(75, 75, radius, 0, Math.PI * 2)
    radar.stroke()
  }
  radar.fillStyle = '#e8e6df'
  radar.beginPath()
  radar.moveTo(75, 68)
  radar.lineTo(80, 80)
  radar.lineTo(70, 80)
  radar.fill()
  radar.fillStyle = '#e03a2f'
  for (const enemy of enemies.list) {
    if (enemy.dead > 0) continue
    const dx = enemy.root.position.x - camera.position.x
    const dz = enemy.root.position.z - camera.position.z
    const scale = Math.min(70 / 45, 70 / Math.hypot(dx, dz))
    radar.beginPath()
    radar.arc(75 + (dx * cos - dz * sin) * scale, 75 + (dx * sin + dz * cos) * scale, 3, 0, Math.PI * 2)
    radar.fill()
  }
}

function announce(text) {
  $('message').textContent = text
  $('message').style.opacity = 1
  setTimeout(() => { $('message').style.opacity = 0 }, 2600)
}

function step(dt) {
  clock += dt
  for (let i = 0; i < 4; i++) movePlayer(dt / 4)
  look.pitch = THREE.MathUtils.clamp(look.pitch, -1.5, 1.5)
  camera.position.copy(body.end)
  camera.rotation.set(look.pitch, look.yaw, 0)

  const speed = Math.hypot(velocity.x, velocity.z)
  if (onFloor) stride += speed * dt
  if (stride > (player.sprinting ? 2.5 : 2)) {
    stride = 0
    fx.play(`step${1 + Math.floor(Math.random() * 6)}`, { volume: 0.3, detune: (Math.random() - 0.5) * 200 })
  }
  weapon.update(dt, { fire: mouse.fire && !player.sprinting, aim: mouse.aim, sprinting: player.sprinting, speed, look })
  enemies.update(dt)
  frags.update(dt)
  fx.update(dt)

  if (clock - player.hurtAt > 5) player.health = Math.min(MAX_HEALTH, player.health + 40 * dt)
  if (enemies.alive === 0 && nextWaveAt === 0) {
    nextWaveAt = clock + 4
    weapon.reserve = Math.min(210, weapon.reserve + 60)
    grenades = Math.min(4, grenades + 2)
    announce('AREA CLEAR — RESUPPLIED')
  }
  if (nextWaveAt > 0 && clock >= nextWaveAt) {
    nextWaveAt = 0
    wave++
    enemies.spawnWave(Math.min(3 + wave * 2, 14))
    announce(`WAVE ${wave}`)
  }
  lamps.target.position.copy(camera.position)
  lamps.position.copy(camera.position).addScaledVector(LAMPS, 60)
}

const timer = new THREE.Timer()
renderer.setAnimationLoop((time) => {
  timer.update(time)
  if (playing) step(Math.min(timer.getDelta(), 0.05))
  else camera.rotation.set(look.pitch, look.yaw, 0)
  updateHud()
  renderer.render(scene, camera)
})
camera.position.copy(body.end)

// For automated checks and debugging from the console.
window.game = { throwGrenade, get score() { return score }, camera, body, look, player, weapon, enemies, level, keys, mouse, step, scene }
