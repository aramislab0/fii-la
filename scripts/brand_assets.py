#!/usr/bin/env python3
"""Fii — dérive les fichiers de marque du logo validé (docs/brand/fii-logo-source.png, fondateur, 21/10/2026).

Le logo n'est pas redessiné : on le détoure, on le vectorise et on le met à l'échelle. Couleurs du source : fond #1E4A34,
lettres #F5F2EA, épingle #C9E265. Règle (fondateur, 21/10 09:36) : le logo se pose SANS FOND sur les pages.
  - fond sombre ou vert : lettres ivoire #F5F2EA, épingle lime #C9E265 (la version d'origine) ;
  - fond clair          : lettres vert #1E4A34, épingle lime #C9E265 ;
  - monochrome          : tout vert (fond clair) ou tout ivoire (fond sombre), pour les usages à une couleur.
Sorties :
  web/media/brand/fii-letters.png, fii-pin.png   masques (même cadre) colorés par l'application selon la surface
  web/media/brand/fii-logo.png                   version d'origine sans fond (cartes WhatsApp, surfaces vertes)
  docs/brand/fii-logo-{sombre,clair,mono-vert,mono-ivoire}.svg   fichiers vectoriels pour tout autre usage
  web/favicon.svg                                favicon sans fond, s'adapte au thème clair / sombre de l'onglet
  web/icons/favicon-32.png                       favicon de secours (navigateurs sans SVG) : version claire sans fond
  web/icons/icon-512.png, icon-192.png, apple-touch-icon.png, icon-maskable-512.png
                                                 icônes d'application : le système impose un fond, carré vert
Usage : python3 scripts/brand_assets.py
"""
import os

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'docs', 'brand', 'fii-logo-source.png')
BG = np.array([30, 74, 52], float)
FG = [np.array([245, 242, 234], float), np.array([201, 226, 101], float)]
GREEN, IVORY, LIME = '#1E4A34', '#F5F2EA', '#C9E265'


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


def split(logo):
    """Deux masques (lettres, épingle) de même cadre."""
    a = np.asarray(logo).astype(float)
    pin = np.linalg.norm(a[..., :3] - FG[1], axis=2) < np.linalg.norm(a[..., :3] - FG[0], axis=2)
    al = a[..., 3]
    return np.where(pin, 0, al).astype(np.uint8), np.where(pin, al, 0).astype(np.uint8)


def mask_png(alpha, h, path):
    im = Image.fromarray(alpha, 'L')
    im = im.resize((round(im.width * h / im.height), h), Image.LANCZOS)
    out = Image.new('RGBA', im.size, (255, 255, 255, 0))
    out.putalpha(im)
    out.save(path, optimize=True)


def svg_path(alpha):
    """Contours vectoriels (trous compris, règle evenodd) d'un masque."""
    big = cv2.resize(alpha, None, fx=4, fy=4, interpolation=cv2.INTER_CUBIC)
    _, bw = cv2.threshold(big, 127, 255, cv2.THRESH_BINARY)
    contours, _ = cv2.findContours(bw, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    parts = []
    for c in contours:
        c = cv2.approxPolyDP(c, 1.6, True)
        if len(c) < 3:
            continue
        pts = [f'{p[0][0] / 4:.2f} {p[0][1] / 4:.2f}' for p in c]
        parts.append('M' + ' L'.join(pts) + 'Z')
    return ' '.join(parts)


def svg(w, h, letters, pin, ink, pin_col):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">'
            f'<path fill="{ink}" fill-rule="evenodd" d="{letters}"/>'
            f'<path fill="{pin_col}" fill-rule="evenodd" d="{pin}"/></svg>\n')


def square(logo, side, ratio):
    """Icône d'application : carré vert ; le logo occupe `ratio` de la hauteur, centré."""
    h = round(side * ratio)
    w = round(logo.width * h / logo.height)
    tile = Image.new('RGBA', (side, side), tuple(int(c) for c in BG) + (255,))
    tile.alpha_composite(logo.resize((w, h), Image.LANCZOS), ((side - w) // 2, (side - h) // 2))
    return tile.convert('RGB')


def main():
    logo = logo_rgba()
    brand = os.path.join(ROOT, 'web', 'media', 'brand')
    os.makedirs(brand, exist_ok=True)
    letters, pin = split(logo)
    h = 240
    logo.resize((round(logo.width * h / logo.height), h), Image.LANCZOS).save(os.path.join(brand, 'fii-logo.png'), optimize=True)
    mask_png(letters, h, os.path.join(brand, 'fii-letters.png'))
    mask_png(pin, h, os.path.join(brand, 'fii-pin.png'))

    w, hh = logo.width, logo.height
    pl, pp = svg_path(letters), svg_path(pin)
    docs = os.path.join(ROOT, 'docs', 'brand')
    for name, ink, pc in [('sombre', IVORY, LIME), ('clair', GREEN, LIME), ('mono-vert', GREEN, GREEN), ('mono-ivoire', IVORY, IVORY)]:
        open(os.path.join(docs, f'fii-logo-{name}.svg'), 'w').write(svg(w, hh, pl, pp, ink, pc))
    # Favicon : carré centré, sans fond ; version claire par défaut, version sombre si l'onglet est sombre.
    side = max(w, hh)
    fav = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-(side - w) / 2:.1f} {-(side - hh) / 2:.1f} {side} {side}">'
           f'<style>.l{{fill:{GREEN}}}.p{{fill:{LIME}}}@media (prefers-color-scheme:dark){{.l{{fill:{IVORY}}}}}</style>'
           f'<path class="l" fill-rule="evenodd" d="{pl}"/><path class="p" fill-rule="evenodd" d="{pp}"/></svg>\n')
    open(os.path.join(ROOT, 'web', 'favicon.svg'), 'w').write(fav)

    icons = os.path.join(ROOT, 'web', 'icons')
    # Favicon PNG de secours, sans fond, version claire (la plupart des onglets sont clairs).
    light = np.zeros((hh, w, 4), np.uint8)
    light[..., :3] = np.where((pin > letters)[..., None], np.array([201, 226, 101]), np.array([30, 74, 52]))
    light[..., 3] = np.maximum(letters, pin)
    li = Image.fromarray(light, 'RGBA')
    fav32 = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    fav32.alpha_composite(li, ((side - w) // 2, (side - hh) // 2))
    fav32.resize((32, 32), Image.LANCZOS).save(os.path.join(icons, 'favicon-32.png'), optimize=True)
    for name, s, ratio in [('icon-512.png', 512, .58), ('icon-192.png', 192, .58), ('apple-touch-icon.png', 180, .58),
                           ('icon-maskable-512.png', 512, .46)]:
        square(logo, s, ratio).save(os.path.join(icons, name), optimize=True)
    print('logo', logo.size, 'svg', len(pl) + len(pp), 'octets de tracé')


if __name__ == '__main__':
    main()
