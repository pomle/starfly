// Thin WebGL2 helpers: context creation, shader/program building, resize.

export function createContext(canvas, attrs = {}) {
  const gl = canvas.getContext('webgl2', { antialias: true, ...attrs });
  if (!gl) throw new Error('WebGL2 is not supported by this browser.');
  return gl;
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error:\n${log}\n${source}`);
  }
  return shader;
}

/** Builds a program and returns { program, uniforms, attribs } with locations cached by name. */
export function createProgram(gl, vertexSrc, fragmentSrc) {
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error:\n${log}`);
  }

  const uniforms = {};
  const nUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nUniforms; i++) {
    const { name } = gl.getActiveUniform(program, i);
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  const attribs = {};
  const nAttribs = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < nAttribs; i++) {
    const { name } = gl.getActiveAttrib(program, i);
    attribs[name] = gl.getAttribLocation(program, name);
  }
  return { program, uniforms, attribs };
}

/** Creates a static/dynamic buffer from a typed array. */
export function createBuffer(gl, data, target = gl.ARRAY_BUFFER, usage = gl.STATIC_DRAW) {
  const buf = gl.createBuffer();
  gl.bindBuffer(target, buf);
  gl.bufferData(target, data, usage);
  return buf;
}

/** Matches the canvas drawing buffer to its CSS size (HiDPI aware). Returns true if changed. */
export function resizeCanvasToDisplaySize(canvas, maxDpr = 2) {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}
