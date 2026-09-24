// Pannable/zoomable canvas for picking image pixels.
// One finger / mouse drags, two fingers pinch-zoom, the mouse wheel zooms.
// A tap (movement < 5px) emits pixel coordinates in the original image space.
export class ImagePointPicker {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private confirmed: { x: number; y: number }[] = [];
  private pending: { x: number; y: number } | null = null;
  private onPickCb: ((x: number, y: number) => void) | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private tapStart: { x: number; y: number } | null = null;
  private moved = false;
  private userAdjusted = false;
  private ro: ResizeObserver | null = null;

  constructor(canvas: HTMLCanvasElement, private image: HTMLImageElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resizeCanvas();
    this.fitImage();
    this.draw();
    this.bindEvents();
  }

  onPick(cb: (x: number, y: number) => void): void { this.onPickCb = cb; }

  destroy(): void { this.ro?.disconnect(); this.ro = null; }

  // The point being chosen; replaced by each new tap until confirmed.
  setPending(x: number, y: number): void {
    this.pending = { x, y };
    this.draw();
  }

  // Keep the pending point as a confirmed tiepoint.
  confirmPending(): void {
    if (this.pending) this.confirmed.push(this.pending);
    this.pending = null;
    this.draw();
  }

  private resizeCanvas(): { dw: number; dh: number } {
    // getBoundingClientRect returns the rendered CSS size (non-zero even before first paint),
    // unlike clientWidth/clientHeight which can be 0 right after innerHTML replacement.
    const rect = this.canvas.getBoundingClientRect();
    const cw = Math.round(rect.width || this.canvas.width);
    const ch = Math.round(rect.height || this.canvas.height);
    const dw = cw - this.canvas.width, dh = ch - this.canvas.height;
    this.canvas.width = cw;
    this.canvas.height = ch;
    return { dw, dh };
  }

  private fitImage(): void {
    const cw = this.canvas.width, ch = this.canvas.height;
    this.scale = Math.min(cw / this.image.naturalWidth, ch / this.image.naturalHeight) * 0.9;
    this.tx = (cw - this.image.naturalWidth * this.scale) / 2;
    this.ty = (ch - this.image.naturalHeight * this.scale) / 2;
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.setTransform(this.scale, 0, 0, this.scale, this.tx, this.ty);
    ctx.drawImage(this.image, 0, 0);
    ctx.lineWidth = 2 / this.scale;
    const r = 9 / this.scale;
    for (const p of this.confirmed) this.drawMark(p, r, '#16a34a');
    if (this.pending) this.drawMark(this.pending, r, '#dc2626');
    ctx.restore();
  }

  private drawMark(p: { x: number; y: number }, r: number, color: string): void {
    const ctx = this.ctx;
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  private zoomAt(px: number, py: number, factor: number): void {
    this.tx = px - factor * (px - this.tx);
    this.ty = py - factor * (py - this.ty);
    this.scale *= factor;
    this.userAdjusted = true;
  }

  private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private bindEvents(): void {
    const el = this.canvas;

    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      this.pointers.set(e.pointerId, this.local(e));
      if (this.pointers.size === 1) {
        this.tapStart = this.local(e);
        this.moved = false;
      } else {
        this.moved = true; // a second finger means pinch, never a tap
      }
    });

    el.addEventListener('pointermove', e => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const cur = this.local(e);

      if (this.pointers.size === 1) {
        this.tx += cur.x - prev.x;
        this.ty += cur.y - prev.y;
        if (this.tapStart && Math.hypot(cur.x - this.tapStart.x, cur.y - this.tapStart.y) > 5) this.moved = true;
        this.userAdjusted = true;
      } else if (this.pointers.size === 2) {
        const [other] = [...this.pointers].filter(([id]) => id !== e.pointerId).map(([, p]) => p);
        const before = Math.hypot(prev.x - other.x, prev.y - other.y);
        const after = Math.hypot(cur.x - other.x, cur.y - other.y);
        const mid = { x: (cur.x + other.x) / 2, y: (cur.y + other.y) / 2 };
        // Pan by half the finger movement (the midpoint moves half as far), then zoom about the midpoint
        this.tx += (cur.x - prev.x) / 2;
        this.ty += (cur.y - prev.y) / 2;
        if (before > 0) this.zoomAt(mid.x, mid.y, after / before);
      }
      this.pointers.set(e.pointerId, cur);
      this.draw();
    });

    const end = (e: PointerEvent, isCancel: boolean) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (!isCancel && this.pointers.size === 0 && !this.moved) {
        const img = this.screenToImage(this.local(e));
        // Clamp to image bounds
        const ix = Math.max(0, Math.min(this.image.naturalWidth, img.x));
        const iy = Math.max(0, Math.min(this.image.naturalHeight, img.y));
        this.onPickCb?.(ix, iy);
      }
      if (this.pointers.size === 0) this.tapStart = null;
    };
    el.addEventListener('pointerup', e => end(e, false));
    el.addEventListener('pointercancel', e => end(e, true));

    // On resize (rotation, mobile address bar), keep the user's view centred instead of re-fitting
    this.ro = new ResizeObserver(() => {
      const { dw, dh } = this.resizeCanvas();
      if (this.userAdjusted) {
        this.tx += dw / 2;
        this.ty += dh / 2;
      } else {
        this.fitImage();
      }
      this.draw();
    });
    this.ro.observe(el);

    el.addEventListener('wheel', e => {
      e.preventDefault();
      const p = this.local(e);
      this.zoomAt(p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      this.draw();
    }, { passive: false });
  }

  private screenToImage(p: { x: number; y: number }): { x: number; y: number } {
    return { x: (p.x - this.tx) / this.scale, y: (p.y - this.ty) / this.scale };
  }
}
