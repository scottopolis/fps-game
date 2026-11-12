"""Builds the collision mesh for the factory map.

  blender -b -P tools/level_collision.py -- old_factory_free.glb public/assets/models/factory_collision.glb

The hall's shell (floor, walls, ceiling) is copied as it is. Everything else (pipes, posts, crates, platforms)
becomes one box per connected part, which is far cheaper to collide with than 180k triangles of pipework.
Object names carry what the game needs: `stone_*` or `metal_*` for the impact effect, `*_box_*` for boxes.
"""
import sys
import bpy
import bmesh
from mathutils import Vector

SHELL = {'Plane', 'Plane.001', 'Plane.002', 'Plane.004', 'Plane.005', 'Plane.012', 'Plane.014'}
STONE = SHELL | {'Plane.007', 'Plane.008', 'Plane.013'}  # the platforms are concrete slabs
CEILING = 4.1   # fittings above this are out of reach
SMALLEST = 0.08  # parts smaller than this (bolts, brackets) are ignored

src, out = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sources = [o for o in bpy.context.scene.objects if o.type == 'MESH']
made = []


def add(name, verts, faces):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    made.append(bpy.data.objects.new(name, mesh))


def box(lo, hi):
    x, y, z = zip(lo, hi)
    verts = [(x[i], y[j], z[k]) for i in (0, 1) for j in (0, 1) for k in (0, 1)]
    return verts, [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]


for o in sources:
    base = o.name.split('_Material')[0]
    kind = 'stone' if base in STONE else 'metal'
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.transform(o.matrix_world)
    if base in SHELL:
        # Planes block from one side only, so each face goes in twice, once per winding.
        verts = [v.co[:] for v in bm.verts]
        faces = [[v.index for v in f.verts] for f in bm.faces]
        add(f'{kind}_{len(made)}', verts * 2, faces + [[i + len(verts) for i in reversed(f)] for f in faces])
        continue
    if min(v.co.z for v in bm.verts) > CEILING:
        continue
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    seen = set()
    for start in bm.verts:
        if start in seen:
            continue
        seen.add(start)
        stack, part = [start], []
        while stack:
            v = stack.pop()
            part.append(v.co)
            for e in v.link_edges:
                w = e.other_vert(v)
                if w not in seen:
                    seen.add(w)
                    stack.append(w)
        lo = Vector([min(p[i] for p in part) for i in range(3)])
        hi = Vector([max(p[i] for p in part) for i in range(3)])
        if max(hi - lo) >= SMALLEST:
            add(f'{kind}_box_{len(made)}', *box(lo, hi))
    bm.free()

# Boxes that sit wholly inside another box add nothing.
boxes = [o for o in made if '_box_' in o.name]
bounds = {o.name: (Vector(o.data.vertices[0].co), Vector(o.data.vertices[7].co)) for o in boxes}
inside = lambda a, b: all(b[0][i] <= a[0][i] + 1e-4 and a[1][i] <= b[1][i] + 1e-4 for i in range(3))
keep = [o for o in made if '_box_' not in o.name or
        not any(p is not o and inside(bounds[o.name], bounds[p.name]) and (bounds[o.name] != bounds[p.name] or p.name < o.name) for p in boxes)]

for o in sources:
    bpy.data.objects.remove(o)
for o in keep:
    bpy.context.scene.collection.objects.link(o)
print(f'COLLISION {len(keep)} objects ({len(made) - len(keep)} nested boxes dropped)')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_materials='NONE', export_normals=True,
                          export_texcoords=False, export_animations=False)
