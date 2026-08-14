# particle-portrait

An image dissolves into an interactive field of particles: hover it and drag your cursor through, the particles push away with a soft, irregular edge and spring back when you leave.

[Live demo](demo.html) · pure Canvas2D, no framework, no build step.

## How it works

1. The source image is drawn onto a small offscreen canvas (an 84×84 grid by default) and read back pixel-by-pixel.
2. Pixels are filtered by luminance and saturation — by default it keeps bright, low-saturation pixels and drops the rest. That's a simple way to pull a light-colored subject out of a dark, plain background without needing a pre-cut alpha channel (see `assets/metis-bust.jpg`: a light marble bust on solid black).
3. Each surviving pixel becomes a particle with a `home` position (where it belongs in the assembled image) and a `scatter` position (a random point 100–250px away).
4. On load, a single continuous value `level` eases from 0 to 1 (`level += (1 - level) * (1 - exp(-dt/tau))`), and every particle's drawn position is a blend between `home` (+ a little idle jitter) and `scatter`, weighted by `level`. That's the one-time "assemble" you see on load — after that `level` just stays at 1.
5. Mouse-repel: particles within a radius of the cursor get pushed away, then spring back to their target position. The edge is intentionally *not* a hard cutoff — see below.

### The soft-edge fix

A naive repel (fixed radius, force falling off linearly with distance) makes every particle react at exactly the same distance from the cursor. Pushed particles converge on the same iso-distance ring and hover there, which reads as a visible, mechanical-looking circle scrubbing through the image. Two changes fix it:

- **Per-particle radius jitter**, computed once when the particle is created (`radiusJitter = 0.75 + Math.random() * 0.5`) and never re-rolled — this staggers which particles start responding at what distance, breaking the ring into a soft, uneven frontier instead of a perfect circle.
- **Smoothstep falloff** instead of linear (`falloff = 1 - smoothstep(d / effectiveRadius)`) — the push fades out gradually with a zero derivative at both ends, instead of stopping with a sharp kink right at the boundary.

Lowering peak force and raising damping slightly also helps — it reduces the oscillation/pile-up that made the ring read as a bright line rather than a diffuse push.

## Usage

```html
<canvas id="canvas" width="420" height="420" style="width:420px;height:420px"></canvas>
<script src="particle-portrait.js"></script>
<script>
  new ParticlePortrait(document.getElementById('canvas'), {
    image: 'assets/metis-bust.jpg'
  });
</script>
```

`new ParticlePortrait(canvas, options)` — see the JSDoc at the top of `particle-portrait.js` for the full option list (grid size, particle size, scatter distance, jitter, repel radius/force, damping, spring, the luminance/saturation thresholds, devicePixelRatio cap, assemble duration).

Methods:

- `.loadImage(srcOrImg)` → `Promise<void>` — load/replace the source image and re-sample.
- `.resize(side?)` — recompute the backing canvas size; call this after the element's CSS size changes (there's no built-in `ResizeObserver`, wire one up if you need it).
- `.start()` / `.stop()` — pause/resume the render loop.
- `.destroy()` — stop the loop and remove the mouse listeners.

This engine deliberately has **no hover-triggered show/hide or hold-timer behavior** — it assembles once and stays interactive forever. If you want a "hover to reveal, hold for N seconds, then fade" version (which is what this technique was originally built for — a title-hover easter egg), the pattern is: keep a `hovering` flag and a `graceUntil` timestamp, and instead of always easing `level` toward `1`, ease it toward `(hovering || now < graceUntil) ? 1 : 0`. That's a small change to `_tick()`'s target, everything else stays the same.

## Customization knobs

| Option | Effect |
|---|---|
| `gridSize` | Particle count (grid resolution). Higher = denser image, slower. |
| `luminanceThreshold` / `saturationMax` | What counts as "subject" vs. "background" to discard. |
| `scatterMin` / `scatterMax` | How far particles fly out for the assemble animation. |
| `repelRadius` / `repelForce` | How big and how strong the cursor's push is. |
| `damping` / `spring` | Physics feel — lower damping = more bounce, higher spring = snappier return. |
| `contrast` | On by default. Scales each particle's size/alpha by its own source-pixel brightness (pushed toward the extremes) instead of a flat random size, so the assembled image has light/dark depth rather than every particle carrying the same visual weight. Set `false` for the flatter, uniform-particle look. |

## Browser support

Canvas2D + `requestAnimationFrame`, `devicePixelRatio` capped at 2 by default. No build step, no dependencies — but one `file://` caveat:

The engine reads the source image's pixels with `getImageData()`. If you point `image` at a relative path (like the README usage example above) and open the page via `file://` instead of serving it, Chrome treats each local file as its own opaque origin, which taints the canvas and makes `getImageData()` throw — the particles just silently never appear, no visible error. Two ways around it:

- Serve the folder instead of double-clicking the file (`python -m http.server`, or any static server) — this is also how it'll actually run once deployed, so it's the more representative way to test anyway.
- Or inline the image as a `data:` URI instead of a path — `data:` URIs don't have a cross-origin identity, so they never taint the canvas. `demo.html` in this repo does exactly that, which is why it works straight off a double-click.

## License

MIT — see the repo root [LICENSE](../LICENSE).
