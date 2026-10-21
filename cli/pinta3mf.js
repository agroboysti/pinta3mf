#!/usr/bin/env node
// Pinta3MF em linha de comando: OBJ com textura (.zip ou .obj) -> .3mf pintado para Bambu Studio / OrcaSlicer.
// Usa o mesmo núcleo do site (web/core.js). Node 18+.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const Core = require('../web/core.js');

const AJUDA = `Pinta3MF — gera um 3MF pintado a partir de um modelo OBJ com textura.

Uso:  pinta3mf <modelo.zip | modelo.obj | pasta> [mais modelos ou pastas...] [opções]
      Com uma pasta, pinta todos os .zip e .obj dela e grava os .3mf na subpasta "pintados".

Opções:
  -f, --filamentos N   quantidade de filamentos/cores (padrão 5)
  -t, --tons N         quantidade de tons detectados antes de juntar (padrão 12)
  -a, --altura MM      altura final do modelo em mm (padrão 100)
  -i, --impressora ID  perfil do Bambu Studio: a1 (padrão), a1-mini, p1s, ou "nenhuma" (3MF só com geometria e pintura)
  -m, --mesa MM[,MM]   tamanho da mesa, para centralizar e avisar se não cabe (padrão: a do perfil)
  -l, --limpeza MM2    remove manchas menores que isso em mm² (padrão 4)
  -o, --saida ARQ      arquivo de saída (padrão: <nome>_pintado.3mf ao lado do modelo)
      --deitado        o modelo NÃO vem com Y para cima (não gira para Z para cima)
      --abrir          abre o resultado no programa associado a .3mf (Bambu Studio)
  -h, --ajuda          mostra esta ajuda`;

