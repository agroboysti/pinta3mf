#!/usr/bin/env python3
"""
pintar_auto.py - converte um boneco 3D com cor/textura em um OBJ
ja pintado para o Bambu Studio (sem pintar a mao).

Aceita:  .glb / .gltf  (com textura, cor de material ou cor por vertice)
         .obj (+ .mtl + imagem de textura, ou cores por vertice)
Gera:    <nome>_bambu.obj + <nome>_bambu.mtl  (uma cor solida por material)
         -> no Bambu Studio: Importar, escolher os filamentos e pronto.

Uso:
  python pintar_auto.py boneco.glb
  python pintar_auto.py boneco.glb --cores 4 --altura 120
  python pintar_auto.py boneco.obj --paleta "#ffffff,#000000,#e03030,#f0c8a0"
  python pintar_auto.py pasta_com_varios_modelos/

Precisa so de:  pip install numpy pillow
"""
import argparse, json, os, struct, sys, base64, io
import numpy as np
from PIL import Image

# ---------------------------------------------------------------- util
def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def lin_to_srgb(c):
    c = np.clip(np.asarray(c, dtype=np.float64), 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)

def to_lab(rgb):
    """rgb sRGB 0..1 -> CIELAB (para medir diferenca de cor como o olho ve)"""
    l = srgb_to_lin(rgb)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = l @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], 1)

class Textura:
    def __init__(self, img, flip_v):
        self.a = np.asarray(img.convert("RGB"), dtype=np.float64) / 255.0
        self.h, self.w = self.a.shape[:2]
        self.flip_v = flip_v

    def amostrar(self, uv):
        # UV dentro de 0..1 fica preso na borda (sem "dar a volta" na imagem);
        # fora disso a textura repete, como nos programas 3D.
        u = uv[:, 0].copy(); v = uv[:, 1].copy()
        fora_u = (u < 0) | (u > 1); fora_v = (v < 0) | (v > 1)
        u[fora_u] %= 1.0; v[fora_v] %= 1.0
        if self.flip_v:
            v = 1.0 - v
        # pixel mais proximo (nao mistura cores de regioes vizinhas da textura)
        x = np.clip((u * self.w).astype(int), 0, self.w - 1)
        y = np.clip((v * self.h).astype(int), 0, self.h - 1)
        return self.a[y, x]

# Uma "parte" = triangulos que compartilham a mesma fonte de cor
class Parte:
    def __init__(self, pos, faces, uv=None, vcor=None, textura=None, cor=(0.8, 0.8, 0.8)):
        self.pos = np.asarray(pos, np.float64)       # (N,3)
        self.faces = np.asarray(faces, np.int64)     # (F,3) indices em pos
        self.uv = uv                                 # (F,3,2) ou None
        self.vcor = vcor                             # (F,3,3) sRGB ou None
        self.textura = textura
        self.cor = np.asarray(cor, np.float64)       # sRGB multiplicador

# ---------------------------------------------------------------- GLTF/GLB
_CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}

def _quat_mat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])

