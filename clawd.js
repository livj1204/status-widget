'use strict';
// 픽셀 클로드: 작은 캔버스에 상태별 움직임을 그린다.
// 상태: busy 작업 중(노트북) · think 생각 중(점 셋) · wait 응답 필요(느낌표 팻말) · idle 내 차례(✓) · sleep 자는 중(Z)
// sweat = 컨텍스트가 많이 찼을 때 땀방울 + 볼 빨개짐. 1초에 8장, 보이는 것만 그린다.
(() => {
  const K = {
    b: '#D97757', s: '#B4573A', e: '#2A1A12', ch: '#F3A38E',
    sc: '#1E2638', fr: '#4A5570', kb: '#A3ABBD', kb2: '#7E879B',
    l: ['#7FE0C0', '#9CC3FF', '#F5C46B'],
    r: '#D94848', w: '#FFFFFF', g: '#3E9E5A', z: '#8C95B2', d: '#E0A23B', sw: '#8FD3FF', sw2: '#D8F1FF'
  };
  const JUMP = [-1, -2, -3, -2, -1, 0];
  const hh = n => {
    n = Math.imul(n | 0, 2654435761) >>> 0;
    n ^= n >>> 15;
    return n;
  };
  const all = new Set();
  const shown = new Map(); // 무리 이름 → 지금 보이는지 (widget.js가 알려 준다)
  let t = 0;
  let timer = null;

  function R(o, x, y, w, h, col) {
    o.c.fillStyle = col;
    o.c.fillRect(x * o.u, y * o.u, w * o.u, h * o.u);
  }
  function arm(o, x, y, side, p) {
    const ax = side === 'L' ? x : x + 14;
    if (p === 'mid') R(o, ax, y + 6, 2, 1, K.b);
    else if (p === 'low') R(o, ax, y + 7, 2, 1, K.b);
    else if (p === 'up') {
      if (side === 'R') {
        R(o, x + 14, y + 5, 1, 1, K.b);
        R(o, x + 15, y + 3, 1, 2, K.b);
      } else {
        R(o, x + 1, y + 5, 1, 1, K.b);
        R(o, x, y + 3, 1, 2, K.b);
      }
    }
  }
  function body(o, x, y, f) {
    R(o, x + 2, y + 3, 12, 6, K.b);
    R(o, x + 2, y + 8, 12, 1, K.s);
    const dx = f.dx || 0;
    const dy = f.ey || 0;
    if (f.eyes === 'closed') {
      R(o, x + 3, y + 6, 2, 1, K.e);
      R(o, x + 11, y + 6, 2, 1, K.e);
    } else if (f.eyes === 'blink') {
      R(o, x + 4 + dx, y + 6, 1, 1, K.e);
      R(o, x + 11 + dx, y + 6, 1, 1, K.e);
    } else {
      R(o, x + 4 + dx, y + 5 + dy, 1, 2, K.e);
      R(o, x + 11 + dx, y + 5 + dy, 1, 2, K.e);
    }
    if (o.sweat) {
      R(o, x + 3, y + 7, 1, 1, K.ch);
      R(o, x + 12, y + 7, 1, 1, K.ch);
    }
    arm(o, x, y, 'L', f.aL || 'mid');
    arm(o, x, y, 'R', f.aR || 'mid');
    const L = f.legs || [2, 2, 2, 2];
    [3, 5, 10, 12].forEach((lx, i) => {
      if (L[i]) R(o, x + lx, y + 9, 1, L[i], K.b);
    });
  }
  function sweat(o, x, y, T) {
    for (const [sx, ph] of [[x + 15, 0], [x, 3]]) {
      const p = (T + ph) % 6;
      if (p > 4) continue;
      R(o, sx, y + 2 + p, 1, 1, K.sw2);
      R(o, sx, y + 3 + p, 1, 1, K.sw);
    }
  }
  function laptop(o, x, y, T) {
    R(o, x + 1, y, 8, 6, K.fr);
    R(o, x + 2, y + 1, 6, 4, K.sc);
    const base = Math.floor(T / (o.sweat ? 1 : 2));
    for (let r = 0; r < 4; r++) {
      const n = hh(base + r + o.seed);
      const ind = n % 3 === 0 ? 1 : 0;
      const len = Math.min(2 + ((n >> 3) % 5), 6 - ind);
      R(o, x + 2 + ind, y + 1 + r, len, 1, K.l[(n >> 5) % 3]);
    }
    R(o, x, y + 6, 10, 1, K.kb);
    R(o, x, y + 7, 10, 1, K.kb2);
  }

  function draw(o) {
    const c = o.c;
    c.clearRect(0, 0, o.cv.width, o.cv.height);
    const T = t + o.seed;
    let j = 0;
    if (o.jump > 0) {
      j = JUMP[6 - o.jump];
      o.jump--;
    }
    const full = o.kind === 'full';
    const x = full ? 2 : 1;
    const y = (full ? 4 : -3) + j;
    const ph = T % 48;
    const st = o.state;
    if (st === 'busy') {
      const a = T % 2;
      if (full) laptop(o, 17, 6, T);
      body(o, x, y, { dx: full ? 1 : 0, aL: a ? 'mid' : 'low', aR: a ? 'low' : 'mid', eyes: T % 37 === 0 ? 'blink' : 'open' });
    } else if (st === 'think') {
      const look = T % 24 < 12;
      body(o, x, y, { dx: look ? 1 : 0, ey: -1, aR: look ? 'up' : 'mid', eyes: T % 29 === 0 ? 'blink' : 'open' });
      if (full) {
        const n = Math.floor(T / 3) % 4;
        for (let i = 0; i < n; i++) R(o, 17 + i * 3, 4, 2, 2, K.d);
      }
    } else if (st === 'wait') {
      const hop = T % 8 < 2 ? 1 : 0;
      body(o, x, y - hop, { aR: T % 4 < 2 ? 'up' : 'mid', legs: hop ? [1, 2, 2, 1] : [2, 2, 2, 2] });
      if (full) {
        const sy = T % 8 < 4 ? 0 : 1;
        R(o, 16, sy, 7, 6, K.r);
        R(o, 19, sy + 1, 1, 2, K.w);
        R(o, 19, sy + 4, 1, 1, K.w);
        R(o, 17, sy + 6, 1, 1, K.r);
      }
    } else if (st === 'sleep' && o.jump <= 0) {
      body(o, x, y + 1, { eyes: 'closed', legs: [1, 1, 1, 1], aL: 'low', aR: 'low' });
      if (full) {
        for (let k = 0; k < 3; k++) {
          const p = (T + k * 8) % 24;
          if (p > 21) continue;
          const zx = 16 + Math.floor(p / 4);
          const zy = 7 - Math.floor(p / 3);
          R(o, zx, zy, 3, 1, K.z);
          R(o, zx + 1, zy + 1, 1, 1, K.z);
          R(o, zx, zy + 2, 3, 1, K.z);
        }
      }
    } else {
      // idle (자다가 콕 찌르면 잠깐 깨서 이 모습)
      const dx = ph < 8 ? -1 : ph >= 24 && ph < 32 ? 1 : 0;
      const tap = ph % 12 < 2;
      body(o, x, y, { dx, eyes: T % 30 === 0 ? 'blink' : 'open', legs: [2, 2, 2, tap ? 1 : 2] });
      if (full && st === 'idle') {
        const by = T % 16 < 8 ? 0 : -1;
        [[18, 4], [19, 5], [20, 4], [21, 3], [22, 2]].forEach(([px, py]) => R(o, px, py + by, 1, 1, K.g));
      }
    }
    if (o.sweat && st !== 'sleep') sweat(o, x, y, T);
  }

  function visible(o) {
    if (!o.cv.isConnected) return false;
    if (o.group && shown.get(o.group) === false) return false;
    return o.cv.offsetParent !== null;
  }
  function tick() {
    if (document.hidden) return;
    t++;
    for (const o of all) {
      if (visible(o)) draw(o);
    }
    if (!all.size) {
      clearInterval(timer);
      timer = null;
    }
  }

  // kind: full = 28×16칸(노트북·팻말·Z 포함) / head = 18×9칸(몸만). px = 한 칸의 크기(화면 px)
  function make(opts) {
    const kind = opts.kind === 'head' ? 'head' : 'full';
    const gw = kind === 'head' ? 18 : 28;
    const gh = kind === 'head' ? 9 : 16;
    const px = opts.px || 2;
    const dpr = window.devicePixelRatio || 1;
    const u = Math.max(1, Math.round(px * dpr)); // 화면 배율에서도 칸이 번지지 않게 정수로
    const cv = document.createElement('canvas');
    cv.className = 'clawd ' + (opts.cls || '');
    cv.width = gw * u;
    cv.height = gh * u;
    cv.style.width = gw * u / dpr + 'px';
    cv.style.height = gh * u / dpr + 'px';
    cv.setAttribute('aria-hidden', 'true');
    const o = { cv, c: cv.getContext('2d'), u, kind, group: opts.group || '', state: opts.state || 'idle', sweat: !!opts.sweat, seed: (Math.random() * 997) | 0, jump: 0 };
    all.add(o);
    draw(o);
    if (!timer) timer = setInterval(tick, 125);
    return {
      el: cv,
      set(state, sw) {
        const changed = o.state !== state || o.sweat !== !!sw;
        o.state = state;
        o.sweat = !!sw;
        if (changed) draw(o);
      },
      poke() {
        o.jump = 6;
        draw(o);
      },
      // 다시 쓰지 않을 때 (카드·알약 클로드를 뺄 때)
      drop() {
        all.delete(o);
      }
    };
  }

  window.Clawd = {
    make,
    show(group, on) {
      shown.set(group, !!on);
    }
  };
})();
