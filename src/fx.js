import * as THREE from 'three'

function radialTexture(stops) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const context = canvas.getContext('2d')
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color))
  context.fillStyle = gradient
  context.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(canvas)
}

/** A synthesised blast: a sharp crack that dulls into a rumble, over a falling sub-bass thump. */
function explosionSound(context) {
  const rate = context.sampleRate
  const buffer = context.createBuffer(1, rate * 2.4, rate)
  const data = buffer.getChannelData(0)
  let noise = 0
  let phase = 0
  for (let i = 0; i < data.length; i++) {
    const t = i / rate
    noise += (Math.random() * 2 - 1 - noise) * (0.03 + 0.6 * Math.exp(-t * 25))
    phase += (2 * Math.PI * (38 + 90 * Math.exp(-t * 9))) / rate
    data[i] = Math.tanh(noise * 5 * Math.exp(-t * 2.6) + Math.sin(phase) * 1.4 * Math.exp(-t * 4))
  }
  return buffer
}

/** Short-lived visuals and positional sound: tracers, muzzle flashes, impact puffs, bullet holes. */
export function createFx(scene, camera, sounds) {
  const listener = new THREE.AudioListener()
  camera.add(listener)
  const live = []
  sounds.explosion = explosionSound(listener.context)
  const holes = []
  const flashMap = radialTexture([[0, 'rgba(255,245,210,1)'], [0.25, 'rgba(255,190,90,0.8)'], [1, 'rgba(255,120,20,0)']])
  const puffMap = radialTexture([[0, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']])
  const holeGeometry = new THREE.CircleGeometry(0.035, 10)
  const holeMaterial = new THREE.MeshBasicMaterial({ color: 0x0b0b0b, polygonOffset: true, polygonOffsetFactor: -4 })
  const up = new THREE.Vector3(0, 0, 1)

  function add(object, life, tick, parent = scene) {
    parent.add(object)
    live.push({ object, life, age: 0, tick })
  }

  return {
    listener,
    update(dt) {
      for (let i = live.length - 1; i >= 0; i--) {
        const item = live[i]
        item.age += dt
        item.tick?.(item.object, Math.min(item.age / item.life, 1))
        if (item.age >= item.life) {
          item.object.removeFromParent()
          live.splice(i, 1)
        }
      }
    },
    /** Plays a sound; with `at` it is positional in the world. */
    play(name, { volume = 1, at = null, detune = 0, loop = false } = {}) {
      const sound = at ? new THREE.PositionalAudio(listener) : new THREE.Audio(listener)
      sound.setBuffer(sounds[name]).setVolume(volume).setLoop(loop)
      sound.detune = detune
      if (at) {
        sound.setRefDistance(7).setRolloffFactor(1.3)
        sound.position.copy(at)
        add(sound, sounds[name].duration + 0.1)
        sound.updateMatrixWorld()
      }
      sound.play()
    },
    tracer(from, to) {
      const material = new THREE.LineBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false })
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), material)
      add(line, 0.07, (_, t) => { material.opacity = 0.55 * (1 - t) })
    },
    /** Muzzle flash at `position` in `parent` space, with a brief light. */
    flash(position, size, parent = scene) {
      const material = new THREE.SpriteMaterial({ map: flashMap, blending: THREE.AdditiveBlending, depthWrite: false,
        rotation: Math.random() * Math.PI })
      const sprite = new THREE.Sprite(material)
      sprite.position.copy(position)
      sprite.scale.setScalar(size * (0.8 + Math.random() * 0.5))
      const light = new THREE.PointLight(0xffb060, 6, 12)
      sprite.add(light)
      add(sprite, 0.05, null, parent)
    },
    puff(point, normal, color, size = 0.6) {
      const material = new THREE.SpriteMaterial({ map: puffMap, color, transparent: true, depthWrite: false })
      const sprite = new THREE.Sprite(material)
      sprite.position.copy(point).addScaledVector(normal, 0.05)
      add(sprite, 0.4, (object, t) => {
        object.scale.setScalar(0.1 + size * t)
        object.position.addScaledVector(normal, 0.004)
        material.opacity = 1 - t
      })
    },
    /** A grenade blast at `point`: fireball, light, smoke, scorch mark and sound. */
    explosion(point) {
      const fire = new THREE.SpriteMaterial({ map: flashMap, blending: THREE.AdditiveBlending, depthWrite: false })
      const ball = new THREE.Sprite(fire)
      ball.position.copy(point).setY(point.y + 0.6)
      const light = new THREE.PointLight(0xffa040, 400, 40)
      ball.add(light)
      add(ball, 0.35, (object, t) => {
        object.scale.setScalar(3 + 9 * t)
        fire.opacity = 1 - t
        light.intensity = 400 * (1 - t)
      })
      for (let i = 0; i < 9; i++) {
        const smoke = new THREE.SpriteMaterial({ map: puffMap, color: i % 2 ? 0x4a4640 : 0x8d877c, transparent: true, depthWrite: false })
        const sprite = new THREE.Sprite(smoke)
        const drift = new THREE.Vector3(Math.random() - 0.5, 0.5 + Math.random(), Math.random() - 0.5)
        sprite.position.copy(point)
        add(sprite, 1.6 + Math.random() * 1.2, (object, t) => {
          object.scale.setScalar(1.5 + 5 * Math.sqrt(t))
          object.position.addScaledVector(drift, 0.03 * (1 - t))
          smoke.opacity = 0.85 * (1 - t)
        })
      }
      const scorch = new THREE.Mesh(holeGeometry, new THREE.MeshBasicMaterial({ map: puffMap, color: 0x000000, transparent: true,
        polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false }))
      scorch.position.set(point.x, point.y - 0.045, point.z)
      scorch.rotation.x = -Math.PI / 2
      scorch.scale.setScalar(45)
      add(scorch, 40)
      this.play('explosion', { at: point, volume: 3 })
    },
    hole(point, normal) {
      const mesh = new THREE.Mesh(holeGeometry, holeMaterial)
      mesh.position.copy(point).addScaledVector(normal, 0.002)
      mesh.quaternion.setFromUnitVectors(up, normal)
      scene.add(mesh)
      holes.push(mesh)
      if (holes.length > 80) holes.shift().removeFromParent()
    },
  }
}
