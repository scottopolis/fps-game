import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { armBones, reach } from './ik.js'

const SPEED = 4.2
const RADIUS = 0.45
const SPACING = 1.3 // metres enemies keep between each other
const CELL = 0.5 // route grid spacing in metres
const UNREACHED = 65535
const MUZZLE = new THREE.Vector3(0, 0.02, -0.48)
const hidden = new THREE.MeshBasicMaterial({ visible: false })
const bodyGeometry = new THREE.BoxGeometry(0.55, 1.45, 0.4)
const headGeometry = new THREE.SphereGeometry(0.16, 8, 6)
const raycaster = new THREE.Raycaster()
const v = new THREE.Vector3()
const eye = new THREE.Vector3()
// Rifle placement in the soldier's space (carried across the chest, then shouldered) and the grip points on the rifle.
const CARRY = new THREE.Vector3(0.1, 1.2, -0.26)
const SHOULDERED = new THREE.Vector3(0.13, 1.43, -0.3)
const GRIP = new THREE.Vector3(0, -0.07, 0.06)
const HANDGUARD = new THREE.Vector3(0, -0.02, -0.24)

/**
 * Hostile riflemen. They close on the player, steer around obstacles, and fire bursts when they have
 * line of sight. `player` is `{ eye: Vector3, sprinting: boolean, damage(amount) }`.
 */
