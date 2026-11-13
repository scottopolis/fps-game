import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'

const BASE = 'assets/'
const textureLoader = new THREE.TextureLoader()

/** Loads a tiling texture. Models exported from Blender need `flipY: false`. */
function texture(name, { srgb = false, flipY = true } = {}) {
  const map = textureLoader.load(`${BASE}textures/${name}.jpg`)
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  map.anisotropy = 8
  map.flipY = flipY
  if (srgb) map.colorSpace = THREE.SRGBColorSpace
  return map
}

/** Builds a PBR material from `<prefix>_color/normal/rough/metal.jpg`. */
export function pbr(prefix, { maps = ['normal', 'rough'], flipY = true, ...params } = {}) {
  const has = (kind) => maps.includes(kind)
  return new THREE.MeshStandardMaterial({
    map: texture(`${prefix}_color`, { srgb: true, flipY }),
    normalMap: has('normal') ? texture(`${prefix}_normal`, { flipY }) : null,
    roughnessMap: has('rough') ? texture(`${prefix}_rough`, { flipY }) : null,
    metalnessMap: has('metal') ? texture(`${prefix}_metal`, { flipY }) : null,
    metalness: has('metal') ? 1 : 0,
    ...params,
  })
}

// Models converted from Blender without materials; textures are applied here.
const CUSTOM = {
  akm: () => pbr('akm', { maps: ['normal', 'rough', 'metal'], flipY: false }),
  container: () => pbr('container', { maps: ['normal'], flipY: false, roughness: 0.6, metalness: 0.3 }),
  hesco: () => pbr('hesco', { maps: ['normal'], flipY: false, roughness: 0.95 }),
  soldier: null,
  factory: null,
  factory_collision: null,
  m4_fp: null, // the player's animated hands and guns
  pistol_fp: null,
  sniper_fp: null,
}
const POLYHAVEN = ['concrete_road_barrier_02', 'Barrel_01', 'barrel_03', 'covered_car', 'metal_jerrycan_green',
  'ammo_box', 'utility_box_01', 'metal_trash_can', 'plastic_crate_02']
const SOUNDS = ['m4_shot', 'pistol_shot', 'sniper_shot', 'ak_shot', 'ak_shot_far', 'reload', 'pain1', 'pain2', 'pain3', 'death1', 'death2',
  'death3', 'step1', 'step2', 'step3', 'step4', 'step5', 'step6', 'impact_stone', 'impact_metal',
  'impact_flesh', 'wind']

function shadows(root) {
  root.traverse((node) => {
    if (node.isMesh) node.castShadow = node.receiveShadow = true
  })
}

export async function loadAssets() {
  const gltf = new GLTFLoader()
  const audio = new THREE.AudioLoader()
  const models = {}
  const sounds = {}
  const jobs = [
    ...Object.entries(CUSTOM).map(async ([name, material]) => {
      const { scene, animations } = await gltf.loadAsync(`${BASE}models/${name}.glb`)
      if (material) {
        const shared = material()
        scene.traverse((node) => { if (node.isMesh) node.material = shared })
      }
      // The soldier's materials ship without roughness maps and read as wet plastic under the sky.
      if (name === 'soldier') scene.traverse((node) => { if (node.isMesh) node.material.roughness = Math.max(node.material.roughness, 0.7) })
      shadows(scene)
      models[name] = scene
      models[name].animations = animations
    }),
    ...POLYHAVEN.map(async (name) => {
      models[name] = (await gltf.loadAsync(`${BASE}models/${name}/${name}_1k.gltf`)).scene
      shadows(models[name])
    }),
    ...SOUNDS.map(async (name) => { sounds[name] = await audio.loadAsync(`${BASE}sounds/${name}.ogg`) }),
  ]
  const sky = await new HDRLoader().loadAsync(`${BASE}textures/sky_2k.hdr`)
  sky.mapping = THREE.EquirectangularReflectionMapping
  await Promise.all(jobs)
  return { models, sounds, sky }
}
