/*
 * glshim.js - a tiny immediate-mode OpenGL / GLUT emulation on top of Three.js
 *
 * Why: native/11.py draws with legacy OpenGL (glPushMatrix, glTranslatef, glutSolidCube,
 * glBegin ... glEnd). This file provides functions with the same names so that the drawing
 * code in game.js can stay a line-by-line port of the Python version.
 *
 * How: every draw call grabs a pooled Three.js object, copies the current matrix / colour /
 * state into it and makes it visible for this frame. Objects not used in a frame are hidden.
 *   - glutSolid*      -> pooled THREE.Mesh with a cached unit geometry
 *   - glBegin/glEnd   -> pooled dynamic BufferGeometry (Mesh, Points or LineSegments)
 *   - glEnable(GL_LIGHTING) / GL_FOG / GL_BLEND, glBlendFunc, glDepthMask -> material choice
 *   - renderOrder follows call order, so blending happens in the same order as in OpenGL
 */
(function (global) {
  'use strict';

  // ---- constants (values only need to be distinct)
  const C = {
    GL_LIGHTING: 1, GL_FOG: 2, GL_BLEND: 3, GL_DEPTH_TEST: 4,
    GL_QUADS: 10, GL_TRIANGLES: 11, GL_TRIANGLE_FAN: 12, GL_POINTS: 13, GL_LINES: 14,
    GL_SRC_ALPHA: 20, GL_ONE: 21, GL_ONE_MINUS_SRC_ALPHA: 22,
    GL_FALSE: false, GL_TRUE: true
  };

  let scene = null;
  const M = new THREE.Matrix4();          // current modelview (world space; the camera is separate)
  const stack = [];
  const tmp = new THREE.Matrix4();
  const axis = new THREE.Vector3();
  const st = { light: true, fog: true, blend: false, add: false, depth: true, point: 1 };
  const col = [1, 1, 1, 1];
  const nrm = [0, 1, 0];
  let order = 0;

  // ---- materials: one cache entry per (kind, state) and per pooled object
  function stateKey() {
    return (st.light ? 'L' : 'u') + (st.fog ? 'F' : 'f') + (st.blend ? (st.add ? 'A' : 'B') : 'o') + (st.depth ? 'D' : 'd');
  }

  function applyBlend(m) {
    m.transparent = st.blend;
    m.blending = st.blend && st.add ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.depthWrite = st.depth;
    m.fog = st.fog;
  }

  // GL_POINT_SMOOTH: cut each square point sprite down to a solid disc in the fragment shader
  function roundPoints(m) {
    m.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('void main() {',
        'void main() {\n\tif (length(gl_PointCoord - vec2(0.5)) > 0.5) discard;');
    };
    return m;
  }

  // ---- pooled solids
  const geos = {};
  const pools = {};

  function geo(key, make) {
    return geos[key] || (geos[key] = make());
  }

  function solid(key, make, sx, sy, sz) {
    const p = pools[key] || (pools[key] = { list: [], used: 0 });
    let o = p.list[p.used];
    if (!o) {
      o = new THREE.Mesh(geo(key, make));
      o.matrixAutoUpdate = false;
      o.frustumCulled = false;
      o.userData.mats = {};
      scene.add(o);
      p.list.push(o);
    }
    p.used++;
    const k = stateKey();
    let m = o.userData.mats[k];
    if (!m) {
      m = st.light ? new THREE.MeshLambertMaterial() : new THREE.MeshBasicMaterial();
      applyBlend(m);
      o.userData.mats[k] = m;
    }
    m.color.setRGB(col[0], col[1], col[2]);
    m.opacity = st.blend ? col[3] : 1;
    o.material = m;
    o.matrix.copy(M).multiply(tmp.makeScale(sx, sy, sz));
    o.matrixWorldNeedsUpdate = true;
    o.renderOrder = order++;
    o.visible = true;
  }

  function glutSolidCube(s) {
    solid('cube', () => new THREE.BoxGeometry(1, 1, 1), s, s, s);
  }

  function glutSolidSphere(r, sl, sk) {
    solid('sph' + sl + '_' + sk, () => new THREE.SphereGeometry(1, sl, sk), r, r, r);
  }

  // GLUT cone: base disc at z = 0, apex at z = +height
  function glutSolidCone(base, h, sl) {
    solid('cone' + sl, () => new THREE.ConeGeometry(1, 1, sl, 1).rotateX(Math.PI / 2).translate(0, 0, 0.5), base, base, h);
  }

  // GLUT torus lies in the XY plane, like THREE.TorusGeometry
  function glutSolidTorus(inner, outer, sides, rings) {
    solid('tor' + inner + '_' + outer, () => new THREE.TorusGeometry(outer, inner, sides, rings), 1, 1, 1);
  }

  // ---- immediate mode: glBegin / glVertex / glEnd
  let prim = 0;
  const vp = [], vc = [], vn = [];
  const v3 = new THREE.Vector3();
  const n3 = new THREE.Matrix3();

  function glBegin(p) {
    prim = p;
    vp.length = vc.length = vn.length = 0;
    n3.getNormalMatrix(M);
  }

  function glVertex3f(x, y, z) {
    v3.set(x, y, z).applyMatrix4(M);
    vp.push(v3.x, v3.y, v3.z);
    vc.push(col[0], col[1], col[2], col[3]);
    v3.set(nrm[0], nrm[1], nrm[2]).applyMatrix3(n3).normalize();
    vn.push(v3.x, v3.y, v3.z);
  }

  const dyn = { mesh: { list: [], used: 0 }, points: { list: [], used: 0 }, lines: { list: [], used: 0 } };

  function dynObj(kind, n) {
    const p = dyn[kind];
    let o = p.list[p.used];
    if (!o) {
      const g = new THREE.BufferGeometry();
      o = kind == 'mesh' ? new THREE.Mesh(g) : kind == 'points' ? new THREE.Points(g) : new THREE.LineSegments(g);
      o.frustumCulled = false;
      o.userData.cap = 0;
      o.userData.mats = {};
      scene.add(o);
      p.list.push(o);
    }
    p.used++;
    if (o.userData.cap < n) {                       // grow buffers
      const cap = Math.max(64, n * 2), g = o.geometry;
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage));
      o.userData.cap = cap;
    }
    const k = stateKey() + (kind == 'points' ? st.point : '');
    let m = o.userData.mats[k];
    if (!m) {
      if (kind == 'mesh')
        m = st.light ? new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
                     : new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
      else if (kind == 'points')
        m = roundPoints(new THREE.PointsMaterial({ vertexColors: true, size: st.point, sizeAttenuation: false }));
      else
        m = new THREE.LineBasicMaterial({ vertexColors: true });
      applyBlend(m);
      o.userData.mats[k] = m;
    }
    o.material = m;
    o.renderOrder = order++;
    o.visible = true;
    return o;
  }

  function fill(o, idx) {
    const g = o.geometry, P = g.attributes.position.array, Cc = g.attributes.color.array, N = g.attributes.normal.array;
    for (let j = 0; j < idx.length; j++) {
      const i = idx[j];
      P[j * 3] = vp[i * 3]; P[j * 3 + 1] = vp[i * 3 + 1]; P[j * 3 + 2] = vp[i * 3 + 2];
      N[j * 3] = vn[i * 3]; N[j * 3 + 1] = vn[i * 3 + 1]; N[j * 3 + 2] = vn[i * 3 + 2];
      Cc[j * 4] = vc[i * 4]; Cc[j * 4 + 1] = vc[i * 4 + 1]; Cc[j * 4 + 2] = vc[i * 4 + 2]; Cc[j * 4 + 3] = vc[i * 4 + 3];
    }
    g.setDrawRange(0, idx.length);
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.normal.needsUpdate = true;
  }

  function glEnd() {
    const n = vp.length / 3, idx = [];
    if (!n) return;
    if (prim == C.GL_QUADS) {
      for (let q = 0; q + 3 < n; q += 4) idx.push(q, q + 1, q + 2, q, q + 2, q + 3);
    } else if (prim == C.GL_TRIANGLE_FAN) {
      for (let i = 1; i + 1 < n; i++) idx.push(0, i, i + 1);
    } else {
      for (let i = 0; i < n; i++) idx.push(i);
    }
    const kind = prim == C.GL_POINTS ? 'points' : prim == C.GL_LINES ? 'lines' : 'mesh';
    fill(dynObj(kind, idx.length), idx);
  }

  // ---- state
  function glEnable(c) { set(c, true); }
  function glDisable(c) { set(c, false); }
  function set(c, v) {
    if (c == C.GL_LIGHTING) st.light = v;
    else if (c == C.GL_FOG) st.fog = v;
    else if (c == C.GL_BLEND) st.blend = v;
  }
  function glBlendFunc(s, d) { st.add = d == C.GL_ONE; }
  function glDepthMask(v) { st.depth = v; }
  function glPointSize(s) { st.point = s; }
  function glLineWidth() { /* WebGL lines are always 1 px */ }
  function glColor3f(r, g, b) { col[0] = r; col[1] = g; col[2] = b; col[3] = 1; }
  function glColor4f(r, g, b, a) { col[0] = r; col[1] = g; col[2] = b; col[3] = a; }
  function glNormal3f(x, y, z) { nrm[0] = x; nrm[1] = y; nrm[2] = z; }

  // ---- matrix stack
  function glLoadIdentity() { M.identity(); }
  let depth = 0;                                    // stack slots are reused, so pushes allocate nothing
  function glPushMatrix() { (stack[depth] || (stack[depth] = new THREE.Matrix4())).copy(M); depth++; }
  function glPopMatrix() { M.copy(stack[--depth]); }
  function glTranslatef(x, y, z) { M.multiply(tmp.makeTranslation(x, y, z)); }
  function glScalef(x, y, z) { M.multiply(tmp.makeScale(x, y, z)); }
  function glRotatef(a, x, y, z) {
    axis.set(x, y, z).normalize();
    M.multiply(tmp.makeRotationAxis(axis, a * Math.PI / 180));
  }

  // ---- fog + the two fixed-function lights used by the game
  let amb, sun, torch;

  function glFog(c, start, end) {
    scene.fog.color.setRGB(c[0], c[1], c[2]);
    scene.fog.near = start;
    scene.fog.far = end;
  }
  function glLightModelAmbient(c) { amb.color.setRGB(c[0], c[1], c[2]); }
  // GL_LIGHT0, w = 0: directional light coming from 'dir'
  function glLight0(diffuse, dir) {
    sun.color.setRGB(diffuse[0], diffuse[1], diffuse[2]);
    sun.position.set(dir[0], dir[1], dir[2]);
  }
  // GL_LIGHT1, w = 1: point light. Three.js has no 1 / (1 + 0.08 d) attenuation,
  // so a 45-unit falloff with decay 1.6 approximates GL_LINEAR_ATTENUATION 0.08.
  function glLight1(diffuse, pos) {
    torch.color.setRGB(diffuse[0], diffuse[1], diffuse[2]);
    torch.position.set(pos[0], pos[1], pos[2]);
  }

  // ---- frame
  function init(s) {
    scene = s;
    scene.fog = new THREE.Fog(0xffffff, 25, 105);
    amb = new THREE.AmbientLight(0xffffff, 1);
    sun = new THREE.DirectionalLight(0xffffff, 1);
    torch = new THREE.PointLight(0x000000, 1, 45, 1.6);
    scene.add(amb, sun, torch);
  }

  function beginFrame() {
    for (const k in pools) pools[k].used = 0;
    for (const k in dyn) dyn[k].used = 0;
    order = 0;
    M.identity();
    depth = 0;
    Object.assign(st, { light: true, fog: true, blend: false, add: false, depth: true, point: 1 });
  }

  function endFrame() {                             // hide whatever was not drawn this frame
    for (const k in pools) { const p = pools[k]; for (let i = p.used; i < p.list.length; i++) p.list[i].visible = false; }
    for (const k in dyn) { const p = dyn[k]; for (let i = p.used; i < p.list.length; i++) p.list[i].visible = false; }
  }

  Object.assign(global, C, {
    GLShim: { init, beginFrame, endFrame },
    glutSolidCube, glutSolidSphere, glutSolidCone, glutSolidTorus,
    glBegin, glVertex3f, glEnd,
    glEnable, glDisable, glBlendFunc, glDepthMask, glPointSize, glLineWidth,
    glColor3f, glColor4f, glNormal3f,
    glFog, glLightModelAmbient, glLight0, glLight1,
    glLoadIdentity, glPushMatrix, glPopMatrix, glTranslatef, glScalef, glRotatef
  });
})(window);