def carregar_gltf(caminho):
    pasta = os.path.dirname(os.path.abspath(caminho))
    dados = open(caminho, "rb").read()
    binchunk = None
    if dados[:4] == b"glTF":
        off = 12; js = None
        while off < len(dados):
            ln, tp = struct.unpack_from("<II", dados, off)
            chunk = dados[off + 8: off + 8 + ln]
            if tp == 0x4E4F534A: js = json.loads(chunk.decode("utf-8").rstrip("\x00 \t\r\n"))
            elif tp == 0x004E4942: binchunk = chunk
            off += 8 + ln
    else:
        js = json.loads(dados.decode("utf-8"))

    buffers = []
    for b in js.get("buffers", []):
        uri = b.get("uri")
        if uri is None: buffers.append(binchunk)
        elif uri.startswith("data:"): buffers.append(base64.b64decode(uri.split(",", 1)[1]))
        else: buffers.append(open(os.path.join(pasta, uri), "rb").read())

    def bview(i):
        bv = js["bufferViews"][i]
        buf = buffers[bv["buffer"]]
        o = bv.get("byteOffset", 0)
        return buf[o: o + bv["byteLength"]], bv.get("byteStride")

    def acessor(i):
        ac = js["accessors"][i]
        dt = np.dtype(_CT[ac["componentType"]]); nc = _NC[ac["type"]]; n = ac["count"]
        if "bufferView" not in ac:
            arr = np.zeros((n, nc), dt)
        else:
            raw, stride = bview(ac["bufferView"])
            o = ac.get("byteOffset", 0)
            item = dt.itemsize * nc
            if stride and stride != item:
                arr = np.stack([np.frombuffer(raw, dt, nc, o + k * stride) for k in range(n)])
            else:
                arr = np.frombuffer(raw, dt, n * nc, o).reshape(n, nc)
        if "sparse" in ac:
            sp = ac["sparse"]; arr = arr.copy()
            ir, _ = bview(sp["indices"]["bufferView"])
            idx = np.frombuffer(ir, _CT[sp["indices"]["componentType"]], sp["count"], sp["indices"].get("byteOffset", 0))
            vr, _ = bview(sp["values"]["bufferView"])
            val = np.frombuffer(vr, dt, sp["count"] * nc, sp["values"].get("byteOffset", 0)).reshape(-1, nc)
            arr[idx] = val
        arr = arr.astype(np.float64)
        if ac.get("normalized") or (ac["componentType"] != 5126 and ac["type"] != "SCALAR"):
            if ac["componentType"] in (5121, 5123, 5125):
                arr /= float(np.iinfo(dt).max)
            elif ac["componentType"] in (5120, 5122):
                arr = np.maximum(arr / float(np.iinfo(dt).max), -1)
        return arr

    cache_img = {}
    def imagem(idx):
        if idx in cache_img: return cache_img[idx]
        im = js["images"][idx]
        if "bufferView" in im: raw = bview(im["bufferView"])[0]
        elif im["uri"].startswith("data:"): raw = base64.b64decode(im["uri"].split(",", 1)[1])
        else: raw = open(os.path.join(pasta, im["uri"]), "rb").read()
        try:
            t = Textura(Image.open(io.BytesIO(raw)), flip_v=False)
        except Exception as e:
            print(f"  aviso: nao consegui ler a imagem {idx} ({e}); usando cor do material")
            t = None
        cache_img[idx] = t
        return t

    partes = []
    def matriz_no(no):
        if "matrix" in no:
            return np.array(no["matrix"], np.float64).reshape(4, 4).T
        M = np.eye(4)
        S = np.diag(no.get("scale", [1, 1, 1]))
        R = _quat_mat(no.get("rotation", [0, 0, 0, 1]))
        M[:3, :3] = R @ S
        M[:3, 3] = no.get("translation", [0, 0, 0])
        return M

    def visitar(ni, pai):
        no = js["nodes"][ni]
        M = pai @ matriz_no(no)
        if "mesh" in no:
            for prim in js["meshes"][no["mesh"]]["primitives"]:
                if prim.get("mode", 4) != 4: continue
                at = prim["attributes"]
                if "POSITION" not in at: continue
                pos = acessor(at["POSITION"])[:, :3]
                pos = (np.c_[pos, np.ones(len(pos))] @ M.T)[:, :3]
                if "indices" in prim: ind = acessor(prim["indices"]).astype(np.int64).reshape(-1, 3)
                else: ind = np.arange(len(pos)).reshape(-1, 3)
                if np.linalg.det(M[:3, :3]) < 0: ind = ind[:, ::-1]
                cor = (1, 1, 1); tex = None; uv = None; vcor = None
                if "material" in prim:
                    mat = js["materials"][prim["material"]]
                    pbr = mat.get("pbrMetallicRoughness", {})
                    cor = lin_to_srgb(pbr.get("baseColorFactor", [1, 1, 1, 1])[:3])
                    bt = pbr.get("baseColorTexture")
                    if bt is not None:
                        src = js["textures"][bt["index"]].get("source")
                        if src is None:
                            for ext in js["textures"][bt["index"]].get("extensions", {}).values():
                                src = ext.get("source", src)
                        if src is not None:
                            tex = imagem(src)
                            key = f"TEXCOORD_{bt.get('texCoord', 0)}"
                            if tex is not None and key in at:
                                uv = acessor(at[key])[:, :2][ind]
                            else:
                                tex = None
                if "COLOR_0" in at:
                    c = acessor(at["COLOR_0"])[:, :3]
                    vcor = lin_to_srgb(c)[ind]
                partes.append(Parte(pos, ind, uv, vcor, tex, cor))
        for f in no.get("children", []):
            visitar(f, M)

    cena = js.get("scenes", [{}])[js.get("scene", 0)] if js.get("scenes") else {"nodes": list(range(len(js.get("nodes", []))))}
    for n in cena.get("nodes", []):
        visitar(n, np.eye(4))
    return partes

