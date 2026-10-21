# Pinta3MF — contexto do projeto

Converte um modelo 3D **OBJ com textura** (ex.: modelos gerados por IA no Tripo/Meshy, exportados do Blender)
em um **3MF que abre já pintado no Bambu Studio** (e OrcaSlicer), com um filamento do AMS para cada cor.
Hoje o usuário pinta manualmente no Bambu Studio porque ele só recebe STL (sem cor). Responda sempre em português.

## Estado atual (o que já funciona)

- `web/core.js` — núcleo sem DOM (roda no navegador e no Node 18+):
  - `parseOBJ` (parser rápido em bytes; v, vt, f com polígonos/índices negativos, usemtl, mtllib, cor por vértice)
  - `parseMTL` (Kd e map_Kd)
  - `faceColors` — cor de cada triângulo = pixel da textura no centro UV do triângulo (pixel mais próximo, sem mistura)
  - `palette` — k-means em Lab (peso da claridade 0.5) gerando 2×T tons e juntando os mais parecidos até T
  - `suggestFilaments` — junta tons em N filamentos: (1) tom mais escuro com mesma tonalidade/saturação = sombra → vai pro tom claro;
    (2) junta os mais parecidos em Lab até sobrar N
  - `buildNeighbors` + `cleanLabels` — filtro de maioria e remoção de manchas menores que X mm²
  - `placement` — Y-pra-cima → Z-pra-cima, escala para a altura em mm, centraliza na mesa
  - `threeMFParts` / `make3MF` — escreve o 3MF em pedaços (ZIP com `CompressionStream` nativo, sem bibliotecas)
  - `unzip` — leitor de .zip com `DecompressionStream`
- `web/page.html` — interface (prévia 3D com three.js r128 via jsDelivr, paleta editável, tons → slot, altura, impressora).
  `python web/build.py` junta tudo em `web/dist/Pinta3MF.html` (abre direto no navegador) e na versão de artifact.
- O site também está publicado como artifact no claude.ai (lá o download sai como `.3mf.zip` porque o sandbox não aceita a extensão `.3mf`).
- `cli/pinta3mf.js` + `Pinta3MF.bat` — programa de linha de comando / arrastar-e-soltar (Node 18+, `sharp` para a textura).
  `node cli/pinta3mf.js modelo.zip -f 5 -a 100 -i a1`; `--ajuda` lista as opções. Modelo de teste: `D:\knitted+santa+3d+model.zip` (~10 s).
  **Lote:** `node cli/pinta3mf.js <pasta>` (ou arrastar uma pasta no `.bat`) pinta todos os `.zip`/`.obj` da pasta e grava em `<pasta>\pintados`;
  vários modelos soltos também funcionam. Um erro num modelo não interrompe os outros (resumo no final). Filamentos que ficam com <0,2% de
  área depois da limpeza são removidos (não gasta posição do AMS).
  Exemplo do site: o mago (`web/exemplo/mago.zip`, gerado por `tools/gerar_exemplo.js`, embutido pelo `build.py`).
  Publicado: https://lucas3d-five.vercel.app (Vercel, pasta de deploy no scratchpad; AWS bloqueada por SCP da organização).
  A página web também gera o projeto Bambu: `web/build.py` embute `cli/modelo/*.json` em `page.html` (`/*__MODELOS__*/`) e o seletor
  de impressora usa `data-tpl`; opções sem perfil (H2D, mesa 300, P2S) saem só com geometria + pintura (tudo verde no Bambu).
- `app/` — app de janela (Electron 44 + @electron/packager). `cd app; npm run empacotar` gera `app/saida/Pinta3MF-win32-x64/Pinta3MF.exe`
  (pasta portátil de ~370 MB). Salva com o diálogo nativo e oferece "Abrir no Bambu Studio". `npm start` roda sem empacotar.
  Testado via DevTools (`--remote-debugging-port`): carrega o Santa, gera o 3MF e o Bambu reexporta com as 5 cores e a pintura.
- `extras/pintar_auto.py` — primeira versão em Python (gera OBJ com materiais por cor). Não é mais o caminho principal.
- `testes/verificar_3mf.py` — confere um .3mf (zip, contagem por filamento, tamanho em mm). Só biblioteca padrão.

Testado no modelo do usuário `knitted_santa_3d_model.zip` (OBJ 136 MB, 1.961.288 triângulos, textura 8192²):
carrega em ~5 s e gera o 3MF (~25 MB) em ~6 s no Chromium. Resultado com 12 tons → 5 filamentos:
vermelho #AE101A (49%), preto #120707 (22%), dourado #B78B38 (20%), branco #D0CBC9 (7%), pele #968077 (2%).

## Formato do 3MF (o ponto crítico)

Pintura por triângulo no atributo `paint_color` (mesmo nome que o Bambu Studio usa; o PrusaSlicer usa
`slic3rpe:mmu_segmentation`, que o Bambu NÃO lê). Codificação para triângulo inteiro (não subdividido), hex MAIÚSCULO:

| extrusor | 1 | 2 | 3  | 4  | 5  | 6  | … |
|----------|---|---|----|----|----|----|---|
| código   | 4 | 8 | 0C | 1C | 2C | 3C | … (até "DC" = 16; acima disso o prefixo "F" soma 15) |

Estrutura atual do zip: `[Content_Types].xml`, `_rels/.rels`, `3D/3dmodel.model` (um objeto, malha única, unidade mm,
metadata Application = "Pinta3MF").

