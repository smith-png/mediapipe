import type { ImageSegmenterResult } from '@mediapipe/tasks-vision';
import type { SandevistanSettings } from '../types/sandevistan';

type CanvasSurface = OffscreenCanvas | HTMLCanvasElement;
type Canvas2DContext =
  | OffscreenCanvasRenderingContext2D
  | CanvasRenderingContext2D;

interface TrailSlot {
  canvas: CanvasSurface;
  ctx: Canvas2DContext;
  colorIndex: 0 | 1; // 0 = cyan (#00f0ff), 1 = magenta (#ff2bd6)
  hasGlow: boolean;
}

interface SpeedLine {
  x: number;
  y: number;
  length: number;
  speed: number;
  thickness: number;
  alpha: number;
  color: string;
}

const MAX_TRAIL_SLOTS = 20;
const CYAN = '#00f0ff';
const MAGENTA = '#ff2bd6';
const MAX_PROCESSING_DIMENSION = 640;

function createSurface(width: number, height: number): {
  canvas: CanvasSurface;
  ctx: Canvas2DContext;
} {
  if (typeof OffscreenCanvas !== 'undefined') {
    const offscreen = new OffscreenCanvas(width, height);
    const ctx = offscreen.getContext('2d', { willReadFrequently: false });
    if (ctx) {
      return { canvas: offscreen, ctx };
    }
  }
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  const ctx = el.getContext('2d', { willReadFrequently: false });
  if (!ctx) {
    throw new Error('Could not initialize 2D canvas context');
  }
  return { canvas: el, ctx };
}

function resizeSurface(surface: CanvasSurface, width: number, height: number): void {
  if (surface.width !== width || surface.height !== height) {
    surface.width = width;
    surface.height = height;
  }
}

export class SandevistanRenderer {
  private procWidth = 640;
  private procHeight = 480;

  // Offscreen processing buffers (allocated once, resized only if camera dimensions change)
  private mirrorSurface: { canvas: CanvasSurface; ctx: Canvas2DContext };
  private cutoutSurface: { canvas: CanvasSurface; ctx: Canvas2DContext };
  private tintSurface: { canvas: CanvasSurface; ctx: Canvas2DContext };
  private chromaCyanSurface: { canvas: CanvasSurface; ctx: Canvas2DContext };
  private chromaMagentaSurface: { canvas: CanvasSurface; ctx: Canvas2DContext };

  // Mask rasterization buffer (sized to model mask resolution, e.g., 256x256)
  private maskSurface: { canvas: CanvasSurface; ctx: Canvas2DContext };
  private maskImageData: ImageData | null = null;
  private maskWidth = 0;
  private maskHeight = 0;

  // Polarity calibration for single-channel selfie segmenter masks
  private invertSingleMask = false;
  private polarityCalibrated = false;
  private mirrored = true;

  // Ring buffer of pre-tinted ghost cutouts
  private trailPool: TrailSlot[] = [];
  private trailOrder: TrailSlot[] = [];
  private poolCursor = 0;
  private colorParity: 0 | 1 = 0;

  // Motion tracking for organic trail direction + activation flash
  private smoothCentroidX = 0.5;
  private trailDirection = 1; // +1 or -1 for horizontal trail fan
  private effectBlend = 0; // 0 = OFF, 1 = ON (smooth transition)
  private activationKick = 0; // Brief burst on activation for chromatic punch
  private wasActive = false;

  // Horizontal speed lines pool
  private speedLines: SpeedLine[] = [];

  constructor() {
    this.mirrorSurface = createSurface(this.procWidth, this.procHeight);
    this.cutoutSurface = createSurface(this.procWidth, this.procHeight);
    this.tintSurface = createSurface(this.procWidth, this.procHeight);
    this.chromaCyanSurface = createSurface(this.procWidth, this.procHeight);
    this.chromaMagentaSurface = createSurface(this.procWidth, this.procHeight);
    this.maskSurface = createSurface(256, 256);

    for (let i = 0; i < MAX_TRAIL_SLOTS; i++) {
      const s = createSurface(this.procWidth, this.procHeight);
      this.trailPool.push({
        canvas: s.canvas,
        ctx: s.ctx,
        colorIndex: 0,
        hasGlow: true,
      });
    }

    this.initSpeedLines();
  }

