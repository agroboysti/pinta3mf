// Gera app\saida\Pinta3MF-win32-x64\Pinta3MF.exe (pasta portátil: basta copiar a pasta inteira).
// PINTA_SAIDA=outra_pasta muda a pasta de saída (útil se o app antigo estiver aberto e travando a pasta).
const fs = require('fs');
const path = require('path');
const { packager } = require('@electron/packager');

(async () => {
  fs.copyFileSync(path.join(__dirname, '..', 'web', 'dist', 'Pinta3MF.html'), path.join(__dirname, 'Pinta3MF.html'));
  const caminhos = await packager({
    dir: __dirname, out: path.join(__dirname, process.env.PINTA_SAIDA || 'saida'), name: 'Pinta3MF', platform: 'win32', arch: 'x64',
    overwrite: true, prune: true, asar: true,
    ignore: [/^\/saida/, /^\/saida2/, /^\/dist-instalador/, /^\/preparar\.js$/,/^\/empacotar\.js$/, /^\/package-lock\.json$/],
  });
  console.log('Pronto:', caminhos.join('\n'));
})().catch(e => { console.error('Erro:', e.message || e); process.exit(1); });