export function createEnemies({ scene, models, fx, level, player }) {
  const enemies = []
  let hitboxes = []

  const blocked = (x, z) => level.boxes.some((box) => box.max.y > 0.3 && box.min.y < 1.7 &&
    x > box.min.x - RADIUS && x < box.max.x + RADIUS && z > box.min.z - RADIUS && z < box.max.z + RADIUS)

  // Route finding: a grid over the floor, flooded outwards from the player a few times a second.
  // `steps` then holds each open cell's distance to the player, and an enemy walks downhill.
  const { min, max } = level.area
  const COLS = Math.ceil((max.x - min.x) / CELL)
  const ROWS = Math.ceil((max.z - min.z) / CELL)
  const open = new Uint8Array(COLS * ROWS)
  for (let i = 0; i < open.length; i++) {
    open[i] = blocked(min.x + ((i % COLS) + 0.5) * CELL, min.z + (Math.floor(i / COLS) + 0.5) * CELL) ? 0 : 1
  }
  const steps = new Uint16Array(COLS * ROWS)
  const queue = new Uint16Array(COLS * ROWS)
  const cellAt = (x, z) => {
    const col = Math.floor((x - min.x) / CELL)
    const row = Math.floor((z - min.z) / CELL)
    return col < 0 || row < 0 || col >= COLS || row >= ROWS ? -1 : row * COLS + col
  }
  const stepsAt = (col, row) => (col < 0 || row < 0 || col >= COLS || row >= ROWS ? UNREACHED : steps[row * COLS + col])
  let floodTimer = 0

  function flood() {
    steps.fill(UNREACHED)
    const start = cellAt(player.eye.x, player.eye.z)
    if (start < 0) return
    steps[start] = 0
    queue[0] = start
    for (let head = 0, tail = 1; head < tail; head++) {
      const cell = queue[head]
      const col = cell % COLS
      for (const next of [col > 0 ? cell - 1 : -1, col < COLS - 1 ? cell + 1 : -1, cell - COLS, cell + COLS]) {
        if (next < 0 || next >= steps.length || !open[next] || steps[next] !== UNREACHED) continue
        steps[next] = steps[cell] + 1
        queue[tail++] = next
      }
    }
  }

  /** The direction (as an angle) an enemy at x, z should walk to reach the player, or null when no route exists. */
  function route(x, z) {
    const col = Math.floor((x - min.x) / CELL)
    const row = Math.floor((z - min.z) / CELL)
    let best = stepsAt(col, row)
    let angle = null
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        const there = stepsAt(col + dc, row + dr)
        if (there >= best) continue
        // No cutting a corner between two cells unless both sides are open.
        if (dc && dr && (stepsAt(col + dc, row) === UNREACHED || stepsAt(col, row + dr) === UNREACHED)) continue
        best = there
        angle = Math.atan2(min.x + (col + dc + 0.5) * CELL - x, min.z + (row + dr + 0.5) * CELL - z)
      }
    }
    return angle
  }

  function canSee(enemy, distance) {
    eye.copy(enemy.root.position).setY(1.6)
    raycaster.set(eye, v.copy(player.eye).sub(eye).normalize())
    raycaster.far = distance
    return raycaster.intersectObjects(level.colliders, false).length === 0
  }

  function spawn(position) {
    const root = cloneSkinned(models.soldier)
    root.position.copy(position)
    root.rotation.order = 'YXZ'
    const mixer = new THREE.AnimationMixer(root)
    const actions = Object.fromEntries(models.soldier.animations.map((clip) => [clip.name, mixer.clipAction(clip)]))
    actions.Idle.play()
    const gun = models.akm.clone()
    root.add(gun)
    const body = new THREE.Mesh(bodyGeometry, hidden)
    body.position.y = 0.75
    const head = new THREE.Mesh(headGeometry, hidden)
    head.position.y = 1.6
    const enemy = { root, mixer, actions, gun, rightArm: armBones(root, 'Right'), leftArm: armBones(root, 'Left'), aim: 0, animation: 'Idle',
      health: 100, dead: 0, sees: false, think: Math.random() * 0.25,
      range: 12 + Math.random() * 16, burst: 0, shotTimer: 1 + Math.random() }
    body.userData = { enemy }
    head.userData = { enemy, head: true }
    root.add(body, head)
    scene.add(root)
    enemies.push(enemy)
    hitboxes.push(body, head)
  }

  function animate(enemy, name) {
    if (enemy.animation === name) return
    enemy.actions[enemy.animation].fadeOut(0.2)
    enemy.actions[name].reset().fadeIn(0.2).play()
    enemy.animation = name
  }

  function shoot(enemy, distance) {
    const muzzle = enemy.gun.localToWorld(MUZZLE.clone())
    const chance = THREE.MathUtils.clamp(0.6 - distance * 0.012, 0.08, 0.45) * (player.sprinting ? 0.6 : 1)
    const hit = Math.random() < chance
    const target = player.eye.clone()
    if (hit) target.y -= 0.3
    else target.add(v.randomDirection().multiplyScalar(0.6 + Math.random()))
    fx.tracer(muzzle, target.sub(muzzle).multiplyScalar(1.5).add(muzzle))
    fx.flash(muzzle, 0.5)
    fx.play(distance > 35 ? 'ak_shot_far' : 'ak_shot', { at: muzzle, detune: (Math.random() - 0.5) * 150 })
    if (hit) player.damage(10 + Math.random() * 7)
  }

  function updateEnemy(enemy, dt) {
    const { root } = enemy
    if (enemy.dead > 0) {
      enemy.dead += dt
      const fall = Math.min(enemy.dead / 0.45, 1)
      root.rotation.x = fall * fall * Math.PI * 0.49
      root.position.y = fall * 0.12
      return
    }
    enemy.mixer.update(dt)
    const dx = player.eye.x - root.position.x
    const dz = player.eye.z - root.position.z
    const distance = Math.hypot(dx, dz)
    enemy.think -= dt
    if (enemy.think <= 0) {
      enemy.think = 0.25
      enemy.sees = distance < 75 && canSee(enemy, distance)
    }
    const heading = Math.atan2(dx, dz)
    root.rotation.y = heading + Math.PI // the model faces -Z

    if (enemy.sees && distance < enemy.range) {
      animate(enemy, 'Idle')
      enemy.shotTimer -= dt
      if (enemy.shotTimer <= 0) {
        if (enemy.burst === 0) enemy.burst = 3 + Math.floor(Math.random() * 3)
        shoot(enemy, distance)
        enemy.burst--
        enemy.shotTimer = enemy.burst > 0 ? 0.1 : 0.9 + Math.random() * 1.2
      }
    } else {
      animate(enemy, 'Run')
      // With no route (the enemy was pushed into an obstacle, say) head straight for the player.
      const angle = route(root.position.x, root.position.z) ?? heading
      root.position.x += Math.sin(angle) * SPEED * dt
      root.position.z += Math.cos(angle) * SPEED * dt
      root.rotation.y = angle + Math.PI
    }
    // Shoulder the rifle when firing, carry it across the chest otherwise, and bend both arms to hold it.
    enemy.aim = THREE.MathUtils.damp(enemy.aim, enemy.animation === 'Idle' ? 1 : 0, 8, dt)
    enemy.gun.position.lerpVectors(CARRY, SHOULDERED, enemy.aim)
    root.updateMatrixWorld(true)
    const side = v.set(1, 0, 0).applyQuaternion(root.quaternion).clone()
    reach(enemy.rightArm, enemy.gun.localToWorld(GRIP.clone()), new THREE.Vector3(0, -1, 0).addScaledVector(side, 0.6))
    reach(enemy.leftArm, enemy.gun.localToWorld(HANDGUARD.clone()), new THREE.Vector3(0, -1, 0).addScaledVector(side, -0.6))
  }

  return {
    get alive() { return enemies.filter((enemy) => enemy.dead === 0).length },
    get hitboxes() { return hitboxes },
    list: enemies,
    /** Spawns `count` enemies at the spawn points farthest from the player. */
    spawnWave(count) {
      const points = [...level.spawns].sort((a, b) => b.distanceTo(player.eye) - a.distanceTo(player.eye)).slice(0, 5)
      for (let i = 0; i < count; i++) {
        const point = points[i % points.length]
        spawn(v.set(point.x + (Math.random() - 0.5) * 3, 0, point.z + (Math.random() - 0.5) * 3))
      }
    },
    /** Applies a bullet hit to the enemy that owns `hitbox`; a head hit does triple damage. Returns true when it kills. */
    damage(hitbox, amount = 34) {
      const { enemy, head } = hitbox.userData
      enemy.health -= head ? amount * 3 : amount
      if (enemy.health > 0) {
        if (Math.random() < 0.5) fx.play(`pain${1 + Math.floor(Math.random() * 3)}`, { at: hitbox.getWorldPosition(v) })
        return false
      }
      enemy.dead = 0.001
      enemy.mixer.timeScale = 0
      hitboxes = hitboxes.filter((box) => box.userData.enemy !== enemy)
      fx.play(`death${1 + Math.floor(Math.random() * 3)}`, { at: hitbox.getWorldPosition(v), volume: 1.4 })
      return true
    },
    update(dt) {
      floodTimer -= dt
      if (floodTimer <= 0) {
        floodTimer = 0.3
        flood()
      }
      // Living enemies shoulder each other apart so they do not bunch up on one spot.
      const living = enemies.filter((enemy) => !enemy.dead)
      for (const a of living) {
        for (const b of living) {
          const dx = a.root.position.x - b.root.position.x
          const dz = a.root.position.z - b.root.position.z
          const gap = Math.hypot(dx, dz)
          if (a === b || gap >= SPACING || gap === 0) continue
          const push = Math.min(SPACING - gap, 2 * dt) / gap
          const x = a.root.position.x + dx * push
          const z = a.root.position.z + dz * push
          if (!blocked(x, z)) a.root.position.set(x, 0, z)
        }
      }
      for (let i = enemies.length - 1; i >= 0; i--) {
        updateEnemy(enemies[i], dt)
        if (enemies[i].dead > 12) {
          enemies[i].root.removeFromParent()
          enemies.splice(i, 1)
        }
      }
    },
  }
}