### RESOLVIDO (2026-10-16) — projeto Bambu completo
Testado com o Bambu Studio 02.08.02.61 desta máquina (CLI: `bambu-studio.exe --export-3mf saida.3mf entrada.3mf`, sem janela;
a saída só vem em `result.json` e no arquivo, o stdout fica vazio). Achados:
- O Bambu **lê o `paint_color`** mesmo sem configs (os códigos 4/8/0C/1C/2C sobreviveram ao reexport).
- Mas sem `project_settings.config` o projeto tem 1 filamento (`#00AE42`) e tudo aparece verde.
- A solução é o projeto completo: `cli/pinta3mf.js` agora grava no layout do Bambu (`3D/3dmodel.model` com componente →
  `3D/Objects/object_1.model`, `Metadata/project_settings.config` completo, `model_settings.config`, `slice_info.config`…),
  com `Application = BambuStudio-02.08.02.61`. A config vem de `cli/modelo/<impressora>.json` (a1, a1-mini, p1s, x1c),
  gerada por `tools/gerar_modelos_bambu.js` achatando os perfis do sistema do Bambu (`resources/profiles/BBL`, cadeia `inherits`/`include`).
  `Core.bambuSettings(tpl, hexes)` expande os arrays por-filamento para N (lista com tamanho errado = "configuração inválida").
- Verificado: reexport pelo Bambu mantém `filament_colour` com as N cores, `printer_settings_id` certo e a miniatura renderizada
  por ele mostra o modelo pintado. Malha centrada na origem, item com a translação (como o Bambu salva).
- NÃO funciona: `--load-filaments` com JSON mínimo derruba o Bambu (crash 0xC0000005); `--load-settings` não resolve `inherits`.

### Problema em aberto (histórico — agora resolvido, ver acima)
1. A 1ª versão incluía `Metadata/project_settings.config` só com `{"filament_colour": [...]}` e `Metadata/model_settings.config`.
   O Bambu Studio mostrou: **"O arquivo 3mf contém uma configuração inválida, carregar apenas os dados de geometria"**.
2. Os dois arquivos de configuração foram removidos (versão atual). **Ainda não foi confirmado** se o Bambu Studio
   mostra a pintura ao importar esse 3MF. Relatos do fórum dizem que em "somente geometria" a pintura de 3MF de
   outros programas some — mas aqueles eram do PrusaSlicer (atributo diferente).
3. Se a pintura não aparecer, o caminho provável é gerar um **3MF de projeto Bambu completo**:
   - Pedir ao usuário (ou achar na máquina) um .3mf salvo pelo próprio Bambu Studio (Arquivo › Salvar projeto).
   - Abrir esse zip e copiar a estrutura: `Metadata/project_settings.config` completo (usar como modelo e só trocar
     `filament_colour`, e se preciso `filament_type`, `filament_settings_id` etc. para ter N filamentos),
     `Metadata/model_settings.config`, metadados do `3dmodel.model` (`Application` = "BambuStudio-<versão>",
     `BambuStudio:3mfVersion`, namespace `xmlns:BambuStudio`), `Metadata/slice_info.config` se existir.
   - Comparar com o nosso arquivo e ajustar até o Bambu abrir sem aviso e com as cores dos filamentos certas.
   - Código-fonte de referência: `bambulab/BambuStudio`, arquivo `src/libslic3r/Format/bbs_3mf.cpp`
     (procure `paint_color`, `BBL_APPLICATION_TAG`, `m_is_bbl_3mf`, `dont_load_config`) e as mensagens em `src/slic3r/GUI/Plater.cpp`.

## Como testar nesta máquina (Windows, Bambu Studio instalado)

- Gerar o 3MF: `python web/build.py` e abrir `web/dist/Pinta3MF.html` no Chrome, ou criar um script Node que use `core.js`
  (o Node não decodifica JPEG/PNG sozinho: use `sharp` ou `jpeg-js`/`pngjs`, redimensionando a textura para no máx. 4096 px).
- Conferir o arquivo: `python testes/verificar_3mf.py arquivo.3mf`.
- Testar no Bambu Studio de verdade:
  - Ver se há linha de comando: `"C:\Program Files\Bambu Studio\bambu-studio.exe" --help` (o Bambu Studio tem CLI herdada
    do PrusaSlicer/Orca, ex. `--slice`, `--export-3mf`, `--info`; confirme as opções reais pelo `--help`).
    Uma ideia: importar o nosso 3MF e exportar de novo como projeto pelo CLI — se a pintura sobreviver no arquivo exportado,
    o Bambu leu o `paint_color`.
  - Se não der pelo CLI, pedir ao usuário para abrir o arquivo e mandar print, ou usar automação de tela.
- Não apagar nem sobrescrever arquivos do usuário; gerar saídas novas ao lado.

## Próximos passos sugeridos (em ordem)

1. Confirmar se a pintura aparece no Bambu Studio com o 3MF atual. Se não, montar o 3MF de projeto Bambu completo (acima).
2. Fazer as cores dos filamentos virem prontas no projeto (filament_colour) sem disparar o aviso de configuração inválida.
3. Programa para PC (o usuário quer): opções, da mais simples para a mais completa:
   - CLI em Node (`pinta3mf modelo.zip --filamentos 5 --altura 100`) reaproveitando `core.js` + `sharp` para a textura;
     com um `.bat` de arrastar-e-soltar.
   - App de janela: Electron ou Tauri embrulhando `page.html` (o download vira "Salvar como" nativo e dá para
     abrir o Bambu Studio no final com o arquivo gerado).
   - Empacotar como .exe (pkg/nexe para o CLI, electron-builder para o app).
4. Suporte extra: GLB/GLTF (textura embutida), FBX via Blender em linha de comando, várias texturas/materiais.
5. Melhorias de cor: escolher a cor exata pela lista de filamentos que o usuário tem; prévia lado a lado original × pintado.

## Preferências do usuário
- Fala português do Brasil, usa Windows e Bambu Studio com AMS.
- Quer tudo o mais automático possível: soltar o modelo e sair o 3MF pintado.