  private initSpeedLines(): void {
    const colors = [CYAN, MAGENTA, '#e2f9ff', CYAN, MAGENTA];
    this.speedLines = [];
    for (let i = 0; i < 24; i++) {
      this.speedLines.push({
        x: Math.random(),
        y: Math.random(),
        length: 0.14 + Math.random() * 0.34,
        speed: 0.022 + Math.random() * 0.048,
        thickness: 1 + Math.random() * 2.2,
        alpha: 0.18 + Math.random() * 0.42,
        color: colors[i % colors.length],
      });
    }
  }

  /**
   * Keeps processing buffers at reduced resolution (max 640px on longest edge, e.g. 640x480 or 480x640).
   */
  syncProcessingResolution(videoWidth: number, videoHeight: number): void {
    if (videoWidth <= 0 || videoHeight <= 0) return;
    const scale = Math.min(
      1,
      MAX_PROCESSING_DIMENSION / Math.max(videoWidth, videoHeight)
    );
    const nextW = Math.max(160, Math.round((videoWidth * scale) / 2) * 2);
    const nextH = Math.max(160, Math.round((videoHeight * scale) / 2) * 2);

    if (nextW === this.procWidth && nextH === this.procHeight) return;

    this.procWidth = nextW;
    this.procHeight = nextH;

    resizeSurface(this.mirrorSurface.canvas, nextW, nextH);
    resizeSurface(this.cutoutSurface.canvas, nextW, nextH);
    resizeSurface(this.tintSurface.canvas, nextW, nextH);
    resizeSurface(this.chromaCyanSurface.canvas, nextW, nextH);
    resizeSurface(this.chromaMagentaSurface.canvas, nextW, nextH);

    for (let i = 0; i < this.trailPool.length; i++) {
      resizeSurface(this.trailPool[i].canvas, nextW, nextH);
    }
    this.clearTrails();
  }

  clearTrails(): void {
    this.trailOrder.length = 0;
    this.poolCursor = 0;
  }

  isBlending(): boolean {
    return this.effectBlend > 0.001;
  }

