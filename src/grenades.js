import * as THREE from 'three'

const FUSE = 2.6
const GRAVITY = 20
const geometry = new THREE.SphereGeometry(0.045, 10, 8).scale(1, 1.3, 1)
const material = new THREE.MeshStandardMaterial({ color: 0x2c3524, roughness: 0.6, metalness: 0.4 })

/**
 * Frag grenades: thrown, bounce off the level, and explode when the fuse runs out.
 * `onExplode(point)` is called at each detonation so the game can apply damage.
 */
export function createGrenades({ scene, fx, level, onExplode }) {
  const live = []
  const raycaster = new THREE.Raycaster()
  const direction = new THREE.Vector3()
  const normal = new THREE.Vector3()

  return {
    throw(from, towards) {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = true
      mesh.position.copy(from)
      scene.add(mesh)
      live.push({ mesh, velocity: towards.clone().multiplyScalar(17).setY(towards.y * 17 + 4), fuse: FUSE })
    },
    update(dt) {
      for (let i = live.length - 1; i >= 0; i--) {
        const { mesh, velocity } = live[i]
        velocity.y -= GRAVITY * dt
        const distance = velocity.length() * dt
        raycaster.set(mesh.position, direction.copy(velocity).normalize())
        raycaster.far = distance + 0.06
        const hit = raycaster.intersectObjects(level.colliders, false)[0]
        if (hit) {
          normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld)
          velocity.reflect(normal).multiplyScalar(0.35)
          if (velocity.length() > 2) fx.play('impact_stone', { at: mesh.position, volume: 0.5 })
        } else mesh.position.addScaledVector(velocity, dt)
        if (mesh.position.y < 0.06) { // the ground
          mesh.position.y = 0.06
          velocity.set(velocity.x * 0.5, Math.abs(velocity.y) * 0.3, velocity.z * 0.5)
        }
        mesh.rotation.x += distance * 6
        if ((live[i].fuse -= dt) > 0) continue
        mesh.removeFromParent()
        live.splice(i, 1)
        fx.explosion(mesh.position)
        onExplode(mesh.position)
      }
    },
  }
}
