import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

interface SingularityIntroProps {
  onComplete: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  color: string;
}

const PARTICLE_COLORS = ['#ffffff', '#d6f8ff', '#4ef2e2', '#8566ff', '#a9b7ff'];

export default function SingularityIntro({ onComplete }: SingularityIntroProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const chargingRef = useRef(false);
  const explodedRef = useRef(false);
  const chargeRef = useRef(0);
  const explodedAtRef = useRef(0);
  const [charge, setCharge] = useState(0);
  const [exploded, setExploded] = useState(false);

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;
    const context = canvasElement.getContext('2d');
    if (!context) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let mouseX = -9999;
    let mouseY = -9999;
    const particles: Particle[] = [];

    function resize() {
      dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvasElement!.width = Math.round(width * dpr);
      canvasElement!.height = Math.round(height * dpr);
      canvasElement!.style.width = width + 'px';
      canvasElement!.style.height = height + 'px';
      context!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function seedParticles() {
      particles.length = 0;
      const count = Math.min(520, Math.max(220, Math.floor((width * height) / 3000)));
      for (let i = 0; i < count; i += 1) {
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.18,
          vy: (Math.random() - 0.5) * 0.18,
          radius: Math.random() * 1.3 + 0.35,
          alpha: Math.random() * 0.7 + 0.15,
          color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)]
        });
      }
    }

    function draw(now: number) {
      const centerX = width / 2;
      const centerY = height / 2;
      const chargeFactor = chargeRef.current / 100;
      context!.clearRect(0, 0, width, height);

      for (const particle of particles) {
        if (explodedRef.current) {
          const elapsed = Math.min(1.4, (now - explodedAtRef.current) / 1000);
          const distance = Math.hypot(particle.x - centerX, particle.y - centerY) || 1;
          particle.x += ((particle.x - centerX) / distance) * (1.5 + elapsed * 10);
          particle.y += ((particle.y - centerY) / distance) * (1.5 + elapsed * 10);
          particle.alpha = Math.max(0, particle.alpha - 0.012);
        } else {
          particle.x += particle.vx;
          particle.y += particle.vy;
          if (particle.x < -20) particle.x = width + 20;
          if (particle.x > width + 20) particle.x = -20;
          if (particle.y < -20) particle.y = height + 20;
          if (particle.y > height + 20) particle.y = -20;

          if (mouseX > -1000 && chargeFactor < 0.05) {
            const dx = mouseX - particle.x;
            const dy = mouseY - particle.y;
            const distance = Math.hypot(dx, dy);
            if (distance < 180 && distance > 1) {
              const force = (1 - distance / 180) * 0.45;
              particle.x -= (dx / distance) * force;
              particle.y -= (dy / distance) * force;
            }
          }

          if (chargeFactor > 0.01) {
            const dx = centerX - particle.x;
            const dy = centerY - particle.y;
            const distance = Math.hypot(dx, dy) || 1;
            const inward = chargeFactor * 1.9 + chargeFactor ** 2 * 4.6;
            const swirl = chargeFactor * 1.3;
            particle.x += (dx / distance) * inward - (dy / distance) * swirl;
            particle.y += (dy / distance) * inward + (dx / distance) * swirl;
          }
        }

        context!.beginPath();
        context!.arc(particle.x, particle.y, particle.radius + chargeFactor * 0.8, 0, Math.PI * 2);
        context!.fillStyle = particle.color;
        context!.globalAlpha = particle.alpha;
        context!.fill();
      }
      context!.globalAlpha = 1;
      frameRef.current = requestAnimationFrame(draw);
    }

    resize();
    seedParticles();
    const onResize = () => { resize(); seedParticles(); };
    const onPointerMove = (event: PointerEvent) => { mouseX = event.clientX; mouseY = event.clientY; };
    window.addEventListener('resize', onResize);
    window.addEventListener('pointermove', onPointerMove);
    frameRef.current = requestAnimationFrame(draw);

    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointerMove);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault();
        chargingRef.current = true;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') chargingRef.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useEffect(() => {
    if (exploded) return;
    let frame: number;
    let last = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min(80, now - last);
      last = now;
      if (chargingRef.current) {
        chargeRef.current = Math.min(100, chargeRef.current + elapsed / 34);
      } else {
        chargeRef.current = Math.max(0, chargeRef.current - elapsed / 170);
      }
      setCharge(Math.round(chargeRef.current));
      if (chargeRef.current >= 100) {
        triggerExplosion();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [exploded]);

  function triggerExplosion() {
    if (explodedRef.current) return;
    explodedRef.current = true;
    explodedAtRef.current = performance.now();
    chargingRef.current = false;
    chargeRef.current = 100;
    setCharge(100);
    setExploded(true);
    window.setTimeout(onComplete, 1150);
  }

  function startCharge(event?: ReactPointerEvent<HTMLButtonElement>) {
    event?.preventDefault();
    if (!explodedRef.current) chargingRef.current = true;
  }

  function stopCharge(event?: ReactPointerEvent<HTMLButtonElement>) {
    event?.preventDefault();
    chargingRef.current = false;
  }

  const progressStyle = { '--singularity-progress': charge + '%' } as CSSProperties;

  return (
    <main className={'singularity-intro' + (exploded ? ' is-exploding' : '')} style={progressStyle}>
      <div className="singularity-ambient" aria-hidden="true" />
      <canvas ref={canvasRef} className="singularity-canvas" aria-hidden="true" />
      <header className="singularity-header">
        <span className="singularity-badge"><i /> QUANTUM SINGULARITY CORE · V2.5</span>
        <h1>开启你的个性化<br /><span>职业智能探索</span></h1>
        <p>{charge > 0 ? '引力奇点高速凝聚中 · 持续保持按住' : '长按核心基点或按住空格 · 凝聚引力奇点'}</p>
      </header>
      <section className="singularity-core-zone" aria-label="宇宙奇点启动核心">
        <div className="singularity-orbit singularity-orbit-outer" aria-hidden="true"><i /></div>
        <div className="singularity-orbit singularity-orbit-middle" aria-hidden="true" />
        <div className="singularity-progress-ring">
          <div className="singularity-halo" />
          <button
            type="button"
            className="singularity-core-button"
            aria-label="长按凝聚宇宙奇点，完成后进入职业探索"
            onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); startCharge(event); }}
            onPointerUp={stopCharge}
            onPointerCancel={stopCharge}
            onPointerLeave={stopCharge}
          >
            <span className="singularity-nucleus"><i /></span>
          </button>
        </div>
        <span className="singularity-percent">{charge}%</span>
      </section>
      <footer className="singularity-footer">
        <span>按住核心，凝聚你的职业可能性</span>
        <button type="button" onClick={triggerExplosion}>跳过奇点引导 <b>→</b></button>
      </footer>
      <div className="singularity-whiteout" aria-hidden="true" />
    </main>
  );
}
