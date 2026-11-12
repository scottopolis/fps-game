# Rigs the static Federation soldier onto the Mixamo skeleton (and its animations) from soldier.glb.
import bpy, sys, math
from mathutils import Vector, Matrix, kdtree
sol, fed, out = sys.argv[sys.argv.index('--') + 1:][:3]
K = 0.19  # Federation units -> metres

def P(fwd, left, up):  # Federation model space -> Blender world (soldier faces +Y, its left is -X)
    return Vector((-left * K, fwd * K, up * K))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=sol)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for o in [o for o in bpy.data.objects if o.type == 'MESH']:
    bpy.data.objects.remove(o)
for a in list(bpy.data.actions):
    if a.name in ('Idle_Character', 'Run_Character', 'Walk_Character'): a.name = a.name.split('_')[0]
    else: bpy.data.actions.remove(a)

before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=fed)
new = set(bpy.data.objects) - before
extras = [o.name for o in new if o.type != 'MESH']
meshes = [o for o in new if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = 'federation'
body.matrix_world = Matrix.Rotation(math.pi / 2, 4, 'Z') @ Matrix.Scale(K, 4) @ body.matrix_world
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for n in extras:
    if n in bpy.data.objects: bpy.data.objects.remove(bpy.data.objects[n])
zmin = min((v.co.z for v in body.data.vertices)); print('BODY height', max(v.co.z for v in body.data.vertices), 'zmin', zmin)

# Joint positions read off the Federation mesh (forward, left, up).
S, E, W = Vector((-0.15, 1.25, 7.5)), Vector((0.1, 2.05, 6.35)), Vector((1.3, 2.35, 5.7))
L1, L2 = (E - S).length, (W - E).length
joints = {'Hips': P(-0.15, 0, 5.0), 'Spine2': P(-0.25, 0, 6.9), 'Neck': P(-0.15, 0, 7.95), 'Head': P(-0.1, 0, 8.2)}
for side, s in (('Left', 1), ('Right', -1)):
    joints[side + 'Shoulder'] = P(-0.15, 0.4 * s, 7.7)
    joints[side + 'Arm'] = P(S.x, S.y * s, S.z)
    joints[side + 'ForeArm'] = P(S.x, (S.y + L1) * s, S.z)
    joints[side + 'Hand'] = P(S.x, (S.y + L1 + L2) * s, S.z)
    joints[side + 'UpLeg'] = P(-0.1, 0.5 * s, 4.75)
    joints[side + 'Leg'] = P(0.0, 0.55 * s, 2.4)
    joints[side + 'Foot'] = P(-0.15, 0.55 * s, 0.65)
    joints[side + 'ToeBase'] = P(0.6, 0.6 * s, 0.12)

# Move the skeleton's joints onto the mesh, keeping every bone's orientation so the animations still apply.
inv = arm.matrix_world.inverted()
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
def move(bone, inherited):
    key = bone.name.split(':')[-1]
    delta = inv @ joints[key] - bone.head if key in joints else inherited
    children = list(bone.children)
    bone.use_connect = False
    for c in children: c.use_connect = False
    bone.head += delta; bone.tail += delta
    for c in children: move(c, delta)
for root in [b for b in arm.data.edit_bones if not b.parent]: move(root, Vector())
bpy.ops.object.mode_set(mode='OBJECT')

# A copy of the skeleton, posed into the mesh's A-pose, takes the automatic weights.
bpy.ops.object.select_all(action='DESELECT')
fit = arm.copy(); fit.data = arm.data.copy(); fit.animation_data_clear()
bpy.context.scene.collection.objects.link(fit)
if arm.animation_data: arm.animation_data.action = None
for pb in [*arm.pose.bones, *fit.pose.bones]: pb.matrix_basis = Matrix()  # drop the imported animation's pose
bpy.context.view_layer.update()
finv = fit.matrix_world.inverted()
def aim(name, target):
    pb = fit.pose.bones['mixamorig:' + name]
    q = (pb.tail - pb.head).rotation_difference(finv @ target - pb.head)
    pb.matrix = Matrix.Translation(pb.head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-pb.head) @ pb.matrix
    bpy.context.view_layer.update()
for side, s in (('Left', 1), ('Right', -1)):
    aim(side + 'Arm', P(E.x, E.y * s, E.z))
    aim(side + 'ForeArm', P(W.x, W.y * s, W.z))
    print('FIT', side, 'hand at', [round(c, 3) for c in fit.matrix_world @ fit.pose.bones['mixamorig:' + side + 'Hand'].head], 'want', [round(c, 3) for c in P(W.x, W.y * s, W.z)])
bpy.context.view_layer.objects.active = fit
bpy.ops.object.mode_set(mode='POSE'); bpy.ops.pose.armature_apply(selected=False); bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.object.select_all(action='DESELECT')
body.select_set(True); fit.select_set(True); bpy.context.view_layer.objects.active = fit
bpy.ops.object.parent_set(type='ARMATURE_NAME')
# Blender's bone-heat weighting fails on this multi-shell mesh, so weight each vertex by its distance to the bone segments.
import numpy as np
CHAIN = {'Hips': 'Spine', 'Spine': 'Spine1', 'Spine1': 'Spine2', 'Spine2': 'Neck', 'Neck': 'Head', 'Head': None}
for side in ('Left', 'Right'):
    CHAIN.update({side + 'Shoulder': side + 'Arm', side + 'Arm': side + 'ForeArm', side + 'ForeArm': side + 'Hand',
                  side + 'Hand': side + 'HandMiddle1', side + 'UpLeg': side + 'Leg', side + 'Leg': side + 'Foot',
                  side + 'Foot': side + 'ToeBase', side + 'ToeBase': None})
head = lambda n: np.array(fit.matrix_world @ fit.data.bones['mixamorig:' + n].head_local)
co = np.array([v.co[:] for v in body.data.vertices])
names, dist = [], []
for name, child in CHAIN.items():
    a = head(name)
    if child: b = head(child)
    elif name == 'Head': b = a + np.array([0, 0, 0.18])
    else: b = a + np.array([0, 0.1, 0])
    if name.endswith('Hand'): b = a + (b - a) * 2.2  # reach the fingertips
    if name.endswith('Shoulder'): a = a + (b - a) * 0.5  # keep the collar off the neck
    t = np.clip(((co - a) @ (b - a)) / ((b - a) @ (b - a)), 0, 1)
    names.append('mixamorig:' + name); dist.append(np.linalg.norm(co - (a + t[:, None] * (b - a)), axis=1))
w = 1 / (np.array(dist).T + 0.01) ** 6
w[w < w.max(axis=1, keepdims=True) * 0.03] = 0
w /= w.sum(axis=1, keepdims=True)
for j, n in enumerate(names):
    group = body.vertex_groups[n]
    for i in np.nonzero(w[:, j])[0]: group.add([int(i)], float(w[i, j]), 'REPLACE')

# Pose the copy back to the T-pose, bake that into the mesh, then hand the mesh to the animated skeleton.
def tpose(pb):
    pb.matrix = arm.data.bones[pb.name].matrix_local
    bpy.context.view_layer.update()
    for c in pb.children: tpose(c)
for pb in [p for p in fit.pose.bones if not p.parent]: tpose(pb)
bpy.ops.object.select_all(action='DESELECT'); body.select_set(True); bpy.context.view_layer.objects.active = body
for m in list(body.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)
body.parent = None; body.matrix_world = Matrix()
bpy.data.objects.remove(fit)
body.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE')
xs = [v.co.x for v in body.data.vertices]; print('TPOSE span x', min(xs), max(xs))
for m in body.data.materials: m.use_backface_culling = True
bpy.ops.export_scene.gltf(filepath=out, use_selection=True, export_animations=True, export_animation_mode='ACTIONS',
                          export_image_format='JPEG', export_jpeg_quality=82, export_yup=True)
