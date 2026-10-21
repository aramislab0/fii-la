#!/usr/bin/env python3
"""Fii — rendu déterministe des cartes WhatsApp (mandat WHATSAPP-001).

Sources : photos du kit (docs/kits/whatsapp-2026-10-21/assets/photos/), textes du catalogue
(docs/kits/whatsapp-2026-10-21/docs/design/whatsapp/catalogue.json), police Montserrat (@fontsource).
Sortie : web/media/wa/<fichier>.jpg — aucune IA appelée, mêmes entrées = même image.
Usage : python3 scripts/render_wa_cards.py        (régénère toutes les cartes déclarées dans CARDS)
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KIT = os.path.join(ROOT, 'docs', 'kits', 'whatsapp-2026-10-21')
FONTS = os.path.join(ROOT, 'node_modules', '@fontsource', 'montserrat', 'files')
OUT = os.path.join(ROOT, 'web', 'media', 'wa')

GREEN = (30, 74, 52)
LIME = (201, 226, 101)
IVORY = (245, 242, 234)
W, H = 1200, 800

# Une entrée par carte. Les textes viennent du catalogue (template), sauf ce qui est propre au rendu (photo, cadrage).
CARDS = [
    {'file': 'demande-adresse.jpg', 'template': 'fiila_address_request_v1', 'photo': 'signature.png',
     # Cadrage : la photo garde la porte, la cliente et le livreur à droite ; le portail vert à gauche accueille le texte.
     'focus_x': 0.5},
]


def font(weight, size):
    return ImageFont.truetype(os.path.join(FONTS, f'montserrat-latin-{weight}-normal.woff'), size)


def cover(img, w, h, focus_x):
    s = max(w / img.width, h / img.height)
    img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    x = round((img.width - w) * focus_x)
    y = (img.height - h) // 2
    return img.crop((x, y, x + w, y + h))


def wrap(draw, text, f, max_w):
    lines, cur = [], ''
    for word in text.split():
        trial = (cur + ' ' + word).strip()
        if draw.textlength(trial, font=f) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def render(card, tpl):
    photo = Image.open(os.path.join(KIT, 'assets', 'photos', card['photo'])).convert('RGB')
    base = cover(photo, W, H, card.get('focus_x', 0.5)).convert('RGBA')

    # Dégradé vert de gauche : opaque sous le texte, transparent avant les personnes.
    grad = Image.new('RGBA', (W, H))
    gd = ImageDraw.Draw(grad)
    solid, fade = int(W * 0.30), int(W * 0.56)
    for x in range(W):
        if x <= solid:
            a = 236
        elif x >= fade:
            a = 0
        else:
            t = (x - solid) / (fade - solid)
            a = round(236 * (1 - t) ** 1.6)
        gd.line([(x, 0), (x, H)], fill=GREEN + (a,))
    img = Image.alpha_composite(base, grad)
    d = ImageDraw.Draw(img)

    x0, col = 72, 470
    # Logo Fii validé (web/media/brand/fii-logo.png, dérivé de docs/brand/fii-logo-source.png), sans redessin.
    logo = Image.open(os.path.join(ROOT, 'web', 'media', 'brand', 'fii-logo.png')).convert('RGBA')
    lh = 88
    logo = logo.resize((round(logo.width * lh / logo.height), lh), Image.LANCZOS)
    img.alpha_composite(logo, (x0, 52))
    d = ImageDraw.Draw(img)

    # Kicker, titre, détail
    y = 300
    d.text((x0, y), tpl['kicker'], font=font(700, 22), fill=LIME, spacing=0)
    y += 50
    ft = font(800, 60)
    for line in wrap(d, tpl['artwork_title'], ft, col):
        d.text((x0, y), line, font=ft, fill=IVORY)
        y += 72
    y += 14
    d.rectangle((x0, y, x0 + 56, y + 5), fill=LIME)
    y += 30
    fd = font(600, 28)
    for line in wrap(d, tpl['artwork_detail'], fd, col):
        d.text((x0, y), line, font=fd, fill=IVORY)
        y += 40
    if y > H - 60:
        raise SystemExit(f"{card['file']} : texte trop long pour la carte")
    return img.convert('RGB')


def main():
    cat = json.load(open(os.path.join(KIT, 'docs', 'design', 'whatsapp', 'catalogue.json'), encoding='utf-8'))
    tpls = {t['id']: t for t in cat['templates']}
    os.makedirs(OUT, exist_ok=True)
    for card in CARDS:
        img = render(card, tpls[card['template']])
        path = os.path.join(OUT, card['file'])
        img.save(path, 'JPEG', quality=84, optimize=True, progressive=True)
        print(path, os.path.getsize(path), 'octets', file=sys.stderr)


if __name__ == '__main__':
    main()
