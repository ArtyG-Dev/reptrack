/* WebGL2 renderer for the 3D muscle map (js/mannequin.js has the geometry).
 * Its own small context on its own canvas, drawn on demand: on the Progress
 * screen nothing runs between frames, so it costs nothing at rest. The
 * full-screen view drives it at up to 30 fps (js/views/muscle-map.js).
 *
 * Colours come only from CSS custom properties, read by the caller:
 * --heat-0…--heat-3 for the muscle groups, --border for the mannequin itself
 * and --accent for the selected group's rim. No literal colour lives here.
 */

import { compile, vao, perspective, multiply } from './gl.js';
import { MUSCLES } from './exercises-seed.js';
import { mannequinParts, mannequinMesh, cameraPose, FOV } from './mannequin.js';

const VS = `#version 300 es
layout(location = 0) in vec3 aP;
layout(location = 1) in vec3 aN;
layout(location = 2) in float aM;
uniform mat4 uVP;
uniform float uLevel[${MUSCLES.length}];
uniform float uSel;
out vec3 vN;
flat out float vLevel;
flat out float vSel;
void main() {
  int m = int(aM + 0.5);
  vLevel = aM < -0.5 ? -1.0 : uLevel[m];
  vSel = (aM > -0.5 && abs(aM - uSel) < 0.5) ? 1.0 : 0.0;
  vN = aN;
  gl_Position = uVP * vec4(aP, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vN;
flat in float vLevel;
flat in float vSel;
uniform vec3 uHeat0, uHeat1, uHeat2, uHeat3, uBase, uSelect, uLight, uView;
out vec4 o;
void main() {
  vec3 n = normalize(vN);
  vec3 c = vLevel < -0.5 ? uBase : vLevel < 0.5 ? uHeat0 : vLevel < 1.5 ? uHeat1 : vLevel < 2.5 ? uHeat2 : uHeat3;
  // Soft, narrow-range shading: enough to read the form, never enough to
  // move a colour far from the token it stands for.
  float light = 0.78 + 0.22 * max(dot(n, normalize(uLight)), 0.0);
  c *= light;
  float rim = pow(1.0 - max(dot(n, normalize(uView)), 0.0), 2.0);
  c = mix(c, uSelect, vSel * (0.35 + 0.65 * rim));
  o = vec4(c, 1.0);
}`;

/** A view matrix (column-major) for a camera pose from mannequin.cameraPose(). */
function viewMatrix({ eye, forward: f, right: r, up: u }) {
  const d = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return new Float32Array([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -d(r, eye), -d(u, eye), d(f, eye), 1]);
}

/** null when WebGL2 is unavailable or the program fails to build. */
export function createMannequinRenderer(canvas) {
  let gl = null;
  try { gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'low-power' }); } catch { gl = null; }
  if (!gl) return null;
  let prog;
  try { prog = compile(gl, VS, FS); } catch (error) { console.warn('3D muscle map failed to build; using the flat figures.', error); return null; }

  const meshes = new Map();
  const meshFor = (figure) => {
    if (!meshes.has(figure)) meshes.set(figure, vao(gl, mannequinMesh(mannequinParts(figure)), [[0, 3], [1, 3], [2, 1]]));
    return meshes.get(figure);
  };

  return {
    gl,
    /** Draw one frame. `view`: { figure, yaw, pitch, levels: number[18], selected: index | −1, colours }. */
    render({ figure = 'neutral', yaw, pitch, levels, selected = -1, colours }) {
      if (gl.isContextLost()) return false;
      const w = canvas.width; const h = canvas.height;
      const aspect = w / Math.max(h, 1);
      const pose = cameraPose(yaw, pitch, aspect);
      const vp = multiply(perspective(FOV, aspect, 0.1, 20), viewMatrix(pose));
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      const back = pose.forward.map((v) => -v);
      prog.use().m4('uVP', vp).fv('uLevel', levels).f('uSel', selected)
        .rgb('uHeat0', colours.heat[0]).rgb('uHeat1', colours.heat[1]).rgb('uHeat2', colours.heat[2]).rgb('uHeat3', colours.heat[3])
        .rgb('uBase', colours.base).rgb('uSelect', colours.select)
        .f('uLight', back[0] - 0.3, back[1] + 0.6, back[2]).f('uView', back[0], back[1], back[2]);
      const mesh = meshFor(figure);
      gl.bindVertexArray(mesh.va);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      gl.bindVertexArray(null);
      return true;
    },
    readPixels() {
      const out = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return { width: canvas.width, height: canvas.height, data: out };
    }
  };
}
