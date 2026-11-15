/*
 * actors.js - the human characters: rigged, skinned models driven by motion-captured clips
 *
 * Models (web/models/*.glb) share the Mixamo / Ready Player Me skeleton layout but not its
 * conventions: one rests in a T-pose, another in an A-pose, one faces +z, another -z. So motion
 * is stored model-independently in web/models/moves.json: for every joint and sample, the
 * world-space rotation away from the T-pose, in a frame where the character faces +z, plus the
 * hip offset in hip-heights. clip() turns that into an ordinary animation clip for one model
 * when it is first needed. The moves were baked from an unarmed run / idle / walk capture, so
 * everybody runs straight with free-swinging arms.
 *
 * Moves with no capture (slide, jump tuck, hands up, cheer) are posed in code: extra joint
 * rotations in character space, layered over the clip and blended in and out.
 *
 * A stock model becomes a particular person through a kit: plain-coloured outfit parts plus
 * props (hair, beard, sunglasses, sash, medals, race numbers) pinned to its joints.
 *
 * Everything else in the game is still drawn through glshim.js. Until a model has loaded (or if
 * it cannot), game.js falls back to its built-in human() figure, so the game never waits.
 */
'use strict';

const Actors = (() => {
  const DEG = Math.PI / 180;
  const HEIGHT = 1.95;                              // world units, matches the game's hit boxes
  const MODELS = {
    man: 'web/models/man.glb',                      // Aladeen, his double, and the rival athletes
    athlete: 'web/models/athlete.glb',              // Zoey
    soldier: 'web/models/soldier.glb'               // Elite Guard
  };
  const UP = new THREE.Vector3(0, 1, 0);
  let scene = null, moves = null;
  const lib = {};                                   // name -> loaded model
  const all = [];

  // Extra joint rotations in degrees: [pitch, yaw, roll] in character space, where the character
  // faces +z. Positive pitch tips an upright bone forward, so it swings a hanging limb backward.
  const POSES = {
    // feet-first slide: lean back on one hand, lead leg flat along the road, other knee up
    slide: {
      Hips: [-52, 0, 0], Spine: [4, 0, 0], Spine2: [6, 0, 0], Neck: [12, 0, 0], Head: [22, 0, 0],
      LeftUpLeg: [-26, 0, 0], LeftLeg: [6, 0, 0], LeftFoot: [-25, 0, 0],
      RightUpLeg: [-74, 0, 0], RightLeg: [112, 0, 0],
      LeftArm: [70, 0, 26], LeftForeArm: [8, 0, 0], RightArm: [-24, 0, -30], RightForeArm: [-30, 0, 0]
    },
    // mid-air: knees tucked over the hurdle
    air: {
      Spine: [6, 0, 0], LeftUpLeg: [-38, 0, 0], LeftLeg: [62, 0, 0], RightUpLeg: [-12, 0, 0], RightLeg: [48, 0, 0],
      LeftArm: [-20, 0, 12], RightArm: [-20, 0, -12]
    },
    // hands up (standing still)
    fear: {
      Spine: [-4, 0, 0], LeftArm: [-160, 0, 14], RightArm: [-160, 0, -14], LeftForeArm: [-12, 0, 0], RightForeArm: [-12, 0, 0]
    },
    // both fists in the air without breaking stride: the Supreme Leader has won again
    cheer: {
      Spine: [-6, 0, 0], Head: [-10, 0, 0], LeftArm: [-150, 0, 24], RightArm: [-150, 0, -24], LeftForeArm: [-25, 0, 0], RightForeArm: [-25, 0, 0]
    },
    // out of breath: hunched over, head down, arms heavy
    tired: {
      Spine: [14, 0, 0], Spine1: [10, 0, 0], Neck: [8, 0, 0], Head: [12, 0, 0], LeftArm: [12, 0, 0], RightArm: [12, 0, 0]
    }
  };
  const ORDER = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm',
                 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];   // parents before children

  const qp = new THREE.Quaternion(), qr = new THREE.Quaternion(), qh = new THREE.Quaternion();
  const eul = new THREE.Euler(0, 0, 0, 'YXZ');
  const white = [1, 1, 1];
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), qi = new THREE.Quaternion();

  const bare = n => n.replace(/^mixamorig:?/, '');
  function bonesOf(root) {                          // joint name -> node (end joints are plain nodes, not bones)
    const o = {};
    root.traverse(n => { const k = bare(n.name); if (!(k in o) || n.isBone) o[k] = n; });
    return o;
  }
  const wpos = n => n.getWorldPosition(new THREE.Vector3());
  const wquat = n => n.getWorldQuaternion(new THREE.Quaternion());

  function load(name) {
    new THREE.GLTFLoader().load(MODELS[name], g => {
      const m = { name, src: g.scene, mats: {}, made: {}, ref: {} };
      g.scene.updateMatrixWorld(true);
      const b = m.bones = bonesOf(g.scene);
      // size and facing come from the skeleton: a skinned mesh's own bounding box is not reliable
      const top = wpos(b.HeadTop_End).y, toe = Math.min(wpos(b.LeftToeBase).y, wpos(b.RightToeBase).y);
      const floor = toe - 0.02 * (top - toe);
      m.scale = HEIGHT / (top - floor);
      m.feet = -floor * m.scale;
      const left = wpos(b.LeftUpLeg).sub(wpos(b.RightUpLeg));
      m.yaw = Math.atan2(-left.z, left.x);                       // 0 when the rest pose faces +z (left hip at +x)
      const Y = m.Y = new THREE.Quaternion().setFromAxisAngle(UP, -m.yaw);   // model space -> character space
      m.hipH = wpos(b.Hips).y - floor;
      m.hip0 = b.Hips.position.clone();
      m.hipPQ = wquat(b.Hips.parent);
      m.hipPS = b.Hips.parent.getWorldScale(new THREE.Vector3()).y;

      // Reference pose for moves.json: this model's rest pose pulled into a true T-pose
      // (arms straight out, legs straight down), as world rotations in character space.
      const straighten = (from, to, x, y) => new THREE.Quaternion().setFromUnitVectors(
        wpos(b[to]).sub(wpos(b[from])).applyQuaternion(Y).normalize(), new THREE.Vector3(x, y, 0));
      const fix = {};
      const la = straighten('LeftArm', 'LeftForeArm', 1, 0), ra = straighten('RightArm', 'RightForeArm', -1, 0);
      const ll = straighten('LeftUpLeg', 'LeftLeg', 0, -1), rl = straighten('RightUpLeg', 'RightLeg', 0, -1);
      for (const k of ['Arm', 'ForeArm', 'Hand']) { fix['Left' + k] = la; fix['Right' + k] = ra; }
      for (const k of ['UpLeg', 'Leg', 'Foot', 'ToeBase']) { fix['Left' + k] = ll; fix['Right' + k] = rl; }
      for (const k in b) {
        m.ref[k] = wquat(b[k]).premultiply(Y);
        if (fix[k]) m.ref[k].premultiply(fix[k]);
      }

      g.scene.traverse(o => {
        if (!o.isMesh) return;
        const om = o.material;
        if (om.map) om.map.encoding = THREE.LinearEncoding;      // the game renders without colour management
        // Lambert like the rest of the world: cheaper on phones than the model's PBR material
        m.mats[o.name] = new THREE.MeshLambertMaterial({ map: om.map, color: om.map ? 0xffffff : om.color, skinning: !!o.isSkinnedMesh,
                                                         transparent: om.transparent, alphaTest: om.alphaTest });
      });
      lib[name] = m;
      Bus.emit('model', name);
    }, undefined, () => { failed[name] = true; });   // no model: the built-in figure stays
  }

  function init(s) {
    scene = s;
    if (!THREE.GLTFLoader || !THREE.SkeletonUtils || !window.fetch) return;
    fetch('web/models/moves.json').then(r => r.json()).then(j => {
      moves = j;                                                 // models load when somebody first needs one
    }).catch(() => { /* opened from disk or offline without a cache: the built-in figure stays */ });
  }

  // Build model m's animation clip for one baked move
  function clip(m, name) {
    if (m.made[name]) return m.made[name];
    const mv = moves.clips[name], n = mv.times.length, b = m.bones;
    const rig = moves.rig.filter(k => b[k]);
    const out = {}, cur = {};
    for (const k of rig) out[k] = new Float32Array(n * 4);
    const hip = new Float32Array(n * 3);
    const Yi = m.Y.clone().invert(), hipPQi = m.hipPQ.clone().invert();
    const q = new THREE.Quaternion(), p = new THREE.Quaternion(), v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      for (const k of rig) {
        const a = mv.rot[k];
        const w = cur[k] || (cur[k] = new THREE.Quaternion());
        w.set(a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]).multiply(m.ref[k]);   // world, in character space
        const par = bare(b[k].parent.name);
        if (cur[par]) p.copy(cur[par]); else p.copy(m.ref[par] || wquat(b[k].parent).premultiply(m.Y));
        q.copy(p).invert().multiply(w).toArray(out[k], i * 4);                           // local to its parent
      }
      v.set(mv.hips[i * 3], mv.hips[i * 3 + 1], mv.hips[i * 3 + 2]).multiplyScalar(m.hipH / m.hipPS)
        .applyQuaternion(Yi).applyQuaternion(hipPQi).add(m.hip0).toArray(hip, i * 3);
    }
    const tracks = rig.map(k => new THREE.QuaternionKeyframeTrack(b[k].name + '.quaternion', mv.times, out[k]));
    tracks.push(new THREE.VectorKeyframeTrack(b.Hips.name + '.position', mv.times, hip));
    return (m.made[name] = new THREE.AnimationClip(name, mv.duration, tracks));
  }

  // ---- props: simple solids pinned to a joint, so a stock model becomes a particular person
  const propMats = {};
  function prop(geo, c) {
    const key = c.join();
    const mat = propMats[key] || (propMats[key] = new THREE.MeshLambertMaterial({ color: new THREE.Color(c[0], c[1], c[2]) }));
    return new THREE.Mesh(geo, mat);
  }
  const G = {
    cyl: (r0, r1, h) => new THREE.CylinderGeometry(r0, r1, h, 18),
    box: (x, y, z) => new THREE.BoxGeometry(x, y, z),
    ball: r => new THREE.SphereGeometry(r, 12, 8)
  };
  const RED = [0.75, 0.10, 0.10], GOLDC = [0.95, 0.75, 0.15], DARK = [0.06, 0.06, 0.08];
  const GREEN = [0.06, 0.48, 0.24], BLACKHAIR = [0.07, 0.05, 0.04];

  // A prop is [joint to hang from, joint to measure from, offset x/y/z, mesh, tilt in degrees, scale].
  // Offsets are world units in character space at rest: x toward the character's left, z forward.
  // 'mid' below is the x offset from the left eye to the middle of the face.
  const mid = -0.032;

  function curls(c, k, dx) {                        // a head of curly hair; k scales it, dx knocks it off-centre
    const at = (x, y, z, r) => ['Head', 'HeadTop_End', [x * k + dx, y, z * k], prop(G.ball(r * k), c)];
    return [at(0, -0.035, -0.015, 0.115), at(0.085, -0.085, -0.02, 0.08), at(-0.085, -0.085, -0.02, 0.08),
            at(0, -0.1, -0.085, 0.1), at(0, -0.17, -0.075, 0.075), at(0.045, -0.03, 0.055, 0.06), at(-0.045, -0.03, 0.055, 0.06)];
  }

  function beard(c) {                               // full and bushy, hung from the jaw
    const at = (x, y, z, r) => ['Head', 'LeftEye', [mid + x, y, z], prop(G.ball(r), c)];
    return [at(0, -0.115, 0.01, 0.07), at(0.057, -0.085, -0.02, 0.055), at(-0.057, -0.085, -0.02, 0.055), at(0, -0.155, -0.005, 0.055)];
  }

  const shades = () => [
    ['Head', 'LeftEye', [0, 0.004, 0.035], prop(G.box(0.066, 0.046, 0.012), DARK)],
    ['Head', 'RightEye', [0, 0.004, 0.035], prop(G.box(0.066, 0.046, 0.012), DARK)],
    ['Head', 'LeftEye', [mid, 0.014, 0.037], prop(G.box(0.03, 0.008, 0.01), GOLDC)]
  ];

  const epaulettes = () => [1, -1].flatMap(sd => [
    [sd > 0 ? 'LeftShoulder' : 'RightShoulder', sd > 0 ? 'LeftArm' : 'RightArm', [0, 0.05, 0], prop(G.box(0.115, 0.02, 0.1), GOLDC)],
    [sd > 0 ? 'LeftShoulder' : 'RightShoulder', sd > 0 ? 'LeftArm' : 'RightArm', [sd * 0.055, 0.028, 0], prop(G.box(0.018, 0.05, 0.1), [0.8, 0.6, 0.1])]
  ]);

  // the solid parts of the dress uniform: belt buckle and a gold stripe down each trouser leg
  const dress = () => [
    ['Hips', 'Spine', [0, 0.0, 0.142], prop(G.box(0.055, 0.05, 0.02), [0.8, 0.6, 0.1])],
    ['LeftLeg', 'LeftLeg', [0.064, -0.2, 0], prop(G.box(0.012, 0.38, 0.04), GOLDC)],
    ['RightLeg', 'RightLeg', [-0.064, -0.2, 0], prop(G.box(0.012, 0.38, 0.04), GOLDC)]
  ];

  // The sash and belt are painted onto the jacket itself, so they wrap round the body and bend with
  // it: the shader colours the jacket by where each point sits in the model's REST pose. A green,
  // gold-edged band runs from the right shoulder to the left hip, and a gold band circles the waist.
  function paint_uniform(mat, m) {
    const b = m.bones, rs = wpos(b.RightArm), lh = wpos(b.LeftUpLeg), waist = wpos(b.Spine);
    const H = wpos(b.HeadTop_End).y - Math.min(wpos(b.LeftToeBase).y, wpos(b.RightToeBase).y);
    const p0 = new THREE.Vector2(rs.x * 0.8, rs.y + 0.02 * H), p1 = new THREE.Vector2(lh.x * 1.9, lh.y + 0.04 * H);
    const d = p1.clone().sub(p0).normalize(), n = new THREE.Vector2(-d.y, d.x);
    const U = {
      uSash: { value: new THREE.Vector4(n.x, n.y, n.dot(p0), 0.03 * H) },                       // band: |n . p - c| < half width
      uBelt: { value: new THREE.Vector4(waist.y, 0.014 * H, Math.abs(rs.x) * 1.12, rs.y + 0.05 * H) },   // waist y, half height, torso half width, top
      uSashCol: { value: new THREE.Color(GREEN[0], GREEN[1], GREEN[2]) },
      uGold: { value: new THREE.Color(GOLDC[0], GOLDC[1], GOLDC[2]) }
    };
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRest;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRest;\nuniform vec4 uSash;\nuniform vec4 uBelt;\nuniform vec3 uSashCol;\nuniform vec3 uGold;')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `vec4 diffuseColor = vec4( diffuse, opacity );
          float sd = abs(vRest.x * uSash.x + vRest.y * uSash.y - uSash.z);
          if (abs(vRest.x) < uBelt.z && vRest.y > uBelt.x && vRest.y < uBelt.w && sd < uSash.w)
            diffuseColor.rgb = sd > uSash.w * 0.72 ? uGold : uSashCol;
          if (abs(vRest.y - uBelt.x) < uBelt.y && abs(vRest.x) < uBelt.z * 1.3) diffuseColor.rgb = uGold;`);
    };
    mat.customProgramCacheKey = () => 'dress-uniform';
  }

  const medals = () => [-1, 0, 1].flatMap(i => [
    ['Spine2', 'Spine2', [0.08 + i * 0.038, 0.115, 0.122], prop(G.box(0.028, 0.03, 0.01), [RED, [0.1, 0.4, 0.8], GOLDC][i + 1])],
    ['Spine2', 'Spine2', [0.08 + i * 0.038, 0.085, 0.124], prop(G.cyl(0.016, 0.016, 0.008), GOLDC), [90, 0, 0]]
  ]);

  function bib(n) {                                 // a race number, drawn once onto a small texture
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 96;
    const c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, 128, 96);
    c.strokeStyle = '#223'; c.lineWidth = 5; c.strokeRect(3, 3, 122, 90);
    c.fillStyle = '#16203a'; c.font = '900 62px Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(n), 64, 52);
    const mat = new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(cv) });
    const plate = z => ['Spine2', 'Spine2', [0, 0.03, z], new THREE.Mesh(G.box(0.2, 0.15, 0.008), mat), z < 0 ? [0, 180, 0] : null];
    return [plate(0.13), plate(-0.114)];
  }

  // Several prop solids baked into one geometry (each moved by its own matrix), to save draw calls
  function merged(items) {
    let nv = 0, ni = 0;
    for (const it of items) { nv += it.geo.attributes.position.count; ni += it.geo.index.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint16Array(ni);
    const v = new THREE.Vector3(), nm = new THREE.Matrix3();
    let vo = 0, io = 0;
    for (const it of items) {
      const P = it.geo.attributes.position, N = it.geo.attributes.normal, U = it.geo.attributes.uv, I = it.geo.index;
      nm.getNormalMatrix(it.matrix);
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(it.matrix).toArray(pos, (vo + i) * 3);
        v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize().toArray(nor, (vo + i) * 3);
        uv[(vo + i) * 2] = U.getX(i); uv[(vo + i) * 2 + 1] = U.getY(i);
      }
      for (let i = 0; i < I.count; i++) idx[io + i] = I.getX(i) + vo;
      vo += P.count; io += I.count;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    return g;
  }

  // a gold pistol in the right hand, lying along the forearm so it points wherever the arm does
  const pistol = () => [
    ['RightHand', 'RightHand', [0, 0.15, 0], prop(G.box(0.034, 0.2, 0.044), GOLDC), null, null, 'RightForeArm'],
    ['RightHand', 'RightHand', [0, 0.07, 0], prop(G.box(0.05, 0.1, 0.07), [0.8, 0.6, 0.1]), null, null, 'RightForeArm']
  ];

  // flat: outfit parts that lose their texture, so tint gives a clean uniform / sports kit colour
  const KITS = {
    // Admiral General Aladeen: white dress uniform, sash, medals, aviators, and a great deal of beard
    aladeen: { flat: ['top', 'bottom'], sash: true,
               props: () => [...curls(BLACKHAIR, 1, 0), ...beard(BLACKHAIR), ...shades(), ...epaulettes(), ...dress(), ...medals(), ...pistol()] },
    // Efawadh, the body double: the same outfit put on in a hurry, and nobody trusted him with medals
    double: { flat: ['top', 'bottom'], sash: true,
              props: () => [...curls(BLACKHAIR, 1.18, 0.025), ...beard(BLACKHAIR), ...shades(), ...epaulettes(), ...dress(), ...pistol()] },
    // a rival athlete: bright national colours, a race number front and back, no hat
    runner: { flat: ['top', 'bottom'], lean: true,
              props: seed => [...curls([[0.1, 0.08, 0.06], [0.3, 0.18, 0.08], [0.75, 0.6, 0.3], [0.04, 0.04, 0.04]][seed % 4], 0.86, 0),
                              ...bib(100 + seed % 400)] },
    // the other playable athletes: themselves, plus the pistol
    gun: { flat: [], props: () => pistol() },
    // Aladeen's officials, who carry the finish tape out to him: dark suits and sunglasses
    official: { flat: ['top', 'bottom'], props: () => [...curls([0.05, 0.05, 0.05], 0.84, 0), ...shades()] },
  };

  class Actor {
    constructor(m, kit) {
      this.model = m;
      this.kit = kit || '';
      const K = KITS[this.kit];
      this.root = new THREE.Group();
      const body = THREE.SkeletonUtils.clone(m.src);
      body.scale.setScalar(m.scale);
      body.position.y = m.feet;
      body.rotation.y = -m.yaw;                                  // inside the root, every model faces +z
      this.root.add(body);
      this.bones = bonesOf(body);
      this.parts = [];
      body.traverse(o => {
        if (!o.isMesh) return;
        if (K && /Headwear/.test(o.material.name)) o.visible = false;   // the stock hat and hair make way for the kit's own
        if (K && K.lean && /Eye|Teeth/.test(o.name)) o.visible = false; // rivals are seen from behind: skip the tiny face meshes
        const part = /Outfit_Top/.test(o.name) ? 'top' : /Outfit_Bottom/.test(o.name) ? 'bottom' : /Footwear/.test(o.name) ? 'shoes' : 'body';
        o.material = m.mats[o.name].clone();
        if (K && K.flat.includes(part)) o.material.map = null;
        if (K && K.sash && part == 'top') paint_uniform(o.material, m);
        o.frustumCulled = false;                                 // its bounds are for the rest pose only
        this.parts.push({ mat: o.material, part, mesh: o });
      });

      if (K) {                                                   // pin the props on while the skeleton is still at rest
        this.root.updateMatrixWorld(true);
        const inv = new THREE.Matrix4(), want = new THREE.Matrix4(), rot = new THREE.Quaternion();
        const groups = {};                                       // props on the same joint in the same material draw as one mesh
        for (const [parent, at, off, mesh, tilt, size, along] of K.props(Math.floor(Math.random() * 1e6))) {
          if (!this.bones[parent] || !this.bones[at]) continue;  // this model has no such joint (eyes, for one)
          const pos = wpos(this.bones[at]);
          if (along && this.bones[along]) {                      // laid along a limb: off[1] is how far past the joint
            const dir = pos.clone().sub(wpos(this.bones[along])).normalize();
            rot.setFromUnitVectors(UP, dir);
            pos.addScaledVector(dir, off[1]);
          } else {
            pos.add(new THREE.Vector3(off[0], off[1], off[2]));
            rot.setFromEuler(new THREE.Euler(...(tilt || [0, 0, 0]).map(d => d * DEG)));
          }
          want.compose(pos, rot, new THREE.Vector3(...(size || [1, 1, 1])));
          const key = parent + '|' + mesh.material.uuid;
          const gr = groups[key] || (groups[key] = { parent, mat: mesh.material, items: [] });
          gr.items.push({ geo: mesh.geometry, matrix: inv.copy(this.bones[parent].matrixWorld).invert().multiply(want).clone() });
        }
        for (const k in groups) this.bones[groups[k].parent].add(new THREE.Mesh(merged(groups[k].items), groups[k].mat));
      }

      this.mixer = new THREE.AnimationMixer(body);
      this.run = this.mixer.clipAction(clip(m, 'run'));
      this.idle = this.mixer.clipAction(clip(m, 'idle'));
      this.run.play(); this.idle.play();
      this.mixer.setTime(Math.random() * 2);                     // rivals should not run in step
      this.used = false;
      scene.add(this.root);
      all.push(this);
    }

    // Straighten the right arm along a world direction: the pistol arm, while he is firing.
    // Each segment is turned, in world space, from where it points now to where it should point.
    point(aim, k) {
      v1.set(aim[0], aim[1], aim[2]).normalize();
      for (const [a, b] of [['RightArm', 'RightForeArm'], ['RightForeArm', 'RightHand']]) {
        const A = this.bones[a], B = this.bones[b];
        if (!A || !B) return;
        A.updateWorldMatrix(true, true);
        B.getWorldPosition(v2).sub(A.getWorldPosition(v3)).normalize();
        qr.setFromUnitVectors(v2, v1);
        qi.identity().slerp(qr, k);
        A.parent.getWorldQuaternion(qp);
        A.quaternion.premultiply(qp).premultiply(qi).premultiply(qp.invert());
        A.userData.out.copy(A.quaternion);
        A.userData.posed = true;
      }
    }

    // o: x, y, z, dt, rate (stride speed), dir (sideways drift per unit forward: the heading) or yaw (radians),
    //    slide / air / fear / cheer / stand in 0..1, tint { top, bottom, shoes, all } of rgb arrays
    show(o) {
      const sl = o.slide || 0, air = (o.air || 0) * (1 - sl), fear = (o.fear || 0) * (1 - sl);
      const still = Math.max(sl, fear, o.stand || 0);            // these poses start from standing, not mid-stride
      this.run.setEffectiveWeight(1 - still);
      this.idle.setEffectiveWeight(still);
      this.run.timeScale = o.rate * (1 - 0.6 * air);
      this.mixer.update(o.dt);

      const r = this.root;
      r.visible = true;
      this.used = true;
      r.position.set(o.x, o.y - 0.93 * sl, o.z - 0.2 * sl);     // sit down onto the road
      // runners head down the track (-z), turned to follow it; the slide adds a baseball-style twist
      r.rotation.set(0, (o.yaw !== undefined ? o.yaw : Math.atan2(o.dir || 0, -1)) + 0.35 * sl, 0);
      qh.copy(r.quaternion).invert();

      // The mixer only rewrites a joint when its clip value changed, so a pose added last frame may
      // still be sitting in the joint. Put the clip's own rotation back before adding to it again.
      for (const name of ORDER) {
        const b = this.bones[name];
        if (!b) continue;
        const u = b.userData;
        if (!u.base) { u.base = new THREE.Quaternion(); u.out = new THREE.Quaternion(); u.posed = false; }
        if (u.posed && b.quaternion.equals(u.out)) b.quaternion.copy(u.base); else u.base.copy(b.quaternion);
        u.posed = false;
      }

      const w = { slide: sl, air, fear, cheer: (o.cheer || 0) * (1 - sl) * (1 - fear), tired: (o.tired || 0) * (1 - still) };
      for (const name of ORDER) {
        let px = 0, py = 0, pz = 0;
        for (const k in w) {
          const d = w[k] && POSES[k][name];
          if (d) { px += d[0] * w[k]; py += d[1] * w[k]; pz += d[2] * w[k]; }
        }
        if (!px && !py && !pz) continue;
        const b = this.bones[name];
        if (!b) continue;
        // rotate the bone by R in character space:  local' = P^-1 * R * P * local,  P = parent in character space
        b.parent.getWorldQuaternion(qp).premultiply(qh);
        qr.setFromEuler(eul.set(px * DEG, py * DEG, pz * DEG));
        b.quaternion.premultiply(qp).premultiply(qr).premultiply(qp.invert());
        b.userData.out.copy(b.quaternion);
        b.userData.posed = true;
      }

      if (o.aimK > 0 && o.aim) this.point(o.aim, o.aimK);

      const t = o.tint || {};
      for (const p of this.parts) {
        const c = t[p.part] || t.all || white;
        p.mat.color.setRGB(c[0], c[1], c[2]);
      }
    }
  }

  // A model is fetched the first time it is asked for, so a phone only downloads who is on screen
  const wanted = {}, failed = {};
  function ready(name) {
    if (moves && lib[name]) return lib[name];
    if (moves && MODELS[name] && !wanted[name]) { wanted[name] = true; load(name); }
    return null;
  }
  const busy = () => Object.keys(wanted).some(n => !lib[n] && !failed[n]);

  // ---- who is on stage: one actor per (model, kit) for the player, pooled actors for everyone else
  const heroes = {}, casts = {};
  const spare = (m, kit) => all.find(a => a.model == m && a.kit == kit && !a.used && !a.owner && !a.cast &&
                                          !Object.values(heroes).includes(a)) || new Actor(m, kit);

  function player(name, kit) {
    const m = ready(name);
    if (!m) return null;
    const key = name + '/' + (kit || '');
    return heroes[key] || (heroes[key] = new Actor(m, kit));
  }

  function rival(r, name) {                         // kept on the rival object while it lives
    const m = ready(name);
    if (!m) return null;
    if (!r.actor || r.actor.model != m) {
      if (r.actor) r.actor.owner = null;
      r.actor = spare(m, 'runner');
    }
    r.actor.owner = r;
    return r.actor;
  }

  function cast(key, name, kit) {                   // scenery extras (the officials with the tape), kept by key while they are drawn
    const m = ready(name);
    if (!m) return null;
    if (!casts[key]) (casts[key] = spare(m, kit)).cast = key;
    return casts[key];
  }

  function begin() {
    for (const a of all) a.used = false;
  }

  function end() {                                  // whoever was not drawn this frame leaves the stage
    for (const a of all) {
      if (a.used) continue;
      a.root.visible = false;
      if (a.owner) {
        if (a.owner.actor == a) a.owner.actor = null;
        a.owner = null;
      }
      if (a.cast) {
        delete casts[a.cast];
        a.cast = null;
      }
    }
  }

  // ---- a head-and-shoulders picture of an athlete for the roster, rendered once and kept as a data URL
  const shots = {};
  function portrait(name, kit, tint) {
    const key = name + '/' + (kit || '');
    if (shots[key]) return shots[key];
    const a = player(name, kit);
    if (!a || typeof ren == 'undefined') return null;
    const N = 192, rt = new THREE.WebGLRenderTarget(N, N), sc = new THREE.Scene();
    const sun = new THREE.DirectionalLight(0xffffff, 0.75);
    sun.position.set(0.6, 1, 1.2);
    sc.add(new THREE.AmbientLight(0xffffff, 0.7), sun);
    const was = { used: a.used, on: a.root.visible };
    a.show({ x: 0, y: 0, z: 0, dt: 0, rate: 1, stand: 1, yaw: 0.3, tint });
    sc.add(a.root);                                              // borrowed from the game's scene for one render
    const cm = new THREE.PerspectiveCamera(24, 1, 0.1, 20);
    cm.position.set(0, 1.66, 2.3);
    cm.lookAt(0, 1.62, 0);
    const buf = new Uint8Array(N * N * 4);
    ren.setRenderTarget(rt);
    ren.clear();
    ren.render(sc, cm);
    ren.readRenderTargetPixels(rt, 0, 0, N, N, buf);
    ren.setRenderTarget(null);
    rt.dispose();
    scene.add(a.root);
    a.root.visible = was.on; a.used = was.used;
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const cx = cv.getContext('2d'), img = cx.createImageData(N, N);
    for (let y = 0; y < N; y++) img.data.set(buf.subarray((N - 1 - y) * N * 4, (N - y) * N * 4), y * N * 4);   // GL rows run bottom-up
    cx.putImageData(img, 0, 0);
    return (shots[key] = cv.toDataURL());
  }

  return { init, player, rival, cast, portrait, begin, end, busy, ready: name => !!ready(name) };
})();
