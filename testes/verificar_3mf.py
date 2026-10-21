"""Confere um .3mf gerado pelo Pinta3MF (só usa a biblioteca padrão do Python).
Uso:  python verificar_3mf.py arquivo.3mf
Mostra: arquivos dentro do zip, metadados, nº de vértices/triângulos, quantos triângulos
por filamento (paint_color) e o tamanho do modelo em mm.
"""
import sys, zipfile, collections, xml.etree.ElementTree as ET

# paint_color do Bambu Studio/OrcaSlicer: extrusor 1 -> "4", 2 -> "8", 3 -> "0C", 4 -> "1C", 5 -> "2C"...
def extrusor(code):
    if not code: return 0
    if code == "4": return 1
    if code == "8": return 2
    if code.endswith("C") and len(code) == 2: return int(code[0], 16) + 3
    return f"?{code}"  # triângulo subdividido ou código desconhecido

def main(path):
    z = zipfile.ZipFile(path)
    print("integridade do zip:", "ok" if z.testzip() is None else "CORROMPIDO")
    for i in z.infolist():
        print(f"  {i.filename:40s} {i.file_size/1e6:8.2f} MB")
    nv = nt = 0
    por_ext = collections.Counter()
    mn = [1e30] * 3; mx = [-1e30] * 3
    meta = {}
    for _, el in ET.iterparse(z.open("3D/3dmodel.model")):
        tag = el.tag.split("}")[-1]
        if tag == "metadata":
            meta[el.get("name")] = el.text
        elif tag == "vertex":
            nv += 1
            for k, a in enumerate("xyz"):
                v = float(el.get(a)); mn[k] = min(mn[k], v); mx[k] = max(mx[k], v)
        elif tag == "triangle":
            nt += 1; por_ext[extrusor(el.get("paint_color"))] += 1
        el.clear()
    print("metadados:", meta)
    print(f"vértices: {nv:,}  triângulos: {nt:,}".replace(",", "."))
    for e, n in sorted(por_ext.items(), key=lambda x: str(x[0])):
        nome = "sem pintura (usa o filamento do objeto)" if e == 0 else f"filamento {e}"
        print(f"  {nome:40s} {n:>10,} ({n/nt*100:.1f}%)".replace(",", "."))
    print("tamanho (mm): " + " x ".join(f"{b-a:.1f}" for a, b in zip(mn, mx)))
    print("posição: x {:.1f}..{:.1f}  y {:.1f}..{:.1f}  z {:.1f}..{:.1f}".format(mn[0], mx[0], mn[1], mx[1], mn[2], mx[2]))

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    main(sys.argv[1])
