/* The hand-rolled WebGL2 core: just enough for a pyramid, a barbell, a few
 * fullscreen shader passes, GPU point particles and screen-space lines.
 * No library — see DECISIONS.md for why. Everything here is generic; the
 * scenes live in js/backdrop-gl.js. */

export function compile(gl, vsSource, fsSource) {
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
    }
    return s;
  };
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, vsSource));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`link: ${gl.getProgramInfoLog(program)}`);
  }
  // Uniform locations, resolved once and cached by name.
  const cache = new Map();
  const loc = (name) => {
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
    return cache.get(name);
  };
  return {
    program,
    use() { gl.useProgram(program); return this; },
    f(name, ...v) { gl[`uniform${v.length}f`](loc(name), ...v); return this; },
    fv(name, arr) { gl.uniform1fv(loc(name), arr); return this; },
    i(name, v) { gl.uniform1i(loc(name), v); return this; },
    m4(name, m) { gl.uniformMatrix4fv(loc(name), false, m); return this; },
    rgb(name, c) { gl.uniform3f(loc(name), c[0] / 255, c[1] / 255, c[2] / 255); return this; }
  };
}

/** A vertex array from interleaved float data. `layout` is [[location, size], …]. */
export function vao(gl, data, layout, usage = gl.STATIC_DRAW) {
  const va = gl.createVertexArray();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(va);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  const stride = layout.reduce((n, [, size]) => n + size, 0) * 4;
  let offset = 0;
  for (const [location, size] of layout) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
    offset += size * 4;
  }
  gl.bindVertexArray(null);
  return { va, buffer, count: data.length / (stride / 4) };
}

/** An RGBA8 colour target the scene renders into before the bounding pass. */
export function target(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const depth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return {
    tex, fbo, w, h,
    free() { gl.deleteTexture(tex); gl.deleteFramebuffer(fbo); gl.deleteRenderbuffer(depth); }
  };
}

/* ---------- column-major 4×4 matrices, only what the scenes use ---------- */

export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let s = 0;
      for (let k = 0; k < 4; k += 1) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

export function rotationX(a) {
  const c = Math.cos(a); const s = Math.sin(a);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

export function rotationY(a) {
  const c = Math.cos(a); const s = Math.sin(a);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

export function translation(x, y, z) {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

/** Squeezes clip space vertically into [y0, y1] of NDC, so a camera framed for
 *  the "feature band" lands in that band while anything taller (the halo)
 *  still draws above it instead of being clipped by a viewport. */
export function bandMatrix(y0, y1) {
  const sy = (y1 - y0) / 2;
  const ty = (y1 + y0) / 2;
  return new Float32Array([1, 0, 0, 0, 0, sy, 0, 0, 0, 0, 1, 0, 0, ty, 0, 1]);
}

/** World point → NDC [x, y], via a column-major MVP. */
export function project(m, [x, y, z]) {
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [cx / cw, cy / cw];
}

/** Thick polyline in NDC as a triangle list, `width` in pixels. WebGL line
 *  width is 1px on most platforms, which is not a lightning bolt. Each vertex
 *  carries [x, y, along] where `along` (0 at the centre line, 1 at the edge)
 *  lets the shader feather the edge. */
export function strokeNDC(points, widthPx, viewW, viewH, out = []) {
  const hx = widthPx / viewW;
  const hy = widthPx / viewH;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    let dx = (x1 - x0) * viewW;
    let dy = (y1 - y0) * viewH;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const nx = -dy * hx;
    const ny = dx * hy;
    out.push(
      x0 - nx, y0 - ny, 1, x0 + nx, y0 + ny, -1, x1 + nx, y1 + ny, -1,
      x0 - nx, y0 - ny, 1, x1 + nx, y1 + ny, -1, x1 - nx, y1 - ny, 1
    );
  }
  return out;
}