  /**
   * Draws the current video frame into the internal reduced-res surface,
   * horizontally mirrored for front camera or unmirrored for rear camera.
   */
  captureMirroredFrame(video: HTMLVideoElement, mirror = true): void {
    this.mirrored = mirror;
    const ctx = this.mirrorSurface.ctx;
    ctx.save();
    if (mirror) {
      ctx.setTransform(-1, 0, 0, 1, this.procWidth, 0);
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.drawImage(video, 0, 0, this.procWidth, this.procHeight);
    ctx.restore();
  }

  /**
   * Extracts the segmented person cutout from MediaPipe ImageSegmenterResult
   * and appends a tinted ghost snapshot into the ring buffer.
   */
  processSegmentation(
    result: ImageSegmenterResult,
    personMaskIndex: number,
    settings: SandevistanSettings,
    faceNoseNormalizedX?: number,
    faceNoseNormalizedY?: number
  ): boolean {
    const masks = result.confidenceMasks;
    if (!masks || masks.length === 0) return false;

    const chosenIdx =
      masks.length > personMaskIndex ? personMaskIndex : masks.length - 1;
    const mask = masks[chosenIdx];
    if (!mask) return false;

    const mw = mask.width;
    const mh = mask.height;
    const data = mask.getAsFloat32Array();
    if (!data || data.length === 0) return false;

    // Auto-calibrate mask polarity on first detected face if model outputs a single confidence channel
    if (
      masks.length === 1 &&
      !this.polarityCalibrated &&
      faceNoseNormalizedX !== undefined &&
      faceNoseNormalizedY !== undefined
    ) {
      const nx = Math.min(mw - 1, Math.max(0, Math.floor(faceNoseNormalizedX * mw)));
      const ny = Math.min(mh - 1, Math.max(0, Math.floor(faceNoseNormalizedY * mh)));
      const noseVal = data[ny * mw + nx];
      const cornerAvg =
        (data[0] +
          data[mw - 1] +
          data[(mh - 1) * mw] +
          data[mh * mw - 1]) *
        0.25;
      if (noseVal < 0.25 && cornerAvg > 0.75) {
        this.invertSingleMask = true;
      }
      this.polarityCalibrated = true;
    }

    if (mw !== this.maskWidth || mh !== this.maskHeight || !this.maskImageData) {
      this.maskWidth = mw;
      this.maskHeight = mh;
      resizeSurface(this.maskSurface.canvas, mw, mh);
      this.maskImageData = this.maskSurface.ctx.createImageData(mw, mh);
    }

    const pixels = this.maskImageData.data;
    const invert = masks.length === 1 && this.invertSingleMask;

    // Build mirrored soft alpha mask & sample person horizontal centroid in one pass
    let sumX = 0;
    let personCount = 0;

    for (let y = 0; y < mh; y++) {
      const rowOffset = y * mw;
      const sampleRow = (y & 3) === 0;
      for (let x = 0; x < mw; x++) {
        // Flip X only when front camera is mirrored so mask aligns with captured frame
        const srcX = this.mirrored ? mw - 1 - x : x;
        let conf = data[rowOffset + srcX];
        if (invert) conf = 1 - conf;

        // Smoothstep feathering [0.34 .. 0.72] eliminates jagged background halos
        let alpha = 0;
        if (conf > 0.34) {
          if (conf >= 0.72) {
            alpha = 255;
          } else {
            const t = (conf - 0.34) / 0.38;
            alpha = Math.round(t * t * (3 - 2 * t) * 255);
          }
          if (sampleRow && (x & 3) === 0 && conf > 0.55) {
            sumX += x;
            personCount += 1;
          }
        }

        const dst = (rowOffset + x) << 2;
        pixels[dst] = 255;
        pixels[dst + 1] = 255;
        pixels[dst + 2] = 255;
        pixels[dst + 3] = alpha;
      }
    }

    this.maskSurface.ctx.putImageData(this.maskImageData, 0, 0);

    // Update smooth person centroid to steer trail fan organically with movement
    if (personCount > 12) {
      const normX = sumX / personCount / mw;
      const dx = normX - this.smoothCentroidX;
      this.smoothCentroidX += dx * 0.35;
      if (Math.abs(dx) > 0.008) {
        this.trailDirection = dx > 0 ? -1 : 1;
      }
    }

    // Composite live person cutout (mirrored video masked by soft alpha)
    const cctx = this.cutoutSurface.ctx;
    cctx.globalCompositeOperation = 'source-over';
    cctx.clearRect(0, 0, this.procWidth, this.procHeight);
    cctx.drawImage(this.mirrorSurface.canvas, 0, 0);
    cctx.globalCompositeOperation = 'destination-in';
    cctx.imageSmoothingEnabled = true;
    cctx.drawImage(
      this.maskSurface.canvas,
      0,
      0,
      this.procWidth,
      this.procHeight
    );
    cctx.globalCompositeOperation = 'source-over';

    // Bake tinted ghost snapshot into the next ring buffer slot (1x cost per frame instead of Nx)
    this.pushTrailSnapshot(settings.trailLength, settings.glowEnabled);

    return true;
  }

  private pushTrailSnapshot(maxLength: number, glowEnabled: boolean): void {
    const slot = this.trailPool[this.poolCursor];
    this.poolCursor = (this.poolCursor + 1) % MAX_TRAIL_SLOTS;

    const colorIndex = this.colorParity;
    this.colorParity = colorIndex === 0 ? 1 : 0;
    const tintColor = colorIndex === 0 ? CYAN : MAGENTA;

    // Step 1: Create crisp neon-tinted silhouette preserving internal facial/body contrast
    const tctx = this.tintSurface.ctx;
    tctx.globalCompositeOperation = 'source-over';
    tctx.clearRect(0, 0, this.procWidth, this.procHeight);
    tctx.drawImage(this.cutoutSurface.canvas, 0, 0);

    // Tint pass (keeps silhouette detail readable while washing in neon cyan/magenta)
    tctx.globalCompositeOperation = 'source-atop';
    tctx.fillStyle = tintColor;
    tctx.globalAlpha = 0.68;
    tctx.fillRect(0, 0, this.procWidth, this.procHeight);

    // Additive rim energy pass for cyberpunk luminance
    tctx.globalCompositeOperation = 'lighter';
    tctx.globalAlpha = 0.22;
    tctx.drawImage(this.cutoutSurface.canvas, 0, 0);
    tctx.globalAlpha = 1;
    tctx.globalCompositeOperation = 'source-over';

    // Step 2: Copy into ring buffer slot (baking neon glow once at capture time)
    const sctx = slot.ctx;
    sctx.save();
    sctx.clearRect(0, 0, this.procWidth, this.procHeight);
    if (glowEnabled) {
      sctx.shadowColor = tintColor;
      sctx.shadowBlur = 14;
    }
    sctx.drawImage(this.tintSurface.canvas, 0, 0);
    sctx.restore();

    slot.colorIndex = colorIndex;
    slot.hasGlow = glowEnabled;

    // Remove slot if it was already in the active order (wrap-around)
    const existingIdx = this.trailOrder.indexOf(slot);
    if (existingIdx !== -1) {
      this.trailOrder.splice(existingIdx, 1);
    }
    this.trailOrder.push(slot);

    while (this.trailOrder.length > maxLength) {
      this.trailOrder.shift();
    }
  }

  private buildChromaCopies(): void {
    const buildTint = (
      surface: { canvas: CanvasSurface; ctx: Canvas2DContext },
      color: string
    ) => {
      const ctx = surface.ctx;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, this.procWidth, this.procHeight);
      ctx.drawImage(this.cutoutSurface.canvas, 0, 0);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(0, 0, this.procWidth, this.procHeight);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };

    buildTint(this.chromaCyanSurface, CYAN);
    buildTint(this.chromaMagentaSurface, MAGENTA);
  }