function lerArgs(argv) {
  const o = { filamentos: 5, tons: 12, altura: 100, mesa: null, impressora: 'a1', limpeza: 4, yUp: true, abrir: false, entradas: [], saida: null };
  const need = (i, n) => { if (i + 1 >= argv.length) throw new Error(`Falta o valor depois de ${n}.`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--ajuda' || a === '--help') { o.ajuda = true; }
    else if (a === '-f' || a === '--filamentos') o.filamentos = +need(i++, a);
    else if (a === '-t' || a === '--tons') o.tons = +need(i++, a);
    else if (a === '-a' || a === '--altura') o.altura = +need(i++, a);
    else if (a === '-i' || a === '--impressora') o.impressora = need(i++, a).toLowerCase();
    else if (a === '-m' || a === '--mesa') { const p = need(i++, a).split(/[,x]/).map(Number); o.mesa = [p[0], p[1] || p[0]]; }
    else if (a === '-l' || a === '--limpeza') o.limpeza = +need(i++, a);
    else if (a === '-o' || a === '--saida') o.saida = need(i++, a);
    else if (a === '--deitado') o.yUp = false;
    else if (a === '--abrir') o.abrir = true;
    else if (a.startsWith('-')) throw new Error(`Opção desconhecida: ${a}`);
    else o.entradas.push(a);
  }
  for (const [k, v] of [['filamentos', o.filamentos], ['tons', o.tons], ['altura', o.altura], ['limpeza', o.limpeza]])
    if (!Number.isFinite(v) || v < 0) throw new Error(`Valor inválido em --${k}.`);
  o.filamentos = Math.max(1, Math.min(16, Math.round(o.filamentos)));
  o.tons = Math.max(o.filamentos, Math.min(24, Math.round(o.tons)));
  return o;
}

const IMG = /\.(png|jpe?g|webp|bmp)$/i;
const SEM_COR = /normal|rough|metal|spec|height|bump|_ao|occlusion|emiss/i;
const base = n => n.replace(/\\/g, '/').split('/').pop().toLowerCase();

let ultimaLinha = 0;
function log(msg) { process.stdout.write(msg + '\n'); }
function progresso(texto, frac) {
  const agora = Date.now();
  if (agora - ultimaLinha < 400 && frac < 1) return;
  ultimaLinha = agora;
  process.stdout.write(`\r${texto} ${Math.round(frac * 100)}%   `);
}
function fimProgresso() { process.stdout.write('\r' + ' '.repeat(60) + '\r'); }

async function decodificarTextura(buf) {
  const sharp = require('sharp');
  const { data, info } = await sharp(buf, { limitInputPixels: false })
    .resize(4096, 4096, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data };
}

async function carregarArquivos(entrada) {
  const files = new Map(); let nome;
  const ext = path.extname(entrada).toLowerCase();
  if (ext === '.zip') {
    nome = path.basename(entrada, path.extname(entrada));
    log('Descompactando ' + path.basename(entrada) + '…');
    const u8 = new Uint8Array(fs.readFileSync(entrada));
    const primeiro = await Core.unzip(u8, n => /\.(obj|mtl)$/i.test(n) && !/__MACOSX/.test(n));
    for (const [n, d] of Object.entries(primeiro)) files.set(base(n), d);
    const wanted = new Set();
    for (const [n, d] of files) if (n.endsWith('.mtl')) for (const mt of Object.values(Core.parseMTL(new TextDecoder().decode(d)))) if (mt.map) wanted.add(mt.map.toLowerCase());
    const imgs = await Core.unzip(u8, n => IMG.test(n) && !/__MACOSX/.test(n) && (wanted.has(base(n)) || (!wanted.size && !SEM_COR.test(n))));
    for (const [n, d] of Object.entries(imgs)) files.set(base(n), d);
  } else if (ext === '.obj') {
    nome = path.basename(entrada, ext);
    const dir = path.dirname(entrada);
    files.set(base(entrada), new Uint8Array(fs.readFileSync(entrada)));
    for (const f of fs.readdirSync(dir)) {
      if (/\.mtl$/i.test(f) || (IMG.test(f) && !SEM_COR.test(f))) files.set(f.toLowerCase(), new Uint8Array(fs.readFileSync(path.join(dir, f))));
    }
  } else throw new Error('Envie um arquivo .zip (com o OBJ, MTL e textura) ou um .obj.');
  return { files, nome };
}

function saidaLivre(alvo) {
  if (!fs.existsSync(alvo)) return alvo;
  const { dir, name, ext } = path.parse(alvo);
  for (let i = 2; ; i++) { const p = path.join(dir, `${name} (${i})${ext}`); if (!fs.existsSync(p)) return p; }
}

function carregarModelo(o) {
  let tpl = null;
  if (o.impressora !== 'nenhuma') {
    const dir = path.join(__dirname, 'modelo'), arq = path.join(dir, o.impressora.replace(/[^\w-]/g, '') + '.json');
    if (!fs.existsSync(arq)) {
      const disp = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)) : [];
      throw new Error(`Não conheço a impressora "${o.impressora}". Disponíveis: ${disp.join(', ') || '(nenhuma)'}, nenhuma.`);
    }
    tpl = JSON.parse(fs.readFileSync(arq, 'utf8'));
    if (!o.mesa) {
      const pts = [].concat(tpl.config.printable_area).map(s => s.split('x').map(Number));
      o.mesa = [Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
    }
    log(`Impressora: ${tpl.impressora} (mesa ${o.mesa[0]} × ${o.mesa[1]} mm)`);
  }
  if (!o.mesa) o.mesa = [256, 256];
  return tpl;
}

