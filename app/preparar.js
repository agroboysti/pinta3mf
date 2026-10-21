// Copia a página já montada (web/dist/Pinta3MF.html) para dentro do app, antes de gerar o instalador.
const fs = require('fs');
const path = require('path');

fs.copyFileSync(path.join(__dirname, '..', 'web', 'dist', 'Pinta3MF.html'), path.join(__dirname, 'Pinta3MF.html'));
console.log('Pinta3MF.html copiado para o app.');
