// Port of DMatrix.java — double-precision 3×3 matrix.
// Row-major indices: [SCALE_X, SKEW_X, TRANS_X, SKEW_Y, SCALE_Y, TRANS_Y, PERSP_0, PERSP_1, PERSP_2]
export class DMatrix {
  static readonly SCALE_X = 0;
  static readonly SKEW_X  = 1;
  static readonly TRANS_X = 2;
  static readonly SKEW_Y  = 3;
  static readonly SCALE_Y = 4;
  static readonly TRANS_Y = 5;
  static readonly PERSP_0 = 6;
  static readonly PERSP_1 = 7;
  static readonly PERSP_2 = 8;

  private data: number[];

  constructor(src?: DMatrix) {
    this.data = new Array<number>(9).fill(0);
    if (src) {
      this.set(src);
    } else {
      this.reset();
    }
  }

  reset(): void {
    this.data.fill(0);
    this.data[DMatrix.SCALE_X] = 1;
    this.data[DMatrix.SCALE_Y] = 1;
    this.data[DMatrix.PERSP_2] = 1;
  }

  set(from: DMatrix): void {
    this.data = [...from.data];
  }

  getValues(): number[] {
    return [...this.data];
  }

  setValues(values: number[]): void {
    if (values.length !== 9) throw new Error('DMatrix.setValues: need 9 values');
    this.data = [...values];
  }

  isIdentity(): boolean {
    const d = this.data;
    return d[0]===1 && d[4]===1 && d[8]===1
        && d[1]===0 && d[2]===0 && d[3]===0
        && d[5]===0 && d[6]===0 && d[7]===0;
  }

  // Apply this matrix to src points (x0,y0,x1,y1,...) and write results into dst.
  mapPoints(dst: number[], src: number[]): void {
    const count = src.length / 2;
    const d = this.data;
    const hasPerspective = d[6]!==0 || d[7]!==0 || d[8]!==1;
    for (let i = 0; i < count; i++) {
      const sx = src[2*i];
      const sy = src[2*i+1];
      let x = d[0]*sx + d[1]*sy + d[2];
      let y = d[3]*sx + d[4]*sy + d[5];
      if (hasPerspective) {
        let z = d[6]*sx + d[7]*sy + d[8];
        if (!isZero(z)) z = 1/z;
        x *= z;
        y *= z;
      }
      dst[2*i]   = x;
      dst[2*i+1] = y;
    }
  }

  invert(into: DMatrix): boolean {
    if (this.isIdentity()) { into.set(this); return true; }
    const temp = this.computeMinors();
    const t = temp.data;
    t[1] = -t[1];
    t[3] = -t[3];
    t[5] = -t[5];
    t[7] = -t[7];
    const c0=t[0], c1=t[1], c2=t[2];
    // transpose (adjugate)
    swap(t, 1, 3);
    swap(t, 2, 6);
    swap(t, 5, 7);
    const det = this.data[0]*c0 + this.data[1]*c1 + this.data[2]*c2;
    if (isZero(det)) return false;
    const mul = 1/det;
    for (let i=0;i<9;i++) t[i] *= mul;
    into.set(temp);
    return true;
  }

  setConcat(a: DMatrix, b: DMatrix): void {
    const tmp = new Array<number>(9).fill(0);
    for (let r=0;r<3;r++) {
      for (let c=0;c<3;c++) {
        let v=0;
        for (let i=0;i<3;i++) v += a.data[3*r+i] * b.data[3*i+c];
        tmp[3*r+c] = v;
      }
    }
    this.data = tmp;
  }

  preConcat(other: DMatrix): void {
    if (!other.isIdentity()) this.setConcat(this, other);
  }

  postConcat(other: DMatrix): void {
    if (!other.isIdentity()) this.setConcat(other, this);
  }

  setTranslate(tx: number, ty: number): void {
    this.reset();
    this.data[DMatrix.TRANS_X] = tx;
    this.data[DMatrix.TRANS_Y] = ty;
  }

  // Fit matrix so that src points map to dst points.
  // count must be 2 or 3 (4-point case not needed for MVP).
  setPolyToPoly(src: number[], dst: number[], count: number): boolean {
    if (count < 2 || count > 3) return false;

    const process = count === 2 ? DMatrix.poly2Process : DMatrix.poly3Process;

    const temp = new DMatrix();
    if (!process(src, temp)) return false;
    const result = new DMatrix();
    if (!temp.invert(result)) return false;
    if (!process(dst, temp)) return false;
    this.setConcat(temp, result);
    return true;
  }

  // Write raw values directly (used by static poly process helpers).
  setRaw(values: number[]): void { this.data = values; }

  private static poly2Process(pts: number[], dst: DMatrix): boolean {
    const d = [0,0,0,0,0,0,0,0,1];
    d[DMatrix.SCALE_X] = pts[3] - pts[1];
    d[DMatrix.SKEW_Y]  = pts[0] - pts[2];
    d[DMatrix.SKEW_X]  = pts[2] - pts[0];
    d[DMatrix.SCALE_Y] = pts[3] - pts[1];
    d[DMatrix.TRANS_X] = pts[0];
    d[DMatrix.TRANS_Y] = pts[1];
    dst.setRaw(d);
    return true;
  }

  private static poly3Process(pts: number[], dst: DMatrix): boolean {
    const d = [0,0,0,0,0,0,0,0,1];
    d[DMatrix.SCALE_X] = pts[4] - pts[0];
    d[DMatrix.SKEW_Y]  = pts[5] - pts[1];
    d[DMatrix.SKEW_X]  = pts[2] - pts[0];
    d[DMatrix.SCALE_Y] = pts[3] - pts[1];
    d[DMatrix.TRANS_X] = pts[0];
    d[DMatrix.TRANS_Y] = pts[1];
    dst.setRaw(d);
    return true;
  }

  private computeMinors(): DMatrix {
    const m = new DMatrix();
    for (let r=0;r<3;r++) {
      for (let c=0;c<3;c++) {
        m.data[3*r+c] = this.det2x2(r,c);
      }
    }
    return m;
  }

  private det2x2(row: number, col: number): number {
    const r1 = row===0?1:0, r2 = row===2?1:2;
    const c1 = col===0?1:0, c2 = col===2?1:2;
    return this.data[3*r1+c1]*this.data[3*r2+c2] - this.data[3*r2+c1]*this.data[3*r1+c2];
  }
}

function isZero(d: number): boolean { return d*d === 0; }
function swap(arr: number[], i: number, j: number): void {
  const v=arr[i]; arr[i]=arr[j]; arr[j]=v;
}
