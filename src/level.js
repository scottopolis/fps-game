import * as THREE from 'three'
import { pbr } from './assets.js'

const SCALE = 2 // the factory is modelled at about half size
const HALL = { x: 8.5, back: -46, front: 15.5, height: 9.7 } // the hall's inner faces, in metres
const TILE = 3 // metres covered by one texture repeat

/** A box whose UVs repeat by world size, so textures keep one scale on every wall. */
function tiledBox(w, h, d) {
  const geometry = new THREE.BoxGeometry(w, h, d)
  const uv = geometry.attributes.uv
  const sizes = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]
  for (let i = 0; i < uv.count; i++) {
    const [u, v] = sizes[Math.floor(i / 4)]
    uv.setXY(i, (uv.getX(i) * u) / TILE, (uv.getY(i) * v) / TILE)
  }
  return geometry
}

/**
 * Builds the factory hall and the cover placed in it. Returns `solid` (the collision group), `colliders`
 * (its meshes, for bullets and line of sight), `boxes` (obstacle bounds) and `area` (the floor's extent) for enemy route finding, the `pickups`, enemy `spawns`,
 * and `playerStart` with `playerYaw`.
 */
export function buildLevel(scene, { models }) {
  const colliders = []
  const boxes = []
  const solid = new THREE.Group() // everything the player and bullets collide with
  scene.add(solid)
  const hidden = new THREE.MeshBasicMaterial({ visible: false })
  const bounds = new THREE.Box3()

  // The map itself. Its ceiling and roof fittings sit above the lamps, so they cast no shadows.
  const factory = models.factory
  factory.scale.setScalar(SCALE)
  scene.add(factory)
  factory.updateMatrixWorld(true)
  factory.traverse((node) => {
    if (!node.isMesh) return
    node.castShadow = bounds.setFromObject(node).min.y < 6.4
    if (node.material.map) node.material.map.anisotropy = 8
  })

  // Its collision mesh, built by tools/level_collision.py: the hall's shell plus a box for each fitting.
  const collision = models.factory_collision
  collision.scale.setScalar(SCALE)
  solid.add(collision)
  collision.updateMatrixWorld(true)
  collision.traverse((node) => {
    if (!node.isMesh) return
    node.material = hidden
    node.userData.surface = node.name.startsWith('stone') ? 'stone' : 'metal'
    node.userData.proxy = node.name.includes('_box_') // stands in for a detailed model, so bullet holes would float
    colliders.push(node)
    if (node.userData.proxy) boxes.push(new THREE.Box3().setFromObject(node))
  })

  // The hall is open at the front; close it.
  const wall = new THREE.Mesh(tiledBox(HALL.x * 2 + 2, HALL.height, 0.6), pbr('concrete_wall_008', { color: 0x8a8a86 }))
  wall.position.set(0, HALL.height / 2, HALL.front + 0.3)
  wall.castShadow = wall.receiveShadow = true
  wall.userData.surface = 'stone'
  solid.add(wall)
  colliders.push(wall)

  /** Places a model standing on `y` and gives it a box collider. Returns the middle of its top. */
  function prop(name, x, z, { rot = 0, scale = 1, y = 0, surface = 'metal' } = {}) {
    const object = models[name].clone()
    object.scale.setScalar(scale)
    object.rotation.y = rot
    object.position.set(x, 0, z)
    object.position.y = y - new THREE.Box3().setFromObject(object).min.y
    scene.add(object)
    bounds.setFromObject(object)
    const size = bounds.getSize(new THREE.Vector3())
    const collider = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), hidden)
    bounds.getCenter(collider.position)
    collider.userData.surface = surface
    collider.userData.proxy = true
    solid.add(collider)
    colliders.push(collider)
    boxes.push(bounds.clone())
    return bounds.getCenter(new THREE.Vector3()).setY(bounds.max.y) // the middle of its top
  }

  // Shipping containers (7 m long, 2.6 m tall at this scale)
  const C = { scale: 1.15 }
  const turned = { ...C, rot: Math.PI / 2 }
  prop('container', 2.5, 4, C); prop('container', 2.5, 4, { ...C, y: 2.6 })
  prop('container', -3, -7, turned); prop('container', 4, -12, C); prop('container', 2, -29, C)

  // HESCO barriers (source model is in centimetres) and road barriers
  const hesco = (x, z) => prop('hesco', x, z, { scale: 0.024, surface: 'stone' })
  for (let i = 0; i < 4; i++) hesco(-5.5 + i * 1.45, -0.5)
  const sniperRest = hesco(-5.5 + 4 * 1.45, -0.5)
  for (let i = 0; i < 3; i++) hesco(5.5, -3.5 + i * 1.45)
  for (let i = 0; i < 3; i++) hesco(-6.5 + i * 1.45, -26)
  const barrier = (x, z, rot = 0) => prop('concrete_road_barrier_02', x, z, { rot, surface: 'stone' })
  barrier(-4.5, 8.5, 0.15); barrier(5.5, 9.5, -0.2); barrier(-4, -31, 0.3)

  const clutter = [['Barrel_01', -6.6, 6], ['Barrel_01', -5.7, 6.3], ['barrel_03', -6.2, 5.1], ['barrel_03', 7, -1],
    ['Barrel_01', 7.3, -0.1], ['Barrel_01', -5.6, -12.8], ['barrel_03', -4.8, -13.4], ['barrel_03', 6.6, -30.5],
    ['Barrel_01', 7.4, -30], ['metal_trash_can', 7.4, 13.6], ['metal_trash_can', -7, -22],
    ['utility_box_01', -7.4, 13.4], ['utility_box_01', 7, -26.5], ['plastic_crate_02', -1.8, 4.6], ['plastic_crate_02', 6.2, 5.6],
    ['ammo_box', -5.4, 0.6], ['ammo_box', 1.2, -10.4], ['metal_jerrycan_green', -5.2, 6.9], ['metal_jerrycan_green', 0.4, -27.4]]
  clutter.forEach(([name, x, z], i) => prop(name, x, z, { rot: i * 1.3 }))
  const pistolRest = prop('Barrel_01', 0.5, 9)

  scene.updateMatrixWorld(true)
  return {
    solid,
    colliders,
    boxes,
    area: new THREE.Box3(new THREE.Vector3(-HALL.x, 0, HALL.back), new THREE.Vector3(HALL.x, 0, HALL.front)),
    // Guns to pick up, lying on top of cover.
    pickups: [{ weapon: 'pistol_fp', position: pistolRest }, { weapon: 'sniper_fp', position: sniperRest, turn: Math.PI / 2 }],
    spawns: [[-6, -31.5], [-2, -32], [7.3, -28], [-1, -23], [7.5, -40], [6.5, 13.5], [-6, 12], [0, 14]]
      .map(([x, z]) => new THREE.Vector3(x, 0, z)),
    playerStart: new THREE.Vector3(0, 0, 12),
    playerYaw: 0, // facing down the hall
  }
}
