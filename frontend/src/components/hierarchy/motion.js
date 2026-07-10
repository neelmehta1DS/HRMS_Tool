// Animation constants for the graph view's node transitions. The list view
// does not animate.

export const MOVE_DURATION = 2000;

// Cubic ease-in-out.
export function ease(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
