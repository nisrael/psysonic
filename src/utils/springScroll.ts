/**
 * Spring-based scroll animation — iOS / Apple Music feel.
 *
 * Uses a critically-damped spring model driven by rAF:
 *   velocity += (target − position) × stiffness
 *   velocity *= damping
 *   position += velocity
 *
 * Tuning:
 *   stiffness  0.04 – 0.10  → lower = slower / more fluid
 *   damping    0.80 – 0.88  → lower = more bounce; higher = overdamped / snappy
 *   maxVelocity             → caps initial lurch when target is far away
 *
 * A single SpringScroller instance per container avoids fighting rAF loops
 * when the target changes before the previous animation finishes — calling
 * scrollTo() mid-flight just updates the target and the running loop picks it up.
 */
export class SpringScroller {
  private container  : HTMLElement;
  private target     = 0;
  private velocity   = 0;
  private rafId: number | null = null;

  private readonly stiffness  : number;
  private readonly damping    : number;
  private readonly maxVelocity: number;

  constructor(
    container   : HTMLElement,
    stiffness    = 0.065,   // gentle pull
    damping      = 0.84,    // smooth settle, no oscillation
    maxVelocity  = 28,      // px/frame cap — prevents jarring lurch on large jumps
  ) {
    this.container   = container;
    this.target      = container.scrollTop;
    this.stiffness   = stiffness;
    this.damping     = damping;
    this.maxVelocity = maxVelocity;
  }

  scrollTo(targetY: number) {
    this.target = Math.max(0, targetY);
    if (this.rafId === null) this.tick();
  }

  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.velocity = 0;
  }

  /** Teleport without animation (e.g. on track reset). */
  jump(y: number) {
    this.stop();
    this.target = y;
    this.container.scrollTop = y;
  }

  private tick = () => {
    const pos   = this.container.scrollTop;
    const delta = this.target - pos;

    let v = (this.velocity + delta * this.stiffness) * this.damping;
    // Cap velocity so large distances don't start with a hard jerk.
    if (v >  this.maxVelocity) v =  this.maxVelocity;
    if (v < -this.maxVelocity) v = -this.maxVelocity;
    this.velocity = v;

    this.container.scrollTop += v;

    const settled = Math.abs(v) < 0.12 && Math.abs(delta) < 0.5;
    if (settled) {
      this.container.scrollTop = this.target;
      this.rafId    = null;
      this.velocity = 0;
    } else {
      this.rafId = requestAnimationFrame(this.tick);
    }
  };
}

/**
 * Convenience: compute the scroll position that places `el` at `fraction`
 * from the top of `container` (0 = top, 0.5 = centre, 0.35 = Apple-style).
 */
export function targetForFraction(
  container: HTMLElement,
  el       : HTMLElement,
  fraction  = 0.35,
): number {
  const cRect = container.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  return container.scrollTop + (eRect.top - cRect.top) - cRect.height * fraction + eRect.height / 2;
}