# ---------------------------------------------------------------- OBJ
def carregar_mtl(caminho):
    mats = {}; atual = None; pasta = os.path.dirname(caminho)
    for linha in open(caminho, encoding="utf-8", errors="ignore"):
        p = linha.strip().split()
        if not p: continue
        if p[0] == "newmtl":
            atual = " ".join(p[1:]); mats[atual] = {"Kd": (0.8, 0.8, 0.8), "tex": None}
        elif atual and p[0] == "Kd" and len(p) >= 4:
            mats[atual]["Kd"] = tuple(float(x) for x in p[1:4])
        elif atual and p[0] == "map_Kd":
            nome = linha.strip()[len("map_Kd"):].strip()
            # ignora opcoes tipo -s 1 1 1 e pega o ultimo token (nome do arquivo)
            toks = nome.split()
            candidatos = [nome] + [" ".join(toks[i:]) for i in range(len(toks))]
            for c in candidatos:
                for tentativa in (os.path.join(pasta, c), os.path.join(pasta, os.path.basename(c.replace("\\", "/")))):
                    if os.path.isfile(tentativa):
                        mats[atual]["tex"] = tentativa; break
                if mats[atual]["tex"]: break
            if not mats[atual]["tex"]:
                print(f"  aviso: textura '{nome}' nao encontrada ao lado do .mtl")
    return mats

def carregar_obj(caminho):
    pasta = os.path.dirname(os.path.abspath(caminho))
    V = []; VC = []; VT = []; mats = {}
    grupos = {}  # material -> (lista faces pos, lista faces uv)
    mat_atual = None; tem_vc = False
    for linha in open(caminho, encoding="utf-8", errors="ignore"):
        if not linha or linha[0] == "#": continue
        p = linha.split()
        if not p: continue
        k = p[0]
        if k == "v":
            V.append([float(x) for x in p[1:4]])
            if len(p) >= 7:
                VC.append([float(x) for x in p[4:7]]); tem_vc = True
            else:
                VC.append([1.0, 1.0, 1.0])
        elif k == "vt":
            VT.append([float(p[1]), float(p[2]) if len(p) > 2 else 0.0])
        elif k == "mtllib":
            nome = linha.strip()[7:].strip()
            mp = os.path.join(pasta, nome)
            if os.path.isfile(mp): mats.update(carregar_mtl(mp))
            else: print(f"  aviso: {nome} nao encontrado")
        elif k == "usemtl":
            mat_atual = " ".join(p[1:])
        elif k == "f":
            vi = []; ti = []
            for c in p[1:]:
                s = c.split("/")
                a = int(s[0]); vi.append(a - 1 if a > 0 else len(V) + a)
                if len(s) > 1 and s[1]:
                    b = int(s[1]); ti.append(b - 1 if b > 0 else len(VT) + b)
                else:
                    ti.append(-1)
            g = grupos.setdefault(mat_atual, ([], []))
            for i in range(1, len(vi) - 1):  # triangula poligonos
                g[0].append([vi[0], vi[i], vi[i + 1]]); g[1].append([ti[0], ti[i], ti[i + 1]])
    V = np.array(V, np.float64); VC = np.array(VC, np.float64); VT = np.array(VT, np.float64) if VT else None
    if tem_vc and VC.max() > 1.0: VC = VC / 255.0
    partes = []
    for nome, (fp, ft) in grupos.items():
        fp = np.array(fp, np.int64); ft = np.array(ft, np.int64)
        m = mats.get(nome, {"Kd": (0.8, 0.8, 0.8), "tex": None})
        tex = None; uv = None
        if m["tex"] and VT is not None and (ft >= 0).all():
            try:
                tex = Textura(Image.open(m["tex"]), flip_v=True); uv = VT[ft]
            except Exception as e:
                print(f"  aviso: nao consegui abrir {m['tex']} ({e})")
        vcor = VC[fp] if tem_vc else None
        cor = (1, 1, 1) if (tex is not None or vcor is not None) else m["Kd"]
        partes.append(Parte(V, fp, uv, vcor, tex, cor))
    return partes

