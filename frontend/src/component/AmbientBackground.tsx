// @ts-nocheck
import React, { useEffect, useRef } from 'react';

const PARTICLE_COUNT = 40;

const AmbientBackground = ({ particlesEnabled = true, scanlinesEnabled = true }) => {
  const ref = useRef(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const particles = [];
    if (particlesEnabled) {
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const el = document.createElement('div');
        el.className = 'particle';
        const size = 1 + Math.random() * 2;
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.left = `${Math.random() * 100}%`;
        el.style.setProperty('--drift', (Math.random() - 0.5) * 200);
        el.style.animationDuration = `${15 + Math.random() * 25}s`;
        el.style.animationDelay = `${Math.random() * 20}s`;
        const hue = Math.random() > 0.5 ? '190' : '260';
        el.style.background = `hsl(${hue}, 80%, 70%)`;
        el.style.boxShadow = `0 0 ${4 + size * 2}px hsla(${hue}, 80%, 70%, 0.4)`;
        container.appendChild(el);
        particles.push(el);
      }
    }

    return () => {
      particles.forEach(p => p.remove());
    };
  }, [particlesEnabled]);

  return (
    <>
      {scanlinesEnabled && <div className="scanlines" />}
      <div className="particles-bg" ref={ref} />
    </>
  );
};

export default AmbientBackground;
