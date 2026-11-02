// Made By FALCREB
// Hafif parçacık efekti: dış kütüphane kullanmaz, boşta çizim döngüsü çalışmaz.

const MAX_PARTICLES = { high: 320, low: 60 };
const BURST_SIZE = { high: 150, low: 36 };
const GRAVITY = 260;

// shadowBlur pahalıdır; bir kez çizilen parlama görseli yeniden kullanılır.
function makeSprite(color) {
  const size = 64;
  const sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext('2d');
  const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  glow.addColorStop(0, '#ffffff');
  glow.addColorStop(0.18, color);
  glow.addColorStop(1, `${color}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);
  return sprite;
}

export function createFx(canvas, { colors, quality }) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { burst() {} };

  const sprites = [makeSprite(colors.c1), makeSprite(colors.c2)];
  const strokeColors = [colors.c1, colors.c2];
  const particles = [];
  const rings = [];
  const limit = MAX_PARTICLES[quality];
  // Düşük kalitede yüksek çözünürlüklü çizim yapılmaz.
  const pixelRatio = quality === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  let frame = 0;
  let lastTime = 0;

  function resize() {
    canvas.width = Math.round(window.innerWidth * pixelRatio);
    canvas.height = Math.round(window.innerHeight * pixelRatio);
  }
  window.addEventListener('resize', resize);
  resize();

  function step(time) {
    const dt = Math.max(0, Math.min((time - lastTime) / 1000, 0.05));
    lastTime = time;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = rings.length - 1; i >= 0; i -= 1) {
      const ring = rings[i];
      ring.age += dt;
      // Gecikmeli halka henüz başlamadı; negatif yarıçap arc() çağrısını hataya düşürür.
      if (ring.age < 0) continue;
      const progress = ring.age / ring.life;
      if (progress >= 1) {
        rings.splice(i, 1);
        continue;
      }
      const radius = ring.maxRadius * (1 - (1 - progress) ** 3);
      ctx.strokeStyle = strokeColors[ring.color];
      // Geniş ve soluk + ince ve parlak iki çizgi, blur olmadan neon görüntüsü verir.
      for (const [width, alpha] of [[14, 0.14], [3, 0.9]]) {
        ctx.globalAlpha = (1 - progress) * alpha;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        particles[i] = particles[particles.length - 1];
        particles.pop();
        continue;
      }
      p.vy += GRAVITY * dt;
      p.vx *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = 1 - p.age / p.life;
      ctx.drawImage(sprites[p.color], p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }

    if (particles.length || rings.length) {
      frame = requestAnimationFrame(step);
    } else {
      // Efekt bitti: tuval temizlenir ve döngü durur, boşta işlemci harcanmaz.
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      frame = 0;
    }
  }

  return {
    /** Verilen noktada parçacık patlaması başlatır. */
    burst(x, y) {
      const count = Math.min(BURST_SIZE[quality], limit - particles.length);
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 90 + Math.random() * 460;
        particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 120,
          age: 0,
          life: 0.7 + Math.random() * 0.9,
          size: 8 + Math.random() * 22,
          color: i % 2,
        });
      }
      const maxRadius = Math.max(window.innerWidth, window.innerHeight) * 0.42;
      rings.push({ x, y, age: 0, life: 0.9, maxRadius, color: 0 });
      if (quality !== 'low') rings.push({ x, y, age: -0.14, life: 1.1, maxRadius, color: 1 });
      if (!frame) {
        lastTime = performance.now();
        frame = requestAnimationFrame(step);
      }
    },
  };
}