# ---------------------------------------------------------------- processamento
def juntar(partes):
    """Une todas as partes em uma malha so, com vertices soldados (fecha costuras de UV)."""
    allpos = np.concatenate([p.pos for p in partes])
    diag = np.linalg.norm(allpos.max(0) - allpos.min(0)) or 1.0
    tol = diag * 1e-6
    P = []; F = []; UV = []; VCOR = []; TEXI = []; COR = []; texs = []
    base = 0
    for p in partes:
        P.append(p.pos); F.append(p.faces + base); base += len(p.pos)
        n = len(p.faces)
        UV.append(p.uv if p.uv is not None else np.zeros((n, 3, 2)))
        VCOR.append(p.vcor if p.vcor is not None else np.ones((n, 3, 3)))
        if p.textura is not None:
            texs.append(p.textura); TEXI.append(np.full(n, len(texs) - 1))
        else:
            TEXI.append(np.full(n, -1))
        COR.append(np.tile(p.cor, (n, 1)))
    P = np.concatenate(P); F = np.concatenate(F)
    chave = np.round(P / tol).astype(np.int64)
    _, unic, inv = np.unique(chave, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    P = P[unic]; F = inv[F]
    ok = (F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])
    sel = lambda a: np.concatenate(a)[ok]
    return P, F[ok], sel(UV), sel(VCOR), sel(TEXI), sel(COR), texs

def subdividir(P, F, UV, VC, TI, CO, limite_faces, alvo_aresta):
    """Divide cada triangulo em 4 (sem criar buracos) ate as arestas ficarem pequenas
    ou atingir o limite de faces. Mais triangulos = fronteira de cor mais fina."""
    while True:
        e = np.linalg.norm(P[F[:, [1, 2, 0]]] - P[F], axis=2)
        if e.max() <= alvo_aresta or len(F) * 4 > limite_faces:
            return P, F, UV, VC, TI, CO
        arestas = np.sort(np.stack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]], 1).reshape(-1, 2), 1)
        unicas, inv = np.unique(arestas, axis=0, return_inverse=True)
        inv = inv.reshape(-1, 3) + len(P)
        P = np.concatenate([P, (P[unicas[:, 0]] + P[unicas[:, 1]]) / 2])
        a, b, c = F[:, 0], F[:, 1], F[:, 2]
        ab, bc, ca = inv[:, 0], inv[:, 1], inv[:, 2]
        F = np.concatenate([np.stack([a, ab, ca], 1), np.stack([ab, b, bc], 1),
                            np.stack([ca, bc, c], 1), np.stack([ab, bc, ca], 1)])
        def split(X):
            x0, x1, x2 = X[:, 0], X[:, 1], X[:, 2]
            m01, m12, m20 = (x0 + x1) / 2, (x1 + x2) / 2, (x2 + x0) / 2
            return np.concatenate([np.stack([x0, m01, m20], 1), np.stack([m01, x1, m12], 1),
                                   np.stack([m20, m12, x2], 1), np.stack([m01, m12, m20], 1)])
        UV = split(UV); VC = split(VC)
        TI = np.tile(TI, 4); CO = np.tile(CO, (4, 1))

