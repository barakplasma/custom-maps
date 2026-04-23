// Pannable/zoomable canvas for picking image pixels.
// Click (movement < 5px) emits pixel coordinates in the original image space.
export class ImagePointPicker {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private picks: { x: number; y: number }[] = [];
  private onPickCb: ((x: number, y: number) => void) | null = null;
  private dragStart: { px: number; py: number; tx: number; ty: number } | null = null;
  private moved = false;
  private ro: ResizeObserver | null = null;

  constructor(canvas: HTMLCanvasElement, private image: HTMLImageElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.fitImage();
    this.draw();
    this.bindEvents();
  }

  onPick(cb: (x: number, y: number) => void): void { this.onPickCb = cb; }

  destroy(): void { this.ro?.disconnect(); this.ro = null; }

  addMark(x: number, y: number): void {
    this.picks.push({ x, y });
    this.draw();
  }

  private fitImage(): void {
    // getBoundingClientRect returns actual rendered CSS size (non-zero even before first paint),
    // unlike clientWidth/clientHeight which can be 0 right after innerHTML replacement.
    const rect = this.canvas.getBoundingClientRect();
    const cw = rect.width  || this.canvas.width;
    const ch = rect.height || this.canvas.height;
    this.canvas.width  = cw;
    this.canvas.height = ch;
    this.scale = Math.min(cw / this.image.naturalWidth, ch / this.image.naturalHeight) * 0.9;
    this.tx = (cw - this.image.naturalWidth  * this.scale) / 2;
    this.ty = (ch - this.image.naturalHeight * this.scale) / 2;
  }

  private draw(): void {
    const ctx = this.ctx;
    const cw = this.canvas.width, ch = this.canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.setTransform(this.scale, 0, 0, this.scale, this.tx, this.ty);
    ctx.drawImage(this.image, 0, 0);
    // Draw pick marks in image space
    ctx.strokeStyle = '#ef4444';
    ctx.fillStyle   = 'rgba(239,68,68,0.3)';
    ctx.lineWidth   = 2 / this.scale;
    for (const p of this.picks) {
      const r = 8 / this.scale;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI*2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  private screenToImage(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.tx) / this.scale, y: (sy - this.ty) / this.scale };
  }

  private bindEvents(): void {
    const el = this.canvas;

    // Pointer drag & click
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      this.dragStart = { px: e.clientX, py: e.clientY, tx: this.tx, ty: this.ty };
      this.moved = false;
    });
    el.addEventListener('pointermove', e => {
      if (!this.dragStart) return;
      const dx = e.clientX - this.dragStart.px, dy = e.clientY - this.dragStart.py;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) this.moved = true;
      this.tx = this.dragStart.tx + dx;
      this.ty = this.dragStart.ty + dy;
      this.draw();
    });
    el.addEventListener('pointerup', e => {
      if (!this.dragStart) return;
      if (!this.moved) {
        const rect = el.getBoundingClientRect();
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const img = this.screenToImage(sx, sy);
        // Clamp to image bounds
        const ix = Math.max(0, Math.min(this.image.naturalWidth,  img.x));
        const iy = Math.max(0, Math.min(this.image.naturalHeight, img.y));
        this.onPickCb?.(ix, iy);
      }
      this.dragStart = null;
    });
    el.addEventListener('pointercancel', () => { this.dragStart = null; });

    // Re-fit image when canvas is resized (e.g. orientation change)
    this.ro = new ResizeObserver(() => { this.fitImage(); this.draw(); });
    this.ro.observe(el);

    // Wheel zoom anchored at pointer
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1/1.15;
      this.tx = px - factor * (px - this.tx);
      this.ty = py - factor * (py - this.ty);
      this.scale *= factor;
      this.draw();
    }, { passive: false });
  }
}
