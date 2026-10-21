#!/usr/bin/env node
// Gera web/exemplo/mago.zip: o modelo de exemplo embutido no site (OBJ + MTL + textura reduzida para 1024 px).
// Uso: node tools/gerar_exemplo.js "D:\time mage 3d model.zip"
const fs = require('fs');
const path = require('path');
const sharp = require('../node_modules/sharp');
const Core = require('../web/core.js');

const IMG = /\.(png|jpe?g)$/i, SEM_COR = /normal|rough|metal|spec|height|bump|_ao|occlusion|emiss/i;
(async () => {
  const origem = process.argv[2];
  if (!origem) throw new Error('Passe o .zip do modelo.');
  const u8 = new Uint8Array(fs.readFileSync(origem));
  const f = await Core.unzip(u8, n => /\.(obj|mtl)$/i.test(n) || (IMG.test(n) && !SEM_COR.test(n)));
  const nome = Object.keys(f);
  const obj = nome.find(n => /\.obj$/i.test(n)), mtl = nome.find(n => /\.mtl$/i.test(n)), img = nome.find(n => IMG.test(n));
  if (!obj || !img) throw new Error('Não achei obj + textura de cor no zip: ' + nome.join(', '));
  const jpg = await sharp(Buffer.from(f[img])).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  const base = 'mago';
  const mtlTxt = `newmtl mago\nKd 0.8 0.8 0.8\nmap_Kd ${base}_basecolor.jpg\n`;
  const objTxt = Buffer.from(f[obj]).toString('utf8').replace(/^mtllib .*$/m, `mtllib ${base}.mtl`).replace(/^usemtl .*$/gm, 'usemtl mago');
  const z = new Core.ZipWriter();
  const enc = new TextEncoder();
  await z.add(base + '.obj', enc.encode(objTxt));
  await z.add(base + '.mtl', enc.encode(mtlTxt));
  await z.add(base + '_basecolor.jpg', new Uint8Array(jpg));
  const blob = z.finish('application/zip');
  const dest = path.join(__dirname, '..', 'web', 'exemplo');
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, base + '.zip'), Buffer.from(await blob.arrayBuffer()));
  console.log('ok:', path.join(dest, base + '.zip'), (blob.size / 1e6).toFixed(2), 'MB');
})().catch(e => { console.error('Erro:', e.message); process.exit(1); });
