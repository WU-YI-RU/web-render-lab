/**
 * ParticlePortrait — turn an image into an interactive Canvas2D particle field.
 *
 * Samples the source image onto a small offscreen grid, keeps one particle
 * per pixel that survives a luminance/saturation filter (by default: bright,
 * low-saturation pixels — i.e. pull a light subject out of a dark/colored
 * background), and renders them with:
 *
 *   - a one-time "assemble" animation on load (particles start scattered,
 *     ease into the image over ~1.2s, then just sit there — no built-in
 *     hover/show-hide lifecycle; wire that yourself if you want it, see
 *     the README for the pattern used in the Metis integration this was
 *     extracted from),
 *   - continuous idle jitter (each particle drifts on its own sine phase),
 *   - mouse-repel with a *soft* edge: each particle gets its own randomized
 *     effective radius (fixed at creation) and the push falls off via
 *     smoothstep rather than linearly. A naive fixed-radius/linear-falloff
 *     repel makes every particle react at exactly the same distance, which
 *     piles them up into a visible ring right at the boundary — the
 *     randomized radius + smoothstep breaks that ring into a soft, uneven
 *     edge instead.
 *
 * No dependencies, no build step. Drop this file next to an HTML page and
 * use it as `new ParticlePortrait(canvas, { image: 'photo.jpg' })`.
 */
