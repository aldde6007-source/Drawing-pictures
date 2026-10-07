// ぶたいの はいけい(画像ファイルは つかわず、Canvas で かく)

export const BACKGROUNDS = ['white', 'sky', 'field', 'sea', 'night', 'dream'];

const TAU = Math.PI * 2;

/** いつも おなじ ならびになる 乱数(はいけいが かくたびに かわらないように) */
function rng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function vgrad(ctx, y0, y1, c0, c1) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, c0);
  g.addColorStop(1, c1);
  return g;
}

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function sky(ctx, W, H) {
  ctx.fillStyle = vgrad(ctx, 0, H, '#9fd8ff', '#e9f7ff');
  ctx.fillRect(0, 0, W, H);
}

function sun(ctx, x, y, r) {
  const glow = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2);
  glow.addColorStop(0, 'rgba(255, 241, 168, 0.8)');
  glow.addColorStop(1, 'rgba(255, 241, 168, 0)');
  ctx.fillStyle = glow;
  circle(ctx, x, y, r * 2);
  ctx.fillStyle = '#ffe27a';
  circle(ctx, x, y, r);
}

function cloud(ctx, x, y, s) {
  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  for (const [dx, dy, r] of [[-40, 8, 26], [-12, -10, 34], [22, -4, 30], [48, 10, 22], [0, 14, 28]]) {
    circle(ctx, x + dx * s, y + dy * s, r * s);
  }
}

function heart(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.3);
  ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.75, x, y + s);
  ctx.bezierCurveTo(x, y + s * 0.75, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
  ctx.fill();
}

function star(ctx, x, y, r) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

const PAINTERS = {
  white(ctx, W, H) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffe3ef';
    for (let y = 14; y < H; y += 28) {
      for (let x = (y / 28) % 2 ? 28 : 14; x < W; x += 28) circle(ctx, x, y, 3);
    }
  },

  sky(ctx, W, H) {
    sky(ctx, W, H);
    sun(ctx, W * 0.86, H * 0.16, 46);
    cloud(ctx, W * 0.19, H * 0.2, 1.1);
    cloud(ctx, W * 0.55, H * 0.13, 0.8);
    cloud(ctx, W * 0.75, H * 0.42, 0.7);
    cloud(ctx, W * 0.3, H * 0.55, 0.6);
  },

  field(ctx, W, H) {
    sky(ctx, W, H);
    sun(ctx, W * 0.86, H * 0.16, 46);
    cloud(ctx, W * 0.2, H * 0.18, 1);
    cloud(ctx, W * 0.56, H * 0.12, 0.75);
    ctx.fillStyle = '#c4ecb2';
    ctx.beginPath();
    ctx.ellipse(W * 0.25, H * 0.72, W * 0.45, H * 0.2, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#b4e3a0';
    ctx.beginPath();
    ctx.ellipse(W * 0.8, H * 0.74, W * 0.4, H * 0.18, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = vgrad(ctx, H * 0.7, H, '#a5df8f', '#8fd07a');
    ctx.fillRect(0, H * 0.7, W, H * 0.3);
    const rand = rng(7);
    const colors = ['#ff9fc0', '#fff1a8', '#ffffff', '#c9b6ff'];
    for (let k = 0; k < 40; k++) {
      const x = rand() * W;
      const y = H * (0.74 + rand() * 0.24);
      ctx.fillStyle = colors[k % colors.length];
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * TAU;
        circle(ctx, x + Math.cos(a) * 5, y + Math.sin(a) * 5, 4.5);
      }
      ctx.fillStyle = '#ffd34d';
      circle(ctx, x, y, 3.5);
    }
  },

  sea(ctx, W, H) {
    sky(ctx, W, H);
    sun(ctx, W * 0.86, H * 0.14, 42);
    cloud(ctx, W * 0.22, H * 0.16, 0.9);
    cloud(ctx, W * 0.58, H * 0.1, 0.65);
    const top = H * 0.46;
    ctx.fillStyle = vgrad(ctx, top, H * 0.82, '#7fd0f2', '#4fa9dd');
    ctx.fillRect(0, top, W, H - top);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (let row = 0; row < 5; row++) {
      const y = top + 26 + row * 36;
      const shift = row % 2 ? 40 : 0;
      for (let x = shift; x < W; x += 80) {
        ctx.beginPath();
        ctx.arc(x + 20, y, 18, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#ffe6b0';
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, H * 0.82);
    for (let x = 0; x <= W; x += 40) ctx.lineTo(x, H * 0.8 + Math.sin(x / 60) * 8);
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
    const rand = rng(5);
    ctx.fillStyle = '#f2cf8a';
    for (let k = 0; k < 30; k++) circle(ctx, rand() * W, H * (0.86 + rand() * 0.12), 2.5);
  },

  night(ctx, W, H) {
    const g = vgrad(ctx, 0, H, '#231c48', '#4a3f86');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const rand = rng(3);
    for (let k = 0; k < 70; k++) {
      ctx.fillStyle = `rgba(255, 255, 240, ${0.4 + rand() * 0.6})`;
      circle(ctx, rand() * W, rand() * H * 0.8, 1 + rand() * 1.6);
    }
    ctx.fillStyle = '#fff1a8';
    for (const [x, y, r] of [[0.12, 0.14, 12], [0.4, 0.08, 9], [0.3, 0.32, 8], [0.62, 0.26, 11], [0.93, 0.4, 9]]) {
      star(ctx, W * x, H * y, r);
    }
    // みかづき:まるい月に、空と おなじ色の まるを かさねる
    ctx.fillStyle = '#fff4c2';
    circle(ctx, W * 0.82, H * 0.18, 48);
    ctx.fillStyle = g;
    circle(ctx, W * 0.82 + 22, H * 0.18 - 14, 42);
    ctx.fillStyle = '#33295f';
    ctx.beginPath();
    ctx.ellipse(W * 0.3, H * 1.02, W * 0.6, H * 0.22, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(W * 0.85, H * 1.04, W * 0.4, H * 0.2, 0, 0, TAU);
    ctx.fill();
  },

  dream(ctx, W, H) {
    ctx.fillStyle = vgrad(ctx, 0, H, '#ffd6e7', '#e6dcff');
    ctx.fillRect(0, 0, W, H);
    const rand = rng(11);
    const colors = ['rgba(255, 255, 255, 0.7)', 'rgba(255, 143, 184, 0.35)', 'rgba(255, 241, 168, 0.8)', 'rgba(201, 182, 255, 0.6)'];
    for (let k = 0; k < 28; k++) {
      ctx.fillStyle = colors[k % colors.length];
      const x = rand() * W;
      const y = rand() * H;
      const s = 14 + rand() * 22;
      if (k % 2) heart(ctx, x, y - s / 2, s);
      else star(ctx, x, y, s * 0.6);
    }
  },
};

/** はいけいを かく(ctx は 論理座標 W×H に あわせて おくこと) */
export function paintBackground(ctx, type, W, H) {
  (PAINTERS[type] || PAINTERS.white)(ctx, W, H);
}
