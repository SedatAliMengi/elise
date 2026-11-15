import { useEffect, useRef } from "react";

/**
 * Slow drifting stars behind the Projects view.
 *
 * Elise renders without the GPU (see README), so this stays cheap on purpose:
 * one 2D canvas, small squares instead of blurred dots, about 30 frames a
 * second, and nothing at all while the window is hidden.
 */

interface Star {
  x: number;
  y: number;
  /** 0 (far) .. 1 (near): nearer stars are bigger, brighter and drift faster. */
  z: number;
  phase: number;
  speed: number;
  tint: number;
}

const TINTS = ["237,230,247", "200,170,255", "255,190,200", "170,200,255"];
const FRAME_MS = 33;

export default function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let stars: Star[] = [];
    let shoot: { x: number; y: number; t: number } | null = null;
    let nextShoot = 9000 + Math.random() * 12000;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(220, (w * h) / 5200));
      stars = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        z: Math.pow(Math.random(), 2.2),
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 1.1,
        tint: Math.random() < 0.7 ? 0 : 1 + Math.floor(Math.random() * 3),
      }));
      draw(0, 0);
    };

    const draw = (dt: number, now: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        // Everything slides slowly to the left and a little upward.
        s.x -= (2 + s.z * 9) * dt;
        s.y -= (0.4 + s.z * 1.6) * dt;
        if (s.x < -2) s.x = w + 2;
        if (s.y < -2) s.y = h + 2;
        const twinkle = 0.62 + 0.38 * Math.sin(s.phase + now * 0.001 * s.speed);
        const size = 0.7 + s.z * 1.7;
        ctx.fillStyle = `rgba(${TINTS[s.tint]},${(0.22 + s.z * 0.7) * twinkle})`;
        ctx.fillRect(s.x, s.y, size, size);
        if (s.z > 0.8) {
          // The nearest few get a faint cross, like a lens flare.
          ctx.fillStyle = `rgba(${TINTS[s.tint]},${0.16 * twinkle})`;
          ctx.fillRect(s.x - size * 1.6, s.y + size * 0.3, size * 4.2, size * 0.4);
          ctx.fillRect(s.x + size * 0.3, s.y - size * 1.6, size * 0.4, size * 4.2);
        }
      }
      if (shoot) {
        shoot.t += dt;
        const k = shoot.t / 0.9;
        if (k >= 1) shoot = null;
        else {
          const x = shoot.x - k * 260;
          const y = shoot.y + k * 110;
          const g = ctx.createLinearGradient(x, y, x + 90, y - 38);
          g.addColorStop(0, `rgba(255,255,255,${0.85 * (1 - k)})`);
          g.addColorStop(1, "rgba(180,76,255,0)");
          ctx.strokeStyle = g;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + 90, y - 38);
          ctx.stroke();
        }
      }
    };

    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || now - last < FRAME_MS) return;
      const dt = Math.min(0.1, last ? (now - last) / 1000 : 0);
      last = now;
      nextShoot -= dt * 1000;
      if (nextShoot <= 0 && !shoot) {
        shoot = { x: w * (0.35 + Math.random() * 0.6), y: h * Math.random() * 0.45, t: 0 };
        nextShoot = 14000 + Math.random() * 20000;
      }
      draw(dt, now);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    if (!still) raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="projects__stars" aria-hidden />;
}
