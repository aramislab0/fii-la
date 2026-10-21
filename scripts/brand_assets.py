#!/usr/bin/env python3
"""Fii — dérive les fichiers de marque du logo validé (docs/brand/fii-logo-source.png, fondateur, 21/10/2026).

Le logo n'est pas redessiné : on le recadre et on le met à l'échelle. Couleurs du source : fond #1E4A34, lettres #F5F2EA,
épingle #C9E265.
Sorties :
  web/media/brand/fii-logo.png      logo seul sur fond transparent (pour les surfaces vertes : cartes WhatsApp…)
  web/icons/icon-512.png, icon-192.png, apple-touch-icon.png (180), favicon-64.png   carré vert, logo centré
  web/icons/icon-maskable-512.png   logo réduit dans la zone sûre (Android)
  web/media/brand/fii-logo-mask.png forme monochrome sans fond (colorée par l'application : vert / ivoire)
Usage : python3 scripts/brand_assets.py
"""
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'docs', 'brand', 'fii-logo-source.png')
BG = np.array([30, 74, 52], float)
FG = [np.array([245, 242, 234], float), np.array([201, 226, 101], float)]


def logo_rgba():
    """Logo détouré : pour chaque pixel, couleur pleine la plus proche et part de couverture (bords lissés conservés)."""
    a = np.asarray(Image.open(SRC).convert('RGB')).astype(float)
    best_alpha = np.zeros(a.shape[:2])
    best_col = np.zeros(a.shape)
    best_err = np.full(a.shape[:2], np.inf)
    for fg in FG:
        v = fg - BG
        t = np.clip(((a - BG) @ v) / (v @ v), 0, 1)
        err = np.linalg.norm(a - (BG + t[..., None] * v), axis=2)
        m = err < best_err
        best_err[m], best_alpha[m] = err[m], t[m]
        best_col[m] = fg
    out = np.dstack([best_col, best_alpha * 255]).clip(0, 255).astype(np.uint8)
    img = Image.fromarray(out, 'RGBA')
    return img.crop(img.getchannel('A').point(lambda x: 255 if x > 8 else 0).getbbox())


def square(logo, side, ratio):
    """Carré vert ; le logo occupe `ratio` de la hauteur, centré optiquement."""
    h = round(side * ratio)
    w = round(logo.width * h / logo.height)
    tile = Image.new('RGBA', (side, side), tuple(int(c) for c in BG) + (255,))
    lg = logo.resize((w, h), Image.LANCZOS)
    tile.alpha_composite(lg, ((side - w) // 2, (side - h) // 2))
    return tile.convert('RGB')


def main():
    logo = logo_rgba()
    os.makedirs(os.path.join(ROOT, 'web', 'media', 'brand'), exist_ok=True)
    h = 240
    logo.resize((round(logo.width * h / logo.height), h), Image.LANCZOS).save(os.path.join(ROOT, 'web', 'media', 'brand', 'fii-logo.png'), optimize=True)
    icons = os.path.join(ROOT, 'web', 'icons')
    for name, side, ratio in [('icon-512.png', 512, .58), ('icon-192.png', 192, .58), ('apple-touch-icon.png', 180, .58),
                              ('favicon-64.png', 64, .70), ('icon-maskable-512.png', 512, .46)]:
        square(logo, side, ratio).save(os.path.join(icons, name), optimize=True)
    # Version monochrome (masque) : la forme exacte du logo, sans fond ; l'application la colore selon la surface
    # (vert sur fond clair, ivoire sur fond sombre ou vert). La porte de l'épingle reste ajourée.
    m = logo.resize((round(logo.width * h / logo.height), h), Image.LANCZOS)
    mono = Image.new('RGBA', m.size, (255, 255, 255, 0))
    mono.putalpha(m.getchannel('A'))
    mono.save(os.path.join(ROOT, 'web', 'media', 'brand', 'fii-logo-mask.png'), optimize=True)
    print('logo', logo.size)


if __name__ == '__main__':
    main()
