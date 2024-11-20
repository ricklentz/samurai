/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
export class DataArray {
  data: Uint8Array;
  readonly shape: number[];

  constructor(data: Uint8Array, shape: Array<number>) {
    this.data = data;
    this.shape = shape;
  }
}

export type RLEObject = {
  size: [h: number, w: number];
  counts: string;
};

type RLE = {
  h: number;
  w: number;
  m: number;
  cnts: number[];
};

type BB = number[];

function rleInit(R: RLE, h: number, w: number, m: number, cnts: number[]) {
  R.h = h;
  R.w = w;
  R.m = m;
  R.cnts = m === 0 ? [0] : cnts;
}

function rlesInit(R: RLE[], n: number) {
  let i;
  for (i = 0; i < n; i++) {
    R[i] = {h: 0, w: 0, m: 0, cnts: [0]};
    rleInit(R[i], 0, 0, 0, [0]);
  }
}

class RLEs {
  _R: RLE[];
  _n: number;

  constructor(n: number) {
    this._R = [];
    rlesInit(this._R, n);
    this._n = n;
  }
}

export class Masks {
  _mask: Uint8Array;
  _h: number;
  _w: number;
  _n: number;

  constructor(h: number, w: number, n: number) {
    this._mask = new Uint8Array(h * w * n);
    this._h = h;
    this._w = w;
    this._n = n;
  }

  toDataArray(): DataArray {
    return new DataArray(this._mask, [this._h, this._w, this._n]);
  }
}

// encode mask to RLEs objects
// list of RLE string can be generated by RLEs member function
export function encode(mask: DataArray): RLEObject[] {
  const h = mask.shape[0];
  const w = mask.shape[1];
  const n = mask.shape[2];
  const Rs = new RLEs(n);
  rleEncode(Rs._R, mask.data, h, w, n);
  const objs = _toString(Rs);
  return objs;
}

// decode mask from compressed list of RLE string or RLEs object
export function decode(rleObjs: RLEObject[]): DataArray {
  const Rs = _frString(rleObjs);
  const h = Rs._R[0].h;
  const w = Rs._R[0].w;
  const n = Rs._n;
  const masks = new Masks(h, w, n);
  rleDecode(Rs._R, masks._mask, n);
  return masks.toDataArray();
}

export function toBbox(rleObjs: RLEObject[]): BB {
  const Rs = _frString(rleObjs);
  const n = Rs._n;
  const bb: BB = [];
  rleToBbox(Rs._R, bb, n);
  return bb;
}

function rleEncode(R: RLE[], M: Uint8Array, h: number, w: number, n: number) {
  let i;
  let j;
  let k;
  const a = w * h;
  let c;
  const cnts: number[] = [];
  let p;
  for (i = 0; i < n; i++) {
    const from = a * i;
    const to = a * (i + 1);
    // Slice data for current RLE object
    const T = M.slice(from, to);
    k = 0;
    p = 0;
    c = 0;
    for (j = 0; j < a; j++) {
      if (T[j] !== p) {
        cnts[k++] = c;
        c = 0;
        p = T[j];
      }
      c++;
    }
    cnts[k++] = c;
    rleInit(R[i], h, w, k, [...cnts]);
  }
}

function rleDecode(R: RLE[], M: Uint8Array, n: number): void {
  let i;
  let j;
  let k;
  let p = 0;
  for (i = 0; i < n; i++) {
    let v = false;
    for (j = 0; j < R[i].m; j++) {
      for (k = 0; k < R[i].cnts[j]; k++) {
        M[p++] = v === false ? 0 : 1;
      }
      v = !v;
    }
  }
}

function rleToString(R: RLE): string {
  /* Similar to LEB128 but using 6 bits/char and ascii chars 48-111. */
  let i;
  const m = R.m;
  let p = 0;
  let x: number;
  let more;
  const s: string[] = [];
  for (i = 0; i < m; i++) {
    x = R.cnts[i];
    if (i > 2) {
      x -= R.cnts[i - 2];
    }
    more = true; // 1;
    while (more) {
      let c = x & 0x1f;
      x >>= 5;
      more = c & 0x10 ? x != -1 : x != 0;
      if (more) {
        c |= 0x20;
      }
      c += 48;
      s[p++] = String.fromCharCode(c);
    }
  }
  return s.join('');
}

// internal conversion from Python RLEs object to compressed RLE format
function _toString(Rs: RLEs): RLEObject[] {
  const n = Rs._n;
  let py_string;
  let c_string;
  const objs: RLEObject[] = [];
  for (let i = 0; i < n; i++) {
    c_string = rleToString(Rs._R[i]);
    py_string = c_string;
    objs.push({
      size: [Rs._R[i].h, Rs._R[i].w],
      counts: py_string,
    });
  }
  return objs;
}

// internal conversion from compressed RLE format to Python RLEs object
function _frString(rleObjs: RLEObject[]): RLEs {
  const n = rleObjs.length;
  const Rs = new RLEs(n);
  let py_string;
  let c_string;
  for (let i = 0; i < rleObjs.length; i++) {
    const obj = rleObjs[i];
    py_string = obj.counts;
    c_string = py_string;
    rleFrString(Rs._R[i], c_string, obj.size[0], obj.size[1]);
  }
  return Rs;
}

function rleToBbox(R: RLE[], bb: BB, n: number) {
  for (let i = 0; i < n; i++) {
    const h = R[i].h;
    const w = R[i].w;
    let m = R[i].m;
    // The RLE structure likely contains run-length encoded data where each
    // element represents a count of consecutive pixels with the same value in
    // a binary image (black or white). Since the counts represent both black
    // and white pixels, this operation ((siz)(m/2)) * 2 is used to ensure that
    // m is always an even number. By doing so, the code can later check
    // whether the current pixel is black or white based on whether the index j
    // is even or odd.
    m = Math.floor(m / 2) * 2;
    let xs = w;
    let ys = h;
    let xe = 0;
    let ye = 0;
    let cc = 0;
    let t;
    let y;
    let x;
    let xp = 0;
    if (m === 0) {
      bb[4 * i] = bb[4 * i + 1] = bb[4 * i + 2] = bb[4 * i + 3] = 0;
      continue;
    }
    for (let j = 0; j < m; j++) {
      cc += R[i].cnts[j];
      t = cc - (j % 2);
      y = t % h;
      x = Math.floor((t - y) / h);
      if (j % 2 === 0) {
        xp = x;
      } else if (xp < x) {
        ys = 0;
        ye = h - 1;
      }
      xs = Math.min(xs, x);
      xe = Math.max(xe, x);
      ys = Math.min(ys, y);
      ye = Math.max(ye, y);
    }
    bb[4 * i] = xs;
    bb[4 * i + 2] = xe - xs + 1;
    bb[4 * i + 1] = ys;
    bb[4 * i + 3] = ye - ys + 1;
  }
}

function rleFrString(R: RLE, s: string, h: number, w: number): void {
  let m = 0;
  let p = 0;
  let k;
  let x;
  let more;
  let cnts = [];
  while (s[m]) {
    m++;
  }
  cnts = [];
  m = 0;
  while (s[p]) {
    x = 0;
    k = 0;
    more = 1;
    while (more) {
      const c = s.charCodeAt(p) - 48;
      x |= (c & 0x1f) << (5 * k);
      more = c & 0x20;
      p++;
      k++;
      if (!more && c & 0x10) {
        x |= -1 << (5 * k);
      }
    }
    if (m > 2) {
      x += cnts[m - 2];
    }
    cnts[m++] = x;
  }
  rleInit(R, h, w, m, cnts);
}