// pinta um modelo e devolve o caminho do .3mf. pastaSaida: onde gravar (padrão: ao lado do modelo)
async function processar(entrada, o, tpl, pastaSaida) {
  const t0 = Date.now();
  const { files, nome } = await carregarArquivos(entrada);
  const objName = [...files.keys()].find(n => n.endsWith('.obj'));
  if (!objName) throw new Error('Não achei nenhum .obj dentro do arquivo.');

  const m = await Core.parseOBJ(files.get(objName), f => progresso('Lendo o OBJ…', f));
  fimProgresso();
  if (!m.nF) throw new Error('O OBJ não tem triângulos.');
  files.delete(objName);
  log(`OBJ: ${m.nF.toLocaleString('pt-BR')} triângulos, ${m.nV.toLocaleString('pt-BR')} vértices.`);

  // materiais e texturas (mesma lógica do site)
  let mats = {};
  for (const lib of m.mtllibs) { const d = files.get(base(lib)); if (d) mats = { ...mats, ...Core.parseMTL(new TextDecoder().decode(d)) }; }
  if (!Object.keys(mats).length) for (const [n, d] of files) if (n.endsWith('.mtl')) mats = { ...mats, ...Core.parseMTL(new TextDecoder().decode(d)) };
  const imgNames = [...files.keys()].filter(n => IMG.test(n));
  const palpite = imgNames.find(n => /base|albedo|diffuse|color|colour|_d\./i.test(n)) || imgNames.find(n => !SEM_COR.test(n));
  const texCache = new Map(), texByMat = [], kdByMat = [], faltando = [];
  for (const mn of m.matNames) {
    const mt = mats[mn];
    let tn = mt && mt.map ? mt.map.toLowerCase() : null;
    if (tn && !files.has(tn)) { faltando.push(mt.map); tn = null; }
    if (!tn && (!mt || mt.map) && palpite && m.uv.length) tn = palpite;
    if (tn && !texCache.has(tn)) { log('Abrindo a textura ' + tn + '…'); texCache.set(tn, await decodificarTextura(files.get(tn))); }
    texByMat.push(tn ? texCache.get(tn) : null); kdByMat.push(mt ? mt.kd : null);
  }
  if (!texCache.size && !m.vcol) log('AVISO: sem textura nem cor por vértice; só as cores dos materiais (Kd) serão usadas.' + (faltando.length ? ' Faltou: ' + faltando.join(', ') : ''));
  files.clear();

  const fc = await Core.faceColors(m, texByMat, kdByMat, f => progresso('Lendo as cores da textura…', f));
  fimProgresso();
  const nb = Core.buildNeighbors(m);

  log('Detectando os tons…');
  const centers = Core.palette(fc.lab, fc.area, m.nF, o.tons);
  const t = centers.length / 3;
  const toneLbl = Core.assign(fc.lab, m.nF, centers);
  const tg = Core.groupColors(fc.rgb, fc.area, toneLbl, t);
  const nFil = Math.min(o.filamentos, t);
  const sug = Core.suggestFilaments(centers, tg.share, nFil);
  let filRGB = sug.repTone.map(j => tg.colors[j].map(Math.round));

  const opts = { yUp: o.yUp, heightMm: o.altura, bed: [o.mesa[0] / 2, o.mesa[1] / 2], name: nome };
  const pl = Core.placement(m, opts);
  let lbl = new Uint8Array(m.nF); for (let f = 0; f < m.nF; f++) lbl[f] = sug.map[toneLbl[f]];
  lbl = Core.cleanLabels(lbl, nb, fc.area, nFil, 4, o.limpeza / (pl.s * pl.s));
  let share = Core.groupColors(fc.rgb, fc.area, lbl, nFil).share;

  // filamento que ficou (quase) sem área depois da limpeza só gastaria uma posição do AMS: tira e passa os poucos
  // triângulos que sobraram para o filamento de cor mais parecida
  const usados = share.map((_, j) => j).filter(j => share[j] >= 0.002);
  if (usados.length && usados.length < nFil) {
    const lab = filRGB.map(c => { const l = new Float32Array(3); Core.rgb8ToLab(c[0], c[1], c[2], l, 0); return l; });
    const novo = share.map((_, j) => {
      if (usados.includes(j)) return usados.indexOf(j);
      let b = 0, bd = 1e30; usados.forEach((u, i) => { const d = (lab[j][0] - lab[u][0]) ** 2 + (lab[j][1] - lab[u][1]) ** 2 + (lab[j][2] - lab[u][2]) ** 2; if (d < bd) { bd = d; b = i; } });
      return b;
    });
    for (let f = 0; f < m.nF; f++) lbl[f] = novo[lbl[f]];
    log(`(${nFil - usados.length} filamento(s) sem uso removido(s))`);
    filRGB = usados.map(j => filRGB[j]);
    share = Core.groupColors(fc.rgb, fc.area, lbl, filRGB.length).share;
  }
  const hexes = filRGB.map(c => Core.hex(c));
  if (tpl) opts.bambu = { settings: Core.bambuSettings(tpl, hexes) };
  log(`\nFilamentos (${hexes.length}):`);
  hexes.forEach((h, j) => log(`  Slot ${j + 1}: ${h}  ${Core.nomeCor(filRGB[j]).padEnd(12)} ${(share[j] * 100).toFixed(1)}%`));
  const [sx, sy, sz] = pl.size;
  log(`Tamanho: ${sx.toFixed(0)} × ${sy.toFixed(0)} × ${sz.toFixed(0)} mm`);
  if (sx > o.mesa[0] || sy > o.mesa[1]) log(`AVISO: não cabe na mesa ${o.mesa[0]} × ${o.mesa[1]} mm. Use --altura menor.`);

  const blob = await Core.make3MF(m, lbl, hexes, opts, f => progresso('Gerando o 3MF…', f));
  fimProgresso();
  const dirSaida = pastaSaida || path.dirname(path.resolve(entrada));
  fs.mkdirSync(dirSaida, { recursive: true });
  const saida = o.saida ? path.resolve(o.saida) : saidaLivre(path.join(dirSaida, nome.replace(/[^\w\-+.]+/g, '_') + '_pintado.3mf'));
  if (o.saida && fs.existsSync(saida)) throw new Error('O arquivo de saída já existe, não vou sobrescrever: ' + saida);
  fs.writeFileSync(saida, Buffer.from(await blob.arrayBuffer()));
  log(`\nPronto: ${saida} (${(blob.size / 1e6).toFixed(1)} MB) em ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
  return saida;
}

// expande pastas em modelos (.zip/.obj), sem pegar os que já são resultado
function listarModelos(entradas) {
  const lista = [];
  for (const e of entradas) {
    if (!fs.existsSync(e)) throw new Error('Não achei: ' + e);
    if (fs.statSync(e).isDirectory()) {
      const achados = fs.readdirSync(e).filter(f => /\.(zip|obj)$/i.test(f) && !/_pintado/i.test(f)).sort();
      if (!achados.length) log('AVISO: nenhum .zip ou .obj em ' + e);
      for (const f of achados) lista.push({ arq: path.join(e, f), pasta: path.join(e, 'pintados') });
    } else lista.push({ arq: e, pasta: null });
  }
  return lista;
}

async function main() {
  const o = lerArgs(process.argv.slice(2));
  if (o.ajuda || !o.entradas.length) { log(AJUDA); return o.ajuda ? 0 : 1; }
  Core.setLightWeight(0.5);
  const lista = listarModelos(o.entradas);
  if (!lista.length) return 1;
  if (o.saida && lista.length > 1) throw new Error('--saida só vale para um modelo. Com vários, os arquivos vão para a pasta "pintados".');
  const tpl = carregarModelo(o);
  const ok = [], falhas = [];
  for (let i = 0; i < lista.length; i++) {
    const { arq, pasta } = lista[i];
    if (lista.length > 1) log(`\n===== [${i + 1}/${lista.length}] ${path.basename(arq)} =====`);
    try { ok.push(await processar(arq, o, tpl, pasta)); }
    catch (e) { fimProgresso(); falhas.push([arq, (e && e.message) || String(e)]); console.error('Erro em ' + path.basename(arq) + ': ' + ((e && e.message) || e)); }
  }
  if (lista.length > 1) {
    log(`\n===== Resumo: ${ok.length} pronto(s), ${falhas.length} com erro =====`);
    ok.forEach(f => log('  ok    ' + f));
    falhas.forEach(([a, m]) => log('  ERRO  ' + path.basename(a) + ': ' + m));
  }
  if (o.abrir && ok.length === 1) spawn('cmd', ['/c', 'start', '', ok[0]], { detached: true, stdio: 'ignore' }).unref();
  else if (o.abrir && ok.length > 1) spawn('explorer', [path.dirname(ok[0])], { detached: true, stdio: 'ignore' }).unref();
  return falhas.length && !ok.length ? 1 : 0;
}

main().then(c => { process.exitCode = c; }, e => { fimProgresso(); console.error('\nErro: ' + (e && e.message || e)); process.exitCode = 1; });
