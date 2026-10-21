// ===== Núcleo: OBJ/MTL -> cores por triângulo -> 3MF pintado (Bambu Studio / OrcaSlicer) =====
// Sem DOM: roda no navegador e no Node.
const Core = (() => {
  const nextTick = () => new Promise(r => setTimeout(r, 0));

  // ---------- OBJ ----------
  async function parseOBJ(u8, onProg) {
    let P = new Float32Array(3 << 18), nP = 0;
    let C = null;                        // cores por vértice (opcional)
    let T = new Float32Array(2 << 18), nT = 0;
    let FV = new Uint32Array(3 << 19), FT = new Int32Array(3 << 19), FM = new Uint16Array(1 << 19), nF = 0;
    const matNames = [''], matIdx = { '': 0 }; let curMat = 0; const mtllibs = [];
    const n = u8.length; let i = 0;
    const grow = (a, need) => { if (need <= a.length) return a; const b = new a.constructor(Math.max(need, a.length * 2)); b.set(a); return b; };

    function skipSp() { while (i < n && (u8[i] === 32 || u8[i] === 9)) i++; }
    function eol() { return i >= n || u8[i] === 10 || u8[i] === 13; }
    function num() {
      skipSp();
      let s = 1; if (u8[i] === 45) { s = -1; i++; } else if (u8[i] === 43) i++;
      let v = 0, c;
      while (i < n && (c = u8[i] - 48) >= 0 && c <= 9) { v = v * 10 + c; i++; }
      if (u8[i] === 46) { i++; let f = 0.1; while (i < n && (c = u8[i] - 48) >= 0 && c <= 9) { v += c * f; f *= 0.1; i++; } }
      if (u8[i] === 101 || u8[i] === 69) {
        i++; let es = 1; if (u8[i] === 45) { es = -1; i++; } else if (u8[i] === 43) i++;
        let e = 0; while (i < n && (c = u8[i] - 48) >= 0 && c <= 9) { e = e * 10 + c; i++; }
        v *= Math.pow(10, es * e);
      }
      return s * v;
    }
    function int() { let s = 1; if (u8[i] === 45) { s = -1; i++; } let v = 0, c; while (i < n && (c = u8[i] - 48) >= 0 && c <= 9) { v = v * 10 + c; i++; } return s * v; }
    function rest() { skipSp(); const a = i; while (!eol()) i++; let b = i; while (b > a && (u8[b - 1] === 32 || u8[b - 1] === 9)) b--; return new TextDecoder().decode(u8.subarray(a, b)); }
    function skipLine() { while (i < n && u8[i] !== 10) i++; }

    const poly = [], polyT = [];
    let nextYield = 1 << 23;
    while (i < n) {
      if (i > nextYield) { nextYield = i + (1 << 23); if (onProg) onProg(i / n); await nextTick(); }
      const c0 = u8[i];
      if (c0 === 118) { // v
        const c1 = u8[i + 1];
        if (c1 === 32 || c1 === 9) {
          i += 2; P = grow(P, nP + 3);
          P[nP] = num(); P[nP + 1] = num(); P[nP + 2] = num();
          skipSp();
          if (!eol()) {
            const r = num(), g = num(), b = num();
            if (!C) C = new Float32Array(P.length).fill(1);
            C = grow(C, nP + 3); C[nP] = r; C[nP + 1] = g; C[nP + 2] = b;
          } else if (C) { C = grow(C, nP + 3); C[nP] = C[nP + 1] = C[nP + 2] = 1; }
          nP += 3;
        } else if (c1 === 116) { i += 2; T = grow(T, nT + 2); T[nT] = num(); skipSp(); T[nT + 1] = eol() ? 0 : num(); nT += 2; }
        skipLine();
      } else if (c0 === 102 && (u8[i + 1] === 32 || u8[i + 1] === 9)) { // f
        i += 2; poly.length = 0; polyT.length = 0;
        const nv = nP / 3, nt = nT / 2;
        for (;;) {
          skipSp(); if (eol()) break;
          let a = int(); a = a > 0 ? a - 1 : nv + a; let t = -1;
          if (u8[i] === 47) { i++; if (u8[i] !== 47) { t = int(); t = t > 0 ? t - 1 : nt + t; } if (u8[i] === 47) { i++; int(); } }
          poly.push(a); polyT.push(t);
          while (i < n && u8[i] !== 32 && u8[i] !== 9 && !eol()) i++;
        }
        for (let k = 1; k + 1 < poly.length; k++) {
          FV = grow(FV, nF * 3 + 3); FT = grow(FT, nF * 3 + 3); FM = grow(FM, nF + 1);
          FV[nF * 3] = poly[0]; FV[nF * 3 + 1] = poly[k]; FV[nF * 3 + 2] = poly[k + 1];
          FT[nF * 3] = polyT[0]; FT[nF * 3 + 1] = polyT[k]; FT[nF * 3 + 2] = polyT[k + 1];
          FM[nF] = curMat; nF++;
        }
        skipLine();
      } else if (c0 === 117 && u8[i + 1] === 115) { // usemtl
        i += 6; const nm = rest();
        if (!(nm in matIdx)) { matIdx[nm] = matNames.length; matNames.push(nm); }
        curMat = matIdx[nm]; skipLine();
      } else if (c0 === 109 && u8[i + 1] === 116) { // mtllib
        i += 6; mtllibs.push(rest()); skipLine();
      } else skipLine();
      i++;
    }
    if (onProg) onProg(1);
    let vc = C ? C.slice(0, nP) : null;
    if (vc) { let mx = 0; for (let k = 0; k < vc.length; k++) if (vc[k] > mx) mx = vc[k]; if (mx > 1) for (let k = 0; k < vc.length; k++) vc[k] /= 255; }
    return { pos: P.slice(0, nP), uv: T.slice(0, nT), fv: FV.slice(0, nF * 3), ft: FT.slice(0, nF * 3), fm: FM.slice(0, nF),
      vcol: vc, nV: nP / 3, nF, matNames, mtllibs };
  }

  function parseMTL(text) {
    const mats = {}; let cur = null;
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim(); if (!t || t[0] === '#') continue;
      const sp = t.split(/\s+/), k = sp[0];
      if (k === 'newmtl') { cur = t.slice(7).trim(); mats[cur] = { kd: [0.8, 0.8, 0.8], map: null }; }
      else if (!cur) continue;
      else if (k === 'Kd' && sp.length >= 4) mats[cur].kd = sp.slice(1, 4).map(Number);
      else if (k === 'map_Kd') {
        // ignora opções tipo "-s 1 1 1"; o nome do arquivo é o fim da linha
        let r = t.slice(6).trim();
        while (r.startsWith('-')) { const p = r.split(/\s+/); const nArgs = { '-s': 3, '-o': 3, '-t': 3, '-mm': 2 }[p[0]] ?? 1; r = p.slice(1 + nArgs).join(' '); }
        mats[cur].map = r.replace(/\\/g, '/').split('/').pop();
      }
    }
    return mats;
  }

  // ---------- cor ----------
  const LIN = new Float32Array(256);
  for (let k = 0; k < 256; k++) { const c = k / 255; LIN[k] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const fLab = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  function rgb8ToLab(r, g, b, out, o) {
    const R = LIN[r], G = LIN[g], B = LIN[b];
    const x = fLab((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), y = fLab(0.2126 * R + 0.7152 * G + 0.0722 * B), z = fLab((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
    out[o] = 116 * y - 16; out[o + 1] = 500 * (x - y); out[o + 2] = 200 * (y - z);
  }
  const hex = rgb => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
  const hexToRgb = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));

  const NOMES = [['branco', [245, 245, 245]], ['preto', [20, 20, 20]], ['cinza', [128, 128, 128]], ['vermelho', [200, 25, 30]],
    ['vinho', [110, 20, 30]], ['laranja', [240, 120, 20]], ['amarelo', [245, 215, 40]], ['dourado', [200, 150, 50]],
    ['verde', [40, 150, 60]], ['verde-escuro', [20, 80, 40]], ['azul', [30, 80, 200]], ['azul-claro', [100, 170, 240]],
    ['roxo', [120, 50, 160]], ['rosa', [240, 140, 170]], ['marrom', [110, 65, 30]], ['bege', [225, 200, 160]], ['pele', [235, 180, 150]], ['pele', [160, 122, 108]], ['pele', [120, 80, 60]]];
  const NOMES_LAB = NOMES.map(([n, c]) => { const o = new Float32Array(3); rgb8ToLab(c[0], c[1], c[2], o, 0); return [n, o]; });
  function nomeCor(rgb) {
    const o = new Float32Array(3); rgb8ToLab(Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2]), o, 0);
    let best = '', bd = 1e9;
    for (const [n, l] of NOMES_LAB) { const d = (l[0] - o[0]) ** 2 + (l[1] - o[1]) ** 2 + (l[2] - o[2]) ** 2; if (d < bd) { bd = d; best = n; } }
    return best;
  }

  // tex: {w,h,data(RGBA Uint8)}; texByMat[matIndex] = tex | null; kdByMat[matIndex]=[r,g,b] 0..1
  async function faceColors(m, texByMat, kdByMat, onProg) {
    const { nF, fv, ft, fm, uv, pos, vcol } = m;
    const rgb = new Uint8Array(nF * 3), lab = new Float32Array(nF * 3), area = new Float32Array(nF);
    for (let f = 0; f < nF; f++) {
      if ((f & 0x3ffff) === 0 && f) { if (onProg) onProg(f / nF); await nextTick(); }
      const a = fv[f * 3], b = fv[f * 3 + 1], c = fv[f * 3 + 2];
      const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      area[f] = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
      let r, g, bl;
      const tex = texByMat[fm[f]];
      const t0 = ft[f * 3], t1 = ft[f * 3 + 1], t2 = ft[f * 3 + 2];
      if (tex && t0 >= 0 && t1 >= 0 && t2 >= 0) {
        let u = (uv[t0 * 2] + uv[t1 * 2] + uv[t2 * 2]) / 3, v = (uv[t0 * 2 + 1] + uv[t1 * 2 + 1] + uv[t2 * 2 + 1]) / 3;
        if (u < 0 || u > 1) u -= Math.floor(u); if (v < 0 || v > 1) v -= Math.floor(v);
        const x = Math.min(tex.w - 1, (u * tex.w) | 0), y = Math.min(tex.h - 1, ((1 - v) * tex.h) | 0);
        const p = (y * tex.w + x) * 4;
        r = tex.data[p]; g = tex.data[p + 1]; bl = tex.data[p + 2];
      } else if (vcol) {
        r = (vcol[a * 3] + vcol[b * 3] + vcol[c * 3]) * 85; g = (vcol[a * 3 + 1] + vcol[b * 3 + 1] + vcol[c * 3 + 1]) * 85; bl = (vcol[a * 3 + 2] + vcol[b * 3 + 2] + vcol[c * 3 + 2]) * 85;
      } else {
        const kd = kdByMat[fm[f]] || [0.8, 0.8, 0.8]; r = kd[0] * 255; g = kd[1] * 255; bl = kd[2] * 255;
      }
      r = Math.round(r); g = Math.round(g); bl = Math.round(bl);
      rgb[f * 3] = r; rgb[f * 3 + 1] = g; rgb[f * 3 + 2] = bl;
      rgb8ToLab(r, g, bl, lab, f * 3);
    }
    return { rgb, lab, area };
  }

  // ---------- agrupamento ----------
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }
  let LW = 0.7; // peso da claridade: sombras do tecido pesam menos que a tonalidade
  const setLightWeight = w => { LW = w; };
  const dist = (L, o, C, c) => { const d0 = (L[o] - C[c]) * LW, d1 = L[o + 1] - C[c + 1], d2 = L[o + 2] - C[c + 2]; return d0 * d0 + d1 * d1 + d2 * d2; };

  function kmeans(lab, area, nF, k) {
    const R = rng(12345), S = Math.min(nF, 120000);
    const idx = new Uint32Array(S); for (let s = 0; s < S; s++) idx[s] = S === nF ? s : (R() * nF) | 0;
    const X = new Float32Array(S * 3), W = new Float32Array(S);
    for (let s = 0; s < S; s++) { X.set(lab.subarray(idx[s] * 3, idx[s] * 3 + 3), s * 3); W[s] = area[idx[s]] + 1e-12; }
    const C = new Float32Array(k * 3);
    // k-means++
    let pick = 0, tot = 0; for (let s = 0; s < S; s++) tot += W[s];
    let r = R() * tot; for (let s = 0; s < S; s++) { r -= W[s]; if (r <= 0) { pick = s; break; } }
    C.set(X.subarray(pick * 3, pick * 3 + 3), 0);
    const D = new Float32Array(S).fill(1e30);
    let kk = 1;
    for (; kk < k; kk++) {
      let sum = 0;
      for (let s = 0; s < S; s++) { const d = dist(X, s * 3, C, (kk - 1) * 3); if (d < D[s]) D[s] = d; sum += D[s] * W[s]; }
      if (sum <= 0) break;
      let r2 = R() * sum, p = S - 1; for (let s = 0; s < S; s++) { r2 -= D[s] * W[s]; if (r2 <= 0) { p = s; break; } }
      C.set(X.subarray(p * 3, p * 3 + 3), kk * 3);
    }
    k = kk;
    const lbl = new Uint8Array(S), acc = new Float64Array(k * 4);
    for (let it = 0; it < 40; it++) {
      acc.fill(0);
      for (let s = 0; s < S; s++) {
        let b = 0, bd = 1e30; for (let j = 0; j < k; j++) { const d = dist(X, s * 3, C, j * 3); if (d < bd) { bd = d; b = j; } }
        lbl[s] = b; const w = W[s]; acc[b * 4] += X[s * 3] * w; acc[b * 4 + 1] += X[s * 3 + 1] * w; acc[b * 4 + 2] += X[s * 3 + 2] * w; acc[b * 4 + 3] += w;
      }
      let mv = 0;
      for (let j = 0; j < k; j++) if (acc[j * 4 + 3] > 0) for (let q = 0; q < 3; q++) { const nv = acc[j * 4 + q] / acc[j * 4 + 3]; mv = Math.max(mv, Math.abs(nv - C[j * 3 + q])); C[j * 3 + q] = nv; }
      if (mv < 0.05) break;
    }
    return C.subarray(0, k * 3);
  }

  // paleta final: agrupa em 2k tons e junta os pares mais parecidos até sobrar k.
  // Tons do mesmo tecido (vermelho e vermelho na sombra) se juntam antes de uma cor pequena e diferente (pele) sumir.
  function palette(lab, area, nF, k) {
    const C = Array.from(kmeans(lab, area, nF, Math.min(2 * k, 24)));
    let m = C.length / 3;
    const lbl = assign(lab, nF, Float32Array.from(C));
    const w = new Float64Array(m); for (let f = 0; f < nF; f++) w[lbl[f]] += area[f];
    const cs = []; for (let j = 0; j < m; j++) if (w[j] > 0) cs.push({ c: C.slice(j * 3, j * 3 + 3), w: w[j] });
    const dd = (a, b) => ((a[0] - b[0]) * LW) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    while (cs.length > k) {
      let bi = 0, bj = 1, bd = 1e30;
      for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) { const d = dd(cs[i].c, cs[j].c); if (d < bd) { bd = d; bi = i; bj = j; } }
      const A = cs[bi], B = cs[bj], W = A.w + B.w;
      A.c = A.c.map((v, q) => (v * A.w + B.c[q] * B.w) / W); A.w = W; cs.splice(bj, 1);
    }
    cs.sort((a, b) => b.w - a.w);
    return Float32Array.from(cs.flatMap(x => x.c));
  }

  // sugere qual filamento cada tom usa.
  // 1) sombra: tom mais escuro com mesma tonalidade e saturação parecida vai para o tom claro;
  // 2) depois junta os tons mais parecidos até sobrar nFil filamentos.
  // toneLab: Float32Array (t*3); share: fração da área de cada tom
  function suggestFilaments(toneLab, share, nFil) {
    const t = share.length;
    const L = j => toneLab[j * 3], A = j => toneLab[j * 3 + 1], Bv = j => toneLab[j * 3 + 2];
    const C = j => Math.hypot(A(j), Bv(j)), H = j => Math.atan2(Bv(j), A(j)) * 180 / Math.PI;
    const sat = j => C(j) / Math.max(L(j), 4);
    const parent = Array.from({ length: t }, (_, j) => j);
    const root = j => { while (parent[j] !== j) j = parent[j]; return j; };
    // passo 1: sombras
    const order = [...Array(t).keys()].sort((a, b) => L(a) - L(b)); // do mais escuro pro mais claro
    for (const i of order) {
      if (C(i) < 12) continue;
      let best = -1, bs = 1e9;
      for (let j = 0; j < t; j++) {
        if (j === i || root(j) === root(i) || L(j) <= L(i) + 3 || C(j) < 12) continue;
        let dh = Math.abs(H(i) - H(j)); if (dh > 180) dh = 360 - dh;
        const r = Math.max(sat(i), sat(j)) / Math.max(1e-6, Math.min(sat(i), sat(j)));
        if (dh < 15 && r < 1.8 && dh + (r - 1) * 20 < bs) { bs = dh + (r - 1) * 20; best = j; }
      }
      if (best >= 0) parent[root(i)] = root(best);
    }
    // passo 2: junta grupos mais parecidos (pela cor do tom dominante) até nFil
    const groups = () => { const g = new Map(); for (let j = 0; j < t; j++) { const r = root(j); if (!g.has(r)) g.set(r, []); g.get(r).push(j); } return [...g.values()]; };
    const rep = g => g.reduce((a, b) => share[a] >= share[b] ? a : b);
    const dd = (a, b) => (L(a) - L(b)) ** 2 + (A(a) - A(b)) ** 2 + (Bv(a) - Bv(b)) ** 2; // sombras já foram resolvidas no passo 1
    let gs = groups();
    while (gs.length > nFil) {
      let bi = 0, bj = 1, bd = 1e30;
      for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) { const d = dd(rep(gs[i]), rep(gs[j])); if (d < bd) { bd = d; bi = i; bj = j; } }
      parent[root(rep(gs[bj]))] = root(rep(gs[bi])); gs = groups();
    }
    // ordena filamentos pela área total; devolve tom -> filamento e o tom que dá a cor de cada filamento
    gs.sort((x, y) => y.reduce((s, j) => s + share[j], 0) - x.reduce((s, j) => s + share[j], 0));
    const map = new Array(t).fill(0); gs.forEach((g, fi) => g.forEach(j => { map[j] = fi; }));
    // cor do filamento = o tom "de verdade" do grupo, não o mais frequente (que costuma ser o já sombreado pela textura):
    // o mais claro entre os tons que têm pelo menos 30% da área do maior.
    const albedo = g => { const mx = Math.max(...g.map(j => share[j])); return g.filter(j => share[j] >= 0.3 * mx).reduce((a, b) => L(a) >= L(b) ? a : b); };
    return { map, repTone: gs.map(albedo) };
  }

  function assign(lab, nF, centers) {
    const k = centers.length / 3, lbl = new Uint8Array(nF);
    for (let f = 0; f < nF; f++) { let b = 0, bd = 1e30; for (let j = 0; j < k; j++) { const d = dist(lab, f * 3, centers, j * 3); if (d < bd) { bd = d; b = j; } } lbl[f] = b; }
    return lbl;
  }

  // cor média (sRGB, ponderada por área) de cada grupo
  function groupColors(rgb, area, lbl, k) {
    const acc = new Float64Array(k * 4);
    for (let f = 0; f < lbl.length; f++) { const j = lbl[f], w = area[f] + 1e-12; acc[j * 4] += rgb[f * 3] * w; acc[j * 4 + 1] += rgb[f * 3 + 1] * w; acc[j * 4 + 2] += rgb[f * 3 + 2] * w; acc[j * 4 + 3] += w; }
    const out = [], share = []; let tot = 0; for (let j = 0; j < k; j++) tot += acc[j * 4 + 3];
    for (let j = 0; j < k; j++) { const w = acc[j * 4 + 3] || 1; out.push([acc[j * 4] / w, acc[j * 4 + 1] / w, acc[j * 4 + 2] / w]); share.push(acc[j * 4 + 3] / tot); }
    return { colors: out, share };
  }

  // ---------- vizinhança por aresta ----------
  function buildNeighbors(m) {
    const { nF, fv, nV } = m;
    let size = 1; while (size < nF * 3) size <<= 1; size <<= 1;
    const mask = size - 1, keys = new Float64Array(size).fill(-1), vals = new Int32Array(size);
    const nb = new Int32Array(nF * 3).fill(-1);
    for (let f = 0; f < nF; f++) for (let e = 0; e < 3; e++) {
      let a = fv[f * 3 + e], b = fv[f * 3 + (e + 1) % 3]; if (a > b) { const t = a; a = b; b = t; }
      const key = a * nV + b;
      let h = (Math.imul(a, 0x9E3779B1) ^ Math.imul(b, 0x85EBCA77)) & mask;
      for (;;) {
        const kv = keys[h];
        if (kv === -1) { keys[h] = key; vals[h] = f * 3 + e; break; }
        if (kv === key) { const o = vals[h]; if (o >= 0) { nb[f * 3 + e] = (o / 3) | 0; nb[o] = f; vals[h] = -2; } break; } // aresta com 3+ faces: ignora as extras
        h = (h + 1) & mask;
      }
    }
    return nb;
  }

  // tira manchas: (1) filtro de maioria; (2) regiões menores que minArea viram a cor vizinha dominante
  function cleanLabels(lblIn, nb, area, k, passes, minArea) {
    const nF = lblIn.length; let lbl = lblIn.slice();
    for (let p = 0; p < passes; p++) {
      const out = lbl.slice(); let ch = 0;
      for (let f = 0; f < nF; f++) {
        const me = lbl[f]; let same = 0; const c = [-1, -1, -1];
        for (let e = 0; e < 3; e++) { const g = nb[f * 3 + e]; if (g < 0) continue; c[e] = lbl[g]; if (lbl[g] === me) same++; }
        if (same >= 2) continue;
        let best = -1, bc = 0;
        for (let e = 0; e < 3; e++) { if (c[e] < 0 || c[e] === me) continue; let n = 0; for (let q = 0; q < 3; q++) if (c[q] === c[e]) n++; if (n > bc) { bc = n; best = c[e]; } }
        if (best >= 0 && (same === 0 || bc >= 2)) { out[f] = best; ch++; }
      }
      lbl = out; if (!ch) break;
    }
    if (minArea > 0) {
      for (let rep = 0; rep < 3; rep++) {
        const comp = new Int32Array(nF).fill(-1), queue = new Int32Array(nF); let changed = 0;
        const border = new Float64Array(k);
        for (let s = 0; s < nF; s++) {
          if (comp[s] >= 0) continue;
          const me = lbl[s]; let qh = 0, qt = 0, A = 0; queue[qt++] = s; comp[s] = s; border.fill(0);
          while (qh < qt) {
            const f = queue[qh++]; A += area[f];
            for (let e = 0; e < 3; e++) { const g = nb[f * 3 + e]; if (g < 0) continue; if (lbl[g] === me) { if (comp[g] < 0) { comp[g] = s; queue[qt++] = g; } } else border[lbl[g]] += area[g]; }
          }
          if (A < minArea) {
            let b = -1, bw = 0; for (let j = 0; j < k; j++) if (border[j] > bw) { bw = border[j]; b = j; }
            if (b >= 0) { for (let q = 0; q < qt; q++) lbl[queue[q]] = b; changed++; }
          }
        }
        if (!changed) break;
      }
    }
    return lbl;
  }

  // ---------- transformação e 3MF ----------
  // Y-pra-cima -> Z-pra-cima, escala para a altura (mm) e centraliza na mesa
  function placement(m, { yUp = true, heightMm = 100, bed = [128, 128] }) {
    const p = m.pos, n = m.nV; let mn = [1e30, 1e30, 1e30], mx = [-1e30, -1e30, -1e30];
    const tr = (x, y, z) => yUp ? [x, -z, y] : [x, y, z];
    for (let v = 0; v < n; v++) { const q = tr(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]); for (let a = 0; a < 3; a++) { if (q[a] < mn[a]) mn[a] = q[a]; if (q[a] > mx[a]) mx[a] = q[a]; } }
    const s = heightMm / Math.max(mx[2] - mn[2], 1e-9);
    const off = [bed[0] - (mn[0] + mx[0]) / 2 * s, bed[1] - (mn[1] + mx[1]) / 2 * s, -mn[2] * s];
    return { s, off, tr, size: [(mx[0] - mn[0]) * s, (mx[1] - mn[1]) * s, (mx[2] - mn[2]) * s] };
  }

  // estado do pintor (extrusor N) no formato do Bambu Studio/OrcaSlicer: 1->"4", 2->"8", 3->"0C", 4->"1C"...
  function paintCode(ext) {
    if (ext <= 0) return '';
    if (ext === 1) return '4'; if (ext === 2) return '8';
    let rest = ext - 3, s = 'C';
    while (rest >= 15) { s = 'F' + s; rest -= 15; }
    return rest.toString(16).toUpperCase() + s;
  }

  // ---------- projeto Bambu Studio ----------
  // tpl = { config, filamentKeys } (cli/modelo/<impressora>.json: project_settings já achatado, com 1 filamento).
  // Expande para N filamentos. Uma lista de tamanho errado faz o Bambu recusar o projeto ("configuração inválida").
  const BAMBU_APP = 'BambuStudio-02.08.02.61';
  function bambuSettings(tpl, hexes) {
    const N = hexes.length, cfg = { ...tpl.config };
    const per = new Set([...(tpl.filamentKeys || []), 'filament_colour', 'filament_type', 'filament_ids', 'default_filament_colour',
      ...Object.keys(cfg).filter(k => k.startsWith('filament_'))]);
    for (const k of per) {
      if (!Array.isArray(cfg[k]) || /^compatible_/.test(k)) continue;
      if (cfg[k].length > 1) continue; // lista própria (ex.: compatible_printers), não é uma entrada por filamento
      const v = cfg[k].length ? cfg[k][0] : '';
      cfg[k] = Array.from({ length: N }, () => v);
    }
    cfg.filament_colour = hexes.slice();
    cfg.filament_settings_id = Array.from({ length: N }, () => (tpl.filamento || ''));
    cfg.filament_self_index = Array.from({ length: N }, (_, i) => String(i + 1));
    cfg.filament_ids = Array.from({ length: N }, () => '');
    const mat = []; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) mat.push(i === j ? '0' : '280');
    cfg.flush_volumes_matrix = mat;
    cfg.flush_volumes_vector = Array.from({ length: 2 * N }, () => '140');
    cfg.flush_multiplier = ['1'];
    cfg.different_settings_to_system = Array.from({ length: N + 2 }, () => '');
    cfg.inherits_group = Array.from({ length: N + 2 }, () => '');
    return cfg;
  }

  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';
  const NS_MODEL = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p"';

  // gera os arquivos do 3MF em pedaços (para não estourar a memória com modelos grandes)
  async function* threeMFParts(m, slotOfFace, filamentHex, opts, onProg) {
    const enc = new TextEncoder();
    const pl = placement(m, opts);
    const name = (opts.name || 'modelo').replace(/[<>&"]/g, '');
    const B = opts.bambu || null; // { settings } -> layout de projeto do Bambu Studio
    const tx = B ? [opts.bed[0], opts.bed[1], pl.size[2] / 2] : [0, 0, 0]; // no projeto Bambu a malha fica centrada na origem e o item leva a translação
    if (B) {
      const cfg = B.settings, esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      yield ['[Content_Types].xml', enc.encode(XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n <Default Extension="png" ContentType="image/png"/>\n <Default Extension="gcode" ContentType="text/x.gcode"/>\n</Types>')];
      yield ['_rels/.rels', enc.encode(XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>')];
      const date = new Date().toISOString().slice(0, 10);
      yield ['3D/3dmodel.model', enc.encode(`${XML_HEAD}<model unit="millimeter" xml:lang="en-US" ${NS_MODEL}>\n <metadata name="Application">${B.app || BAMBU_APP}</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <metadata name="CreationDate">${date}</metadata>\n <metadata name="ModificationDate">${date}</metadata>\n <metadata name="Title">${name}</metadata>\n <resources>\n  <object id="2" p:UUID="00000001-61cb-4c03-9d28-80fed5dfa1dc" type="model">\n   <components>\n    <component p:path="/3D/Objects/object_1.model" objectid="1" p:UUID="00010000-b206-40ff-9872-83e8017abed1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>\n   </components>\n  </object>\n </resources>\n <build p:UUID="2c7c17d8-22b5-4d84-8835-1976022ea369">\n  <item objectid="2" p:UUID="00000002-b1ec-4553-aec9-835e5b724bb4" transform="1 0 0 0 1 0 0 0 1 ${tx.map(v => +v.toFixed(5)).join(' ')}" printable="1"/>\n </build>\n</model>\n`)];
      yield ['3D/_rels/3dmodel.model.rels', enc.encode(XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/Objects/object_1.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>')];
      yield ['Metadata/project_settings.config', enc.encode(JSON.stringify(cfg, null, 4))];
      yield ['Metadata/model_settings.config', enc.encode(`${XML_HEAD}<config>\n  <object id="2">\n    <metadata key="name" value="${esc(name)}"/>\n    <metadata key="extruder" value="1"/>\n    <metadata face_count="${m.nF}"/>\n    <part id="1" subtype="normal_part" uuid="db717b5b-b26c-41e2-a26b-1d8b2463b8c4">\n      <metadata key="name" value="${esc(name)}"/>\n      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n      <mesh_stat face_count="${m.nF}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>\n    </part>\n  </object>\n  <plate>\n    <metadata key="plater_id" value="1"/>\n    <metadata key="plater_name" value=""/>\n    <metadata key="locked" value="false"/>\n    <metadata key="filament_map_mode" value="Auto For Flush"/>\n    <metadata key="gcode_file" value=""/>\n    <model_instance>\n      <metadata key="object_id" value="2"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="8"/>\n    </model_instance>\n  </plate>\n  <assemble>\n  </assemble>\n</config>\n`)];
      yield ['Metadata/slice_info.config', enc.encode(`${XML_HEAD}<config>\n  <header>\n    <header_item key="X-BBL-Client-Type" value="slicer"/>\n    <header_item key="X-BBL-Client-Version" value="${(B.app || BAMBU_APP).replace('BambuStudio-', '')}"/>\n  </header>\n</config>\n`)];
      yield ['Metadata/cut_information.xml', enc.encode('<?xml version="1.0" encoding="utf-8"?>\n<objects>\n <object id="1">\n  <cut_id id="0" check_sum="1" connectors_cnt="0"/>\n </object>\n</objects>\n')];
      yield ['Metadata/filament_sequence.json', enc.encode('{"plate_1":{"nozzle_sequence":[],"optimal_assignment":[],"sequence":[]}}')];
    } else {
    yield ['[Content_Types].xml', enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="application/xml"/></Types>')];
    yield ['_rels/.rels', enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')];
    // Sem `opts.bambu` não há arquivos de configuração: uma configuração incompleta faz o Bambu Studio recusar o projeto
    // ("configuração inválida"), e sem N filamentos no projeto ele pinta tudo com o filamento 1.
    }
    // modelo principal: vários pedaços
    const head = B
      ? `${XML_HEAD}<model unit="millimeter" xml:lang="en-US" ${NS_MODEL}>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n  <object id="1" p:UUID="00010000-81cb-4c03-9d28-80fed5dfa1dc" type="model">\n   <mesh>\n    <vertices>\n`
      : `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n <metadata name="Application">Pinta3MF</metadata>\n <metadata name="Title">${name}</metadata>\n <resources>\n  <object id="1" type="model" name="${name}">\n   <mesh>\n    <vertices>\n`;
    const chunks = [enc.encode(head)];
    const { s, off, tr } = pl, p = m.pos;
    const total = m.nV + m.nF; let done = 0;
    const BATCH = 40000; let str = '';
    for (let v = 0; v < m.nV; v++) {
      const q = tr(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
      str += `     <vertex x="${(q[0] * s + off[0] - tx[0]).toFixed(4)}" y="${(q[1] * s + off[1] - tx[1]).toFixed(4)}" z="${(q[2] * s + off[2] - tx[2]).toFixed(4)}"/>\n`;
      if ((v + 1) % BATCH === 0) { chunks.push(enc.encode(str)); str = ''; done += BATCH; if (onProg) onProg(done / total); if (chunks.length > 8) { yield [null, chunks.splice(0)]; await nextTick(); } }
    }
    str += '    </vertices>\n    <triangles>\n';
    const codes = filamentHex.map((_, j) => paintCode(j + 1));
    const fv = m.fv;
    for (let f = 0; f < m.nF; f++) {
      const a = fv[f * 3], b = fv[f * 3 + 1], c = fv[f * 3 + 2];
      if (a !== b && b !== c && a !== c) str += `     <triangle v1="${a}" v2="${b}" v3="${c}" paint_color="${codes[slotOfFace[f]]}"/>\n`;
      if ((f + 1) % BATCH === 0) { chunks.push(enc.encode(str)); str = ''; if (onProg) onProg((m.nV + f) / total); if (chunks.length > 8) { yield [null, chunks.splice(0)]; await nextTick(); } }
    }
    str += B
      ? `    </triangles>\n   </mesh>\n  </object>\n </resources>\n <build/>\n</model>\n`
      : `    </triangles>\n   </mesh>\n  </object>\n </resources>\n <build>\n  <item objectid="1" printable="1"/>\n </build>\n</model>\n`;
    chunks.push(enc.encode(str));
    yield [null, chunks, true];
  }

  // ---------- ZIP com a compressão nativa do navegador (CompressionStream) ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8, crc = 0) { crc = ~crc; for (let i = 0; i < u8.length; i++) crc = CRC[(crc ^ u8[i]) & 255] ^ (crc >>> 8); return ~crc >>> 0; }

  async function unzip(u8, keep) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let e = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('O .zip parece corrompido (não achei o índice do arquivo).');
    let count = dv.getUint16(e + 10, true), cdOff = dv.getUint32(e + 16, true);
    if (cdOff === 0xFFFFFFFF) throw new Error('Esse .zip usa o formato ZIP64 (maior que 4 GB). Descompacte e envie os arquivos soltos.');
    const out = {}, td = new TextDecoder(), lat = new TextDecoder('latin1');
    let p = cdOff;
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const nameB = u8.subarray(p + 46, p + 46 + nl), name = (flags & 0x800 ? td : lat).decode(nameB);
      p += 46 + nl + xl + cl;
      if (name.endsWith('/') || !keep(name)) continue;
      const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
      const data = u8.subarray(start, start + csize);
      if (method === 0) out[name] = data.slice();
      else if (method === 8) out[name] = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      else throw new Error(`O arquivo ${name} usa uma compressão que não consigo abrir (método ${method}). Recompacte o .zip no modo normal.`);
    }
    return out;
  }

  class ZipWriter {
    constructor() { this.parts = []; this.cd = []; this.off = 0; this.enc = new TextEncoder(); }
    async add(name, chunks) { // chunks: Uint8Array | iterável (async) de Uint8Array
      const cs = new CompressionStream('deflate-raw'), w = cs.writable.getWriter(), r = cs.readable.getReader(), comp = [];
      const reading = (async () => { let n = 0; for (;;) { const { value, done } = await r.read(); if (done) return n; comp.push(value); n += value.length; } })();
      let crc = 0, usize = 0;
      const feed = async c => { crc = crc32(c, crc); usize += c.length; await w.write(c); };
      if (chunks instanceof Uint8Array) await feed(chunks); else for await (const c of chunks) await feed(c);
      await w.close(); const csize = await reading;
      const nm = this.enc.encode(name), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(8, 8, true);
      h.setUint32(14, crc, true); h.setUint32(18, csize, true); h.setUint32(22, usize, true); h.setUint16(26, nm.length, true);
      this.parts.push(new Uint8Array(h.buffer), nm, ...comp);
      this.cd.push({ nm, crc, csize, usize, off: this.off });
      this.off += 30 + nm.length + csize;
    }
    finish(type) {
      let size = 0; const start = this.off;
      for (const c of this.cd) {
        const h = new DataView(new ArrayBuffer(46));
        h.setUint32(0, 0x02014b50, true); h.setUint16(4, 20, true); h.setUint16(6, 20, true); h.setUint16(8, 0x800, true); h.setUint16(10, 8, true);
        h.setUint32(16, c.crc, true); h.setUint32(20, c.csize, true); h.setUint32(24, c.usize, true); h.setUint16(28, c.nm.length, true); h.setUint32(42, c.off, true);
        this.parts.push(new Uint8Array(h.buffer), c.nm); size += 46 + c.nm.length;
      }
      const e = new DataView(new ArrayBuffer(22));
      e.setUint32(0, 0x06054b50, true); e.setUint16(8, this.cd.length, true); e.setUint16(10, this.cd.length, true); e.setUint32(12, size, true); e.setUint32(16, start, true);
      this.parts.push(new Uint8Array(e.buffer));
      return new Blob(this.parts, { type });
    }
  }

  async function make3MF(m, slotOfFace, filamentHex, opts, onProg) {
    const z = new ZipWriter();
    let modelQueue = null;
    const gen = threeMFParts(m, slotOfFace, filamentHex, opts, onProg);
    // arquivos pequenos primeiro; o modelo vem em pedaços
    const first = [];
    let it;
    while (!(it = await gen.next()).done) { const [name, data] = it.value; if (name) first.push([name, data]); else { modelQueue = data; break; } }
    for (const [n, d] of first) await z.add(n, d);
    await z.add(opts.bambu ? '3D/Objects/object_1.model' : '3D/3dmodel.model', (async function* () {
      for (const c of modelQueue) yield c;
      while (!(it = await gen.next()).done) for (const c of it.value[1]) yield c;
    })());
    return z.finish('application/vnd.ms-package.3dmanufacturing-3dmodel+xml');
  }

  return { crc32, unzip, ZipWriter, make3MF, setLightWeight, parseOBJ, parseMTL, faceColors, kmeans, palette, suggestFilaments, assign, groupColors, buildNeighbors, cleanLabels, placement, paintCode, threeMFParts, bambuSettings, hex, hexToRgb, nomeCor, rgb8ToLab };
})();
if (typeof module !== 'undefined') module.exports = Core;