  /**
   * Renders the full-screen canvas output using aspect-preserving object-cover geometry.
   */
  render(
    displayCanvas: HTMLCanvasElement,
    displayCtx: CanvasRenderingContext2D,
    sandevistanActive: boolean,
    hasSegmentation: boolean,
    settings: SandevistanSettings
  ): void {
    const viewW = displayCanvas.width;
    const viewH = displayCanvas.height;
    if (viewW === 0 || viewH === 0) return;

    // Smooth activation / deactivation envelope
    if (sandevistanActive && !this.wasActive) {
      this.activationKick = 1;
    }
    this.wasActive = sandevistanActive;

    if (sandevistanActive) {
      this.effectBlend = Math.min(1, this.effectBlend + 0.25);
    } else {
      this.effectBlend = Math.max(0, this.effectBlend - 0.16);
      if (this.effectBlend === 0 && this.trailOrder.length > 0) {
        this.clearTrails();
      }
    }
    this.activationKick *= 0.82;
    if (this.activationKick < 0.02) this.activationKick = 0;

    // Trim buffer immediately if user lowers trailLength slider
    while (this.trailOrder.length > settings.trailLength) {
      this.trailOrder.shift();
    }

    // Object-cover destination rectangle (fills screen without stretching on portrait or landscape)
    const srcAspect = this.procWidth / this.procHeight;
    const dstAspect = viewW / viewH;
    let drawW: number;
    let drawH: number;
    let drawX: number;
    let drawY: number;

    if (dstAspect > srcAspect) {
      drawW = viewW;
      drawH = viewW / srcAspect;
      drawX = 0;
      drawY = (viewH - drawH) * 0.5;
    } else {
      drawH = viewH;
      drawW = viewH * srcAspect;
      drawX = (viewW - drawW) * 0.5;
      drawY = 0;
    }

    // Normal camera feed when Sandevistan is completely OFF
    if (this.effectBlend <= 0.001 || !hasSegmentation) {
      displayCtx.save();
      displayCtx.filter = 'none';
      displayCtx.globalAlpha = 1;
      displayCtx.globalCompositeOperation = 'source-over';
      displayCtx.drawImage(
        this.mirrorSurface.canvas,
        drawX,
        drawY,
        drawW,
        drawH
      );
      displayCtx.restore();
      return;
    }

    const blend = this.effectBlend;
    const pixelScale = drawW / this.procWidth;

    // 1. Darkened & desaturated background
    displayCtx.save();
    const sat = 1 - 0.84 * blend;
    const bright = 1 - 0.6 * blend;
    const contrast = 1 + 0.24 * blend;
    displayCtx.filter = `saturate(${sat.toFixed(2)}) brightness(${bright.toFixed(2)}) contrast(${contrast.toFixed(2)})`;
    displayCtx.drawImage(
      this.mirrorSurface.canvas,
      drawX,
      drawY,
      drawW,
      drawH
    );
    displayCtx.filter = 'none';

    // Deep cyberpunk dark-indigo grade & radial vignette (also guarantees darkening if ctx.filter is unsupported)
    displayCtx.fillStyle = `rgba(5, 8, 20, ${(0.36 * blend).toFixed(3)})`;
    displayCtx.fillRect(0, 0, viewW, viewH);

    const vignette = displayCtx.createRadialGradient(
      viewW * 0.5,
      viewH * 0.5,
      Math.min(viewW, viewH) * 0.22,
      viewW * 0.5,
      viewH * 0.5,
      Math.max(viewW, viewH) * 0.72
    );
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, `rgba(2, 4, 12, ${(0.76 * blend).toFixed(3)})`);
    displayCtx.fillStyle = vignette;
    displayCtx.fillRect(0, 0, viewW, viewH);
    displayCtx.restore();

