// Fixed-timestep update with variable-rate render and interpolation alpha.

export function startLoop({ update, render, step = 1 / 60, maxFrame = 0.25 }) {
  let last = performance.now();
  let acc = 0;
  let running = true;
  let rafId = 0;

  function frame(now) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, maxFrame);
    last = now;
    acc += dt;
    while (acc >= step) {
      update(step);
      acc -= step;
    }
    render(acc / step, dt);
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  // Avoid a huge catch-up after the tab was hidden.
  const onVisibility = () => { last = performance.now(); acc = 0; };
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    running = false;
    cancelAnimationFrame(rafId);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
