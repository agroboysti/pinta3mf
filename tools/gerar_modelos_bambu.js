#!/usr/bin/env node
// Gera cli/modelo/<impressora>.json: o project_settings.config do Bambu Studio já "achatado"
// (impressora + processo + filamento, com a cadeia de `inherits`/`include` resolvida), com 1 filamento.
// O Pinta3MF expande esses arrays para N filamentos na hora de gerar o 3MF.
// Precisa do Bambu Studio instalado só para rodar ESTE script; o resultado fica no repositório.
//
// Uso: node tools/gerar_modelos_bambu.js <project_settings_de_referencia.json> [pasta_BBL]
//   project_settings_de_referencia.json = Metadata/project_settings.config de um .3mf exportado pelo próprio Bambu
//   (fornece TODAS as chaves com os valores padrão; os perfis do sistema sobrescrevem).
const fs = require('fs');
const path = require('path');

const ref = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const BBL = process.argv[3] || 'C:\\Program Files\\Bambu Studio\\resources\\profiles\\BBL';
const SAIDA = path.join(__dirname, '..', 'cli', 'modelo');

const IMPRESSORAS = {
  'a1': 'Bambu Lab A1 0.4 nozzle',
  'a1-mini': 'Bambu Lab A1 mini 0.4 nozzle',
  'p1s': 'Bambu Lab P1S 0.4 nozzle',
  'x1c': 'Bambu Lab X1 Carbon 0.4 nozzle',
};
const META = new Set(['type', 'name', 'from', 'instantiation', 'setting_id', 'inherits', 'include', 'description', 'filament_id', 'version']);

function carregar(tipo, nome) {
  const f = path.join(BBL, tipo, nome + '.json');
  if (!fs.existsSync(f)) throw new Error(`Perfil não encontrado: ${tipo}/${nome}`);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
function achatar(tipo, nome) {
  const j = carregar(tipo, nome);
  let out = j.inherits ? achatar(tipo, j.inherits) : {};
  for (const [k, v] of Object.entries(j)) if (!META.has(k)) out[k] = v;
  for (const inc of j.include || []) {
    const t = carregar(tipo, inc);
    for (const [k, v] of Object.entries(t)) if (!META.has(k)) out[k] = v;
  }
  return out;
}

fs.mkdirSync(SAIDA, { recursive: true });
for (const [id, maquina] of Object.entries(IMPRESSORAS)) {
  let m, p, f;
  try {
    m = achatar('machine', maquina);
    const procNome = m.default_print_profile, filNome = [].concat(m.default_filament_profile)[0];
    p = achatar('process', procNome); f = achatar('filament', filNome);
    const cfg = { ...ref };
    for (const src of [m, p, f]) for (const [k, v] of Object.entries(src)) cfg[k] = v;
    Object.assign(cfg, {
      printer_settings_id: maquina, print_settings_id: procNome, filament_settings_id: [filNome],
      printer_model: m.printer_model, printer_variant: m.printer_variant,
      from: 'project', name: 'project_settings',
    });
    fs.writeFileSync(path.join(SAIDA, id + '.json'), JSON.stringify({ impressora: maquina, processo: procNome, filamento: filNome, filamentoKeys: Object.keys(f), config: cfg }));
    console.log(`ok ${id}: ${maquina} | ${procNome} | ${filNome} | ${Object.keys(cfg).length} chaves | mesa ${[].concat(cfg.printable_area).join(' ')}`);
  } catch (e) { console.log(`pulei ${id}: ${e.message}`); }
}
