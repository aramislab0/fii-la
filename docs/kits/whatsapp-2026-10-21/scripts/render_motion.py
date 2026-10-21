"""Rebuild camera-motion drafts; run from this directory with ffmpeg installed.

Bundled Montserrat fonts are used by default; --repo can override them.
No generative video service, credentials or customer data are used.
"""
from pathlib import Path
import argparse
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--repo', type=Path)
parser.add_argument('--scene', choices=['signature', 'commerce', 'evenement'])
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
bold = (args.repo / 'web/fonts/montserrat-latin-700-normal.woff2') if args.repo else root / 'assets/fonts/montserrat-700.woff2'
semibold = (args.repo / 'web/fonts/montserrat-latin-600-normal.woff2') if args.repo else root / 'assets/fonts/montserrat-600.woff2'
scenes = [
    ('signature', 'À la bonne', 'porte.', 'Ton adresse,', 'expliquée une seule fois.'),
    ('commerce', 'Le sens', 'du détail.', 'Votre boutique.', 'Votre attention.'),
    ('evenement', 'Le plaisir', 'de se retrouver.', 'La bonne entrée.', 'Le début de la rencontre.'),
]
for name, line1, line2, sub1, sub2 in scenes:
    if args.scene and name != args.scene:
        continue
    filters = (
        "[0:v]scale=3072:2048,zoompan=z='1.025+0.0125*(1-cos(2*PI*on/150))':"
        "x='iw/2-iw/(2*zoom)+10*sin(2*PI*on/150)':y='ih/2-ih/(2*zoom)':"
        "d=150:s=1200x800:fps=30,eq=brightness='0.003*(1-cos(2*PI*t/5))':eval=frame[photo];"
        "[1:v]format=rgba,colorkey=0x1E4A34:0.12:0.04,scale=62:62[logo];"
        "[photo][logo]overlay=x=52:y=58:shortest=1,"
        f"drawtext=fontfile={bold}:text='Fii La':fontsize=38:fontcolor=0xF5F2EA:x=123:y=70,"
        f"drawtext=fontfile={bold}:text='{line1}':fontsize=52:fontcolor=0xF5F2EA:x=62:y=320,"
        f"drawtext=fontfile={bold}:text='{line2}':fontsize=52:fontcolor=0xF5F2EA:x=62:y=386,"
        f"drawtext=fontfile={semibold}:text='{sub1}':fontsize=23:fontcolor=0xC9E265:x=65:y=491,"
        f"drawtext=fontfile={semibold}:text='{sub2}':fontsize=23:fontcolor=0xC9E265:x=65:y=526,format=yuv420p[v]"
    )
    subprocess.run([
        'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
        '-loop', '1', '-i', str(root / 'assets/photos' / (name + '.png')),
        '-loop', '1', '-i', str(root / 'assets/brand/fiila-logo-source.png'),
        '-filter_complex', filters, '-map', '[v]', '-t', '5', '-an',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart',
        str(root / 'assets/animations' / (name + '.mp4')),
    ], check=True)