def cor_das_faces(UV, VC, TI, CO, texs):
    cen_vc = VC.mean(1)
    cor = cen_vc * CO
    for i, t in enumerate(texs):
        m = TI == i
        if m.any():
            cor[m] = t.amostrar(UV[m].mean(1)) * cen_vc[m] * CO[m]
    return np.clip(cor, 0, 1)

def kmeans(X, pesos, k, iters=40, seed=0):
    rng = np.random.default_rng(seed)
    if len(X) > 60000:
        idx = rng.choice(len(X), 60000, replace=False, p=pesos / pesos.sum())
        X, pesos = X[idx], np.ones(60000)
    # k-means++
    C = [X[rng.choice(len(X), p=pesos / pesos.sum())]]
    for _ in range(1, k):
        d = np.min(((X[:, None] - np.array(C)[None]) ** 2).sum(2), 1) * pesos
        if d.sum() <= 0: break
        C.append(X[rng.choice(len(X), p=d / d.sum())])
    C = np.array(C)
    for _ in range(iters):
        lab = np.argmin(((X[:, None] - C[None]) ** 2).sum(2), 1)
        novo = np.array([np.average(X[lab == j], 0, pesos[lab == j]) if (lab == j).any() else C[j] for j in range(len(C))])
        if np.allclose(novo, C): break
        C = novo
    return C

