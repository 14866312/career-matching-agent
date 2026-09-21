"""Create a text PDF from the fictional TXT. Requires reportlab for sample generation."""
from pathlib import Path
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.pagesizes import A4
from xml.sax.saxutils import escape
root = Path(__file__).resolve().parents[1] / 'samples'
font = Path('C:/Windows/Fonts/simhei.ttf')
if not font.exists():
    raise SystemExit('Set font to a local embeddable Chinese TTF before regenerating this PDF.')
pdfmetrics.registerFont(TTFont('SampleChinese', str(font)))
body = ParagraphStyle('body', fontName='SampleChinese', fontSize=12, leading=21, spaceAfter=14)
title = ParagraphStyle('title', parent=body, fontSize=20, leading=28, spaceAfter=24)
lines = (root / '虚构简历.txt').read_text(encoding='utf-8').splitlines()
doc = SimpleDocTemplate(str(root / '虚构简历.pdf'), pagesize=A4, leftMargin=54, rightMargin=54, topMargin=54, bottomMargin=54, title='虚构学生演示简历', author='Career Compass')
doc.build([Paragraph(escape(line), title if i == 0 else body) for i, line in enumerate(lines)])
print('Fictional text PDF generated.')
