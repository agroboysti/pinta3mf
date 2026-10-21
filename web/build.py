"""Junta page.html + core.js e gera:
   dist/Pinta3MF.html           -> página completa, abre direto no navegador (download sai como .3mf)
   dist/pinta3mf_artifact.html  -> versão sem <html>/<head> para publicar como artifact no claude.ai
Uso:  python build.py
"""
import base64
import json
from pathlib import Path

aqui = Path(__file__).resolve().parent
page = (aqui / "page.html").read_text(encoding="utf-8")
core = (aqui / "core.js").read_text(encoding="utf-8")
modelos = {}
for f in sorted((aqui.parent / "cli" / "modelo").glob("*.json")):
    modelos[f.stem] = json.loads(f.read_text(encoding="utf-8"))
exemplo = base64.b64encode((aqui / "exemplo" / "mago.zip").read_bytes()).decode("ascii")
full = page.replace("/*__CORE__*/", core).replace("/*__EXEMPLO__*/", exemplo).replace("/*__MODELOS__*/{}", json.dumps(modelos, separators=(",", ":"), ensure_ascii=False))

dist = aqui / "dist"
dist.mkdir(exist_ok=True)
(dist / "pinta3mf_artifact.html").write_text(full, encoding="utf-8")
head = ('<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
        '<style>body{margin:0}img{max-width:100%}</style>\n</head>\n<body>\n')
(dist / "Pinta3MF.html").write_text(head + full + "\n</body>\n</html>\n", encoding="utf-8")
print("ok ->", dist)