def limpar_pontinhos(F, rotulo, passes):
    """Tira manchinhas isoladas (1-2 triangulos de outra cor) que ficam feias impressas."""
    arestas = np.sort(np.stack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]], 1).reshape(-1, 2), 1)
    face_de = np.repeat(np.arange(len(F)), 3)
    _, inv = np.unique(arestas, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    ordem = np.argsort(inv, kind="stable")
    inv_o = inv[ordem]; f_o = face_de[ordem]
    pares = inv_o[1:] == inv_o[:-1]
    A = f_o[:-1][pares]; B = f_o[1:][pares]
    viz_a = np.concatenate([A, B]); viz_b = np.concatenate([B, A])
    k = rotulo.max() + 1
    for _ in range(passes):
        cont = np.zeros((len(F), k), np.int32)
        np.add.at(cont, (viz_a, rotulo[viz_b]), 1)
        mesmo = cont[np.arange(len(F)), rotulo]
        maioria = cont.argmax(1)
        trocar = (mesmo == 0) & (cont.sum(1) > 0) | (mesmo < cont.max(1)) & (mesmo <= 1) & (cont.max(1) >= 2)
        if not trocar.any(): break
        rotulo = np.where(trocar, maioria, rotulo)
    return rotulo

def parse_paleta(s):
    cores = []
    for c in s.split(","):
        c = c.strip().lstrip("#")
        cores.append([int(c[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
    return np.array(cores)

def nome_cor(rgb):
    nomes = {"branco": (1, 1, 1), "preto": (0, 0, 0), "cinza": (.5, .5, .5), "vermelho": (.85, .1, .1),
             "laranja": (1, .5, .05), "amarelo": (1, .9, .1), "verde": (.15, .65, .2), "azul": (.1, .3, .85),
             "azul_claro": (.4, .7, 1), "roxo": (.5, .2, .7), "rosa": (1, .55, .7), "marrom": (.45, .25, .1),
             "bege": (.93, .8, .65), "pele": (.95, .75, .6), "dourado": (.85, .65, .15)}
    lab = to_lab(np.array([rgb]))[0]
    melhor = min(nomes, key=lambda n: np.linalg.norm(to_lab(np.array([nomes[n]]))[0] - lab))
    return melhor

# ---------------------------------------------------------------- saida
def salvar(P, F, rotulo, paleta, base_saida):
    nome = os.path.basename(base_saida)
    usados = [j for j in range(len(paleta)) if (rotulo == j).any()]
    with open(base_saida + ".mtl", "w", encoding="utf-8") as m:
        for j in usados:
            r, g, b = paleta[j]
            m.write(f"newmtl cor{j + 1}_{nome_cor(paleta[j])}\nKd {r:.4f} {g:.4f} {b:.4f}\nKa 0 0 0\nKs 0 0 0\nd 1\nillum 1\n\n")
    with open(base_saida + ".obj", "w", encoding="utf-8") as o:
        o.write(f"# gerado por pintar_auto.py\nmtllib {nome}.mtl\n")
        o.write("".join(f"v {x:.5f} {y:.5f} {z:.5f}\n" for x, y, z in P))
        for j in usados:
            o.write(f"usemtl cor{j + 1}_{nome_cor(paleta[j])}\n")
            o.write("".join(f"f {a + 1} {b + 1} {c + 1}\n" for a, b, c in F[rotulo == j]))
    return usados

def previa_png(P, F, cores_face, caminho, tam=700):
    """Desenho simples do modelo (frente e costas) para conferir as cores."""
    vistas = []
    for ang in (0, np.pi):
        R = np.array([[np.cos(ang), -np.sin(ang), 0], [np.sin(ang), np.cos(ang), 0], [0, 0, 1]])
        Q = P @ R.T
        x, z, prof = Q[:, 0], Q[:, 2], Q[:, 1]
        lo = np.array([x.min(), z.min()]); esc = (tam - 40) / max(np.ptp(x), np.ptp(z), 1e-9)
        px = (x - lo[0]) * esc + 20 + (tam - 40 - np.ptp(x) * esc) / 2
        pz = tam - 20 - (z - lo[1]) * esc - (tam - 40 - np.ptp(z) * esc) / 2
        tri = Q[F]
        n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
        frente = n[:, 1] < 0
        luz = np.clip(-n[:, 1] * 0.6 + n[:, 2] * 0.25 + 0.35, 0.25, 1)
        ordem = np.argsort(-prof[F].mean(1))
        img = Image.new("RGB", (tam, tam), (235, 235, 235))
        from PIL import ImageDraw
        d = ImageDraw.Draw(img)
        for i in ordem:
            if not frente[i]: continue
            c = tuple(int(v * 255) for v in np.clip(cores_face[i] * luz[i], 0, 1))
            pts = [(px[k], pz[k]) for k in F[i]]
            d.polygon(pts, fill=c, outline=c)
        vistas.append(img)
    tot = Image.new("RGB", (tam * 2, tam), (235, 235, 235))
    tot.paste(vistas[0], (0, 0)); tot.paste(vistas[1], (tam, 0))
    tot.save(caminho)

# ---------------------------------------------------------------- principal
def processar(caminho, a):
    print(f"\n>> {os.path.basename(caminho)}")
    ext = os.path.splitext(caminho)[1].lower()
    partes = carregar_gltf(caminho) if ext in (".glb", ".gltf") else carregar_obj(caminho)
    if not partes:
        print("  nenhuma malha encontrada."); return
    tem_cor = any(p.textura is not None or p.vcor is not None for p in partes) or len(partes) > 1
    if not tem_cor:
        print("  aviso: o arquivo nao tem textura nem cores - vai sair de uma cor so.")
    P, F, UV, VC, TI, CO, texs = juntar(partes)

    # Y pra cima (padrao glTF/Blender) -> Z pra cima (padrao Bambu Studio)
    if not a.sem_girar:
        P = P[:, [0, 2, 1]] * np.array([1, -1, 1])
    # escala para a altura desejada em mm
    altura_atual = max(np.ptp(P[:, 2]), 1e-9)
    if a.altura:
        P = P * (a.altura / altura_atual)
    elif altura_atual < 10:
        print(f"  modelo muito pequeno ({altura_atual:.2f} - provavelmente em metros): ajustando para 100 mm de altura")
        P = P * (100 / altura_atual)
    elif altura_atual > 256:
        print(f"  aviso: o modelo tem {altura_atual:.0f} mm de altura; use --altura para diminuir (ou escale no Bambu Studio)")
    P = P - [P[:, 0].mean(), P[:, 1].mean(), P[:, 2].min()]

    diag = np.linalg.norm(np.ptp(P, 0))
    P, F, UV, VC, TI, CO = subdividir(P, F, UV, VC, TI, CO, a.max_triangulos, diag / a.detalhe)
    cores = cor_das_faces(UV, VC, TI, CO, texs)

    tri = P[F]; area = np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1) / 2 + 1e-12
    lab = to_lab(cores)
    if a.paleta:
        paleta = parse_paleta(a.paleta)
    else:
        centros = kmeans(lab, area, a.cores)
        # cor representativa de cada grupo = media sRGB das faces dele
        r = np.argmin(((lab[:, None] - centros[None]) ** 2).sum(2), 1)
        paleta = np.array([np.average(cores[r == j], 0, area[r == j]) if (r == j).any() else [0.5] * 3 for j in range(len(centros))])
    plab = to_lab(paleta)
    rotulo = np.argmin(((lab[:, None] - plab[None]) ** 2).sum(2), 1)
    if a.limpar > 0:
        rotulo = limpar_pontinhos(F, rotulo, a.limpar)

    base = os.path.splitext(caminho)[0] + "_bambu"
    if a.saida:
        os.makedirs(a.saida, exist_ok=True)
        base = os.path.join(a.saida, os.path.basename(base))
    usados = salvar(P, F, rotulo, paleta, base)
    print(f"  {len(F):,} triangulos, altura {np.ptp(P[:, 2]):.1f} mm".replace(",", "."))
    for j in usados:
        pct = area[rotulo == j].sum() / area.sum() * 100
        print(f"  cor{j + 1}: #{''.join(f'{int(round(v * 255)):02x}' for v in paleta[j])} ({nome_cor(paleta[j])}) - {pct:.0f}% da superficie")
    if not a.sem_previa:
        previa_png(P, F, paleta[rotulo], base + "_previa.png")
    print(f"  salvo: {base}.obj  (+ .mtl" + ("" if a.sem_previa else ", _previa.png") + ")")

def main():
    ap = argparse.ArgumentParser(description="Converte boneco 3D com textura em OBJ ja pintado pro Bambu Studio.")
    ap.add_argument("entrada", nargs="+", help="arquivo(s) .glb/.gltf/.obj ou uma pasta")
    ap.add_argument("--cores", type=int, default=4, help="quantas cores/filamentos usar (padrao 4)")
    ap.add_argument("--paleta", help='cores exatas dos seus filamentos, ex: "#ffffff,#000000,#ff0000"')
    ap.add_argument("--altura", type=float, help="altura final em mm (ex: 100)")
    ap.add_argument("--detalhe", type=float, default=200, help="quanto mais alto, mais fina a borda entre cores (padrao 200)")
    ap.add_argument("--max-triangulos", type=int, default=600000, help="limite de triangulos (padrao 600000)")
    ap.add_argument("--limpar", type=int, default=3, help="passadas para remover pontinhos isolados (0 desliga)")
    ap.add_argument("--sem-girar", action="store_true", help="nao converter Y-pra-cima em Z-pra-cima")
    ap.add_argument("--sem-previa", action="store_true", help="nao gerar a imagem de previa")
    ap.add_argument("--saida", help="pasta de saida (padrao: ao lado do arquivo original)")
    a = ap.parse_args()
    if a.paleta: a.cores = len(a.paleta.split(","))

    arquivos = []
    for e in a.entrada:
        if os.path.isdir(e):
            for raiz, _, fs in os.walk(e):
                for f in fs:
                    if f.lower().endswith((".glb", ".gltf", ".obj")) and not f.lower().endswith("_bambu.obj"):
                        arquivos.append(os.path.join(raiz, f))
        else:
            arquivos.append(e)
    if not arquivos:
        print("Nenhum arquivo .glb/.gltf/.obj encontrado."); return 1
    erros = 0
    for f in arquivos:
        try:
            processar(f, a)
        except Exception as ex:
            erros += 1
            print(f"  ERRO em {f}: {ex}")
    print("\nPronto! No Bambu Studio: Arquivo > Importar > escolha o *_bambu.obj e associe as cores aos filamentos.")
    return 1 if erros else 0

if __name__ == "__main__":
    sys.exit(main())