    // 2. Horizontal speed lines behind ghost trails
    this.drawSpeedLines(displayCtx, viewW, viewH, blend);

    // 3. Ghost trails (oldest -> newest) with alternating cyan/magenta tint & spacing shift
    const count = this.trailOrder.length;
    if (count > 0) {
      displayCtx.save();
      displayCtx.globalCompositeOperation = 'screen';

      for (let i = 0; i < count; i++) {
        const slot = this.trailOrder[i];
        // age: oldest = count, newest = 1
        const age = count - i;
        const normalizedAge = age / (count + 1);

        // Older frames fade smoothly and shift progressively further
        const alpha = Math.max(0.08, (1 - normalizedAge) * 0.82) * blend;
        const shiftPx =
          age * settings.trailSpacing * pixelScale * this.trailDirection;
        // Subtle vertical drift + slight scale depth for Edgerunners velocity feel
        const jitterY =
          (slot.colorIndex === 0 ? -1 : 1) * age * 0.55 * pixelScale;
        const scaleBoost = 1 + age * 0.0045;
        const scaledW = drawW * scaleBoost;
        const scaledH = drawH * scaleBoost;
        const cxOffset = (drawW - scaledW) * 0.5;
        const cyOffset = (drawH - scaledH) * 0.5;

        displayCtx.globalAlpha = alpha;
        displayCtx.drawImage(
          slot.canvas,
          drawX + cxOffset + shiftPx,
          drawY + cyOffset + jitterY,
          scaledW,
          scaledH
        );
      }

      displayCtx.restore();
    }

    // 4. Subtle chromatic aberration split around the live silhouette
    this.buildChromaCopies();
    const chromaShift = (3.5 + this.activationKick * 8.5) * pixelScale;
    displayCtx.save();
    displayCtx.globalCompositeOperation = 'screen';
    displayCtx.globalAlpha = (0.34 + this.activationKick * 0.25) * blend;
    displayCtx.drawImage(
      this.chromaCyanSurface.canvas,
      drawX - chromaShift,
      drawY,
      drawW,
      drawH
    );
    displayCtx.drawImage(
      this.chromaMagentaSurface.canvas,
      drawX + chromaShift,
      drawY,
      drawW,
      drawH
    );
    displayCtx.restore();

    // 5. Crisp live foreground person cutout with optional neon rim glow
    displayCtx.save();
    displayCtx.globalCompositeOperation = 'source-over';
    displayCtx.globalAlpha = 1;
    if (settings.glowEnabled) {
      displayCtx.shadowColor =
        this.colorParity === 0
          ? 'rgba(0, 240, 255, 0.8)'
          : 'rgba(255, 43, 214, 0.75)';
      displayCtx.shadowBlur = Math.round(18 * Math.min(1.5, pixelScale));
    }
    displayCtx.drawImage(
      this.cutoutSurface.canvas,
      drawX,
      drawY,
      drawW,
      drawH
    );
    displayCtx.restore();

    // Brief cyan/magenta activation flash edge pulse
    if (this.activationKick > 0.05) {
      displayCtx.save();
      displayCtx.globalCompositeOperation = 'screen';
      displayCtx.fillStyle = `rgba(0, 240, 255, ${(this.activationKick * 0.14).toFixed(3)})`;
      displayCtx.fillRect(0, 0, viewW, viewH);
      displayCtx.restore();
    }
  }

  private drawSpeedLines(
    ctx: CanvasRenderingContext2D,
    viewW: number,
    viewH: number,
    blend: number
  ): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const dir = this.trailDirection;
    for (let i = 0; i < this.speedLines.length; i++) {
      const line = this.speedLines[i];
      line.x += line.speed * dir;

      if (dir > 0 && line.x - line.length > 1.1) {
        line.x = -0.15;
        line.y = Math.random();
      } else if (dir < 0 && line.x + line.length < -0.1) {
        line.x = 1.15;
        line.y = Math.random();
      }

      const x1 = line.x * viewW;
      const x2 = (line.x - line.length * dir) * viewW;
      const y = line.y * viewH;

      const grad = ctx.createLinearGradient(x1, y, x2, y);
      grad.addColorStop(0, line.color);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.strokeStyle = grad;
      ctx.globalAlpha = line.alpha * blend;
      ctx.lineWidth = line.thickness;
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
    }

    ctx.restore();
  }
}