(function (global) {
  'use strict';

  function smoothstep(u) { return u * u * (3 - 2 * u); }
  function clamp01(u) { return u < 0 ? 0 : u > 1 ? 1 : u; }

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} [options]
   * @param {string|HTMLImageElement} [options.image] - source image; can also call loadImage() later
   * @param {number} [options.gridSize=84] - sampling grid resolution (higher = more particles, slower)
   * @param {number} [options.particleSize=1.6] - base particle radius in px
   * @param {number} [options.scatterMin=100] - min px distance particles start/end from home
   * @param {number} [options.scatterMax=250] - max px distance particles start/end from home
   * @param {number} [options.jitterAmplitude=1.6] - idle floating motion amplitude in px
   * @param {number} [options.repelRadius=28] - base mouse-repel radius in px (each particle jitters this ±)
   * @param {number} [options.repelForce=6] - peak repel impulse strength
   * @param {number} [options.damping=0.88] - per-frame velocity damping (higher = less oscillation)
   * @param {number} [options.spring=0.032] - pull-back-to-home strength
   * @param {number} [options.luminanceThreshold=26] - pixels at/below this luminance (0-255) are discarded
   * @param {number} [options.saturationMax=46] - pixels at/above this max-min channel spread are discarded
   * @param {number} [options.dprCap=2] - devicePixelRatio cap for the backing canvas
   * @param {number} [options.assembleMs=1200] - roughly how long the one-time assemble animation takes
   * @param {boolean} [options.contrast=true] - scale each particle's size/alpha by its own source-pixel
   *   brightness (pushed toward the extremes) instead of a flat random size — this is what gives the
   *   assembled image light/dark depth rather than every particle carrying the same visual weight.
   */
  function ParticlePortrait(canvas, options) {
    options = options || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.gridSize = options.gridSize || 84;
    this.particleSize = options.particleSize || 1.6;
    this.scatterMin = options.scatterMin != null ? options.scatterMin : 100;
    this.scatterMax = options.scatterMax != null ? options.scatterMax : 250;
    this.jitterAmplitude = options.jitterAmplitude != null ? options.jitterAmplitude : 1.6;
    this.repelRadius = options.repelRadius != null ? options.repelRadius : 28;
    this.repelForce = options.repelForce != null ? options.repelForce : 6;
    this.damping = options.damping != null ? options.damping : 0.88;
    this.spring = options.spring != null ? options.spring : 0.032;
    this.luminanceThreshold = options.luminanceThreshold != null ? options.luminanceThreshold : 26;
    this.saturationMax = options.saturationMax != null ? options.saturationMax : 46;
    this.dprCap = options.dprCap || 2;
    this.assembleMs = options.assembleMs != null ? options.assembleMs : 1200;
    this.contrast = options.contrast != null ? options.contrast : true;

    this._image = null;
    this._particles = [];
    this._ready = false;
    this._level = 0;
    this._running = false;
    this._last = 0;
    this._side = 0;
    this._raf = null;
    this._mouse = { x: -9999, y: -9999, active: false };

    this._tick = this._tick.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseLeave = this._onMouseLeave.bind(this);
    this.canvas.addEventListener('mousemove', this._onMouseMove);
    this.canvas.addEventListener('mouseleave', this._onMouseLeave);

    if (options.image) this.loadImage(options.image);
  }

  ParticlePortrait.prototype._onMouseMove = function (e) {
    var r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this._mouse.x = (e.clientX - r.left) * (this._side / r.width);
    this._mouse.y = (e.clientY - r.top) * (this._side / r.height);
    this._mouse.active = true;
  };

  ParticlePortrait.prototype._onMouseLeave = function () {
    this._mouse.active = false;
  };

  /** Recompute the backing canvas size. Call after the element's CSS size changes. */
  ParticlePortrait.prototype.resize = function (side) {
    var dpr = Math.min(global.devicePixelRatio || 1, this.dprCap);
    this._side = side || this.canvas.clientWidth || this.canvas.width || 300;
    this.canvas.width = Math.round(this._side * dpr);
    this.canvas.height = Math.round(this._side * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this._image) this._particles = this._sample(this._image);
  };

  /**
   * Load (or replace) the source image and re-sample particles from it.
   * @param {string|HTMLImageElement} src
   * @returns {Promise<void>}
   */
  ParticlePortrait.prototype.loadImage = function (src) {
    var self = this;
    return new Promise(function (resolve, reject) {
      var img = src instanceof HTMLImageElement ? src : new Image();

      function onReady() {
        self._image = img;
        if (!self._side) self.resize();
        self._particles = self._sample(img);
        self._ready = true;
        self._level = 0;
        self.start();
        resolve();
      }

      if (img.complete && img.naturalWidth) {
        onReady();
      } else {
        img.onload = onReady;
        img.onerror = function (e) { reject(e); };
        if (typeof src === 'string') img.src = src;
      }
    });
  };

  ParticlePortrait.prototype._sample = function (img) {
    var GRID = this.gridSize;
    var off = document.createElement('canvas');
    off.width = GRID;
    off.height = GRID;
    var octx = off.getContext('2d');
    octx.drawImage(img, 0, 0, GRID, GRID);
    var data = octx.getImageData(0, 0, GRID, GRID).data;

    var scale = this._side / GRID;
    var cx = GRID / 2, cy = GRID / 2;
    var scatterRange = this.scatterMax - this.scatterMin;
    var out = [];

    for (var y = 0; y < GRID; y++) {
      for (var x = 0; x < GRID; x++) {
        var i = (y * GRID + x) * 4;
        var r = data[i], g = data[i + 1], b = data[i + 2];
        var lum = r * 0.21 + g * 0.71 + b * 0.07;
        var maxc = Math.max(r, g, b), minc = Math.min(r, g, b);
        if (lum <= this.luminanceThreshold || (maxc - minc) >= this.saturationMax) continue;

        // contrast: map this pixel's own brightness (above the survival
        // threshold) to 0..1 and push it toward the extremes with
        // smoothstep, so dim-but-surviving pixels come out small/faint
        // and bright pixels come out big/opaque — see the `contrast`
        // option doc above for why.
        var contrastFactor = 1;
        if (this.contrast) {
          var lumNorm = (lum - this.luminanceThreshold) / (255 - this.luminanceThreshold);
          contrastFactor = smoothstep(clamp01(lumNorm));
        }

        var homeX = (x - cx) * scale;
        var homeY = (y - cy) * scale;
        var angle = Math.random() * Math.PI * 2;
        var dist = this.scatterMin + Math.random() * scatterRange;
        var sx = Math.cos(angle) * dist;
        var sy = Math.sin(angle) * dist;

        out.push({
          homeX: homeX, homeY: homeY,
          scatterX: sx, scatterY: sy,
          x: homeX + sx, y: homeY + sy,
          vx: 0, vy: 0,
          phase: Math.random() * Math.PI * 2,
          radiusJitter: 0.75 + Math.random() * 0.5,
          size: this.particleSize * (0.5 + 1.1 * contrastFactor) * (0.85 + Math.random() * 0.3),
          baseAlpha: (0.35 + 0.65 * contrastFactor) * (0.85 + Math.random() * 0.15),
          color: 'rgb(' + r + ',' + g + ',' + b + ')'
        });
      }
    }
    return out;
  };

  /** Start (or resume) the render loop. Idempotent. */
  ParticlePortrait.prototype.start = function () {
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._tick);
  };

  /** Stop the render loop without tearing anything else down. */
  ParticlePortrait.prototype.stop = function () {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  };

  /** Stop the loop and detach event listeners. */
  ParticlePortrait.prototype.destroy = function () {
    this.stop();
    this.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mouseleave', this._onMouseLeave);
  };

  ParticlePortrait.prototype._tick = function (now) {
    var dt = Math.min(48, now - this._last);
    this._last = now;

    // One-time assemble: level eases 0 -> 1 and then just stays at 1.
    // There is deliberately no hover-driven show/hide state here — if you
    // want that, drive `this._level`'s target externally (see README).
    var tau = this.assembleMs / 3.5;
    var a = 1 - Math.exp(-dt / tau);
    this._level += (1 - this._level) * a;
    this._level = clamp01(this._level);

    var ctx = this.ctx, side = this._side, level = this._level;
    ctx.clearRect(0, 0, side, side);

    var originX = side / 2, originY = side / 2;
    var mouse = this._mouse;
    var repel = mouse.active;
    var localMouseX = repel ? mouse.x - originX : 0;
    var localMouseY = repel ? mouse.y - originY : 0;
    var baseRadius = this.repelRadius;
    var particles = this._particles;

    for (var idx = 0; idx < particles.length; idx++) {
      var p = particles[idx];

      var jx = Math.sin(now * 0.0011 + p.phase) * this.jitterAmplitude * level;
      var jy = Math.cos(now * 0.0014 + p.phase * 1.4) * this.jitterAmplitude * level;
      var tx = p.homeX + jx + (1 - level) * p.scatterX;
      var ty = p.homeY + jy + (1 - level) * p.scatterY;

      if (repel) {
        var effR = baseRadius * p.radiusJitter;
        var dx = p.x - localMouseX, dy = p.y - localMouseY;
        var d2 = dx * dx + dy * dy;
        if (d2 < effR * effR && d2 > 0.01) {
          var d = Math.sqrt(d2);
          var falloff = 1 - smoothstep(d / effR);
          var force = falloff * this.repelForce;
          p.vx += (dx / d) * force;
          p.vy += (dy / d) * force;
        }
      }

      p.vx += (tx - p.x) * this.spring;
      p.vy += (ty - p.y) * this.spring;
      p.vx *= this.damping;
      p.vy *= this.damping;
      p.x += p.vx;
      p.y += p.vy;

      var sizeMul = 0.35 + 0.65 * level;
      ctx.globalAlpha = level * p.baseAlpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(originX + p.x, originY + p.y, p.size * sizeMul, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    this._raf = requestAnimationFrame(this._tick);
  };

  global.ParticlePortrait = ParticlePortrait;
})(typeof window !== 'undefined' ? window : this);
