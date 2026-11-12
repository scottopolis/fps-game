import * as THREE from 'three'

const a = new THREE.Vector3()
const b = new THREE.Vector3()
const v = new THREE.Vector3()
const elbow = new THREE.Vector3()
const q = new THREE.Quaternion()
const parentQ = new THREE.Quaternion()

/** The `[upper arm, forearm, hand]` bones of a Mixamo-rigged character; `side` is 'Left' or 'Right'. */
export const armBones = (root, side) => ['Arm', 'ForeArm', 'Hand'].map((part) => root.getObjectByName(`mixamorig${side}${part}`))

/** Rotates `bone` so that `child` lies in the direction of the world point `target`. */
function aimBone(bone, child, target) {
  bone.getWorldPosition(a)
  child.getWorldPosition(b).sub(a).normalize()
  q.setFromUnitVectors(b, v.copy(target).sub(a).normalize())
  bone.parent.getWorldQuaternion(parentQ)
  bone.quaternion.premultiply(q.premultiply(parentQ.clone().invert()).multiply(parentQ))
  bone.updateWorldMatrix(false, true)
}

/** Two-bone IK: bends the arm `[upper, fore, hand]` so the hand reaches the world point `target`, elbow towards `pole`. */
export function reach([upper, fore, hand], target, pole) {
  const shoulder = upper.getWorldPosition(new THREE.Vector3())
  const l1 = shoulder.distanceTo(fore.getWorldPosition(a))
  const l2 = a.distanceTo(hand.getWorldPosition(b))
  const dir = target.clone().sub(shoulder)
  const d = Math.min(dir.length(), (l1 + l2) * 0.999)
  dir.normalize()
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
  const out = Math.sqrt(Math.max(l1 * l1 - along * along, 0))
  pole.addScaledVector(dir, -pole.dot(dir)).normalize()
  elbow.copy(shoulder).addScaledVector(dir, along).addScaledVector(pole, out)
  aimBone(upper, fore, elbow)
  aimBone(fore, hand, dir.multiplyScalar(d).add(shoulder))
}
