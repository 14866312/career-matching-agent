'''Build a Chinese text PDF from the fictional TXT with ReportLab.'''

from __future__ import annotations

import argparse
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = ROOT / 'samples'
FONT_NAME = 'STSong-Light'


def build_pdf(text_path: Path | str, pdf_path: Path | str) -> None:
    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        from reportlab.platypus import Paragraph, SimpleDocTemplate
    except ModuleNotFoundError as error:
        raise SystemExit(
            'Install the PDF sample tool with .venv/Scripts/python.exe -m pip install -r requirements.samples.txt.'
        ) from error

    if FONT_NAME not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(UnicodeCIDFont(FONT_NAME))
    body = ParagraphStyle('body', fontName=FONT_NAME, fontSize=12, leading=21, spaceAfter=14)
    title = ParagraphStyle('title', parent=body, fontSize=20, leading=28, spaceAfter=24)
    lines = Path(text_path).read_text(encoding='utf-8').splitlines()
    document = SimpleDocTemplate(
        str(pdf_path),
        pagesize=A4,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54,
        title='虚构学生演示简历',
        author='Student Career Planning',
    )
    document.build([Paragraph(escape(line), title if index == 0 else body) for index, line in enumerate(lines)])


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=DEFAULT_OUTPUT_DIR / '虚构简历.txt')
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT_DIR / '虚构简历.pdf')
    return parser.parse_args(argv)


def main(argv=None) -> None:
    args = parse_args(argv)
    build_pdf(args.input, args.output)
    print(f'Fictional text PDF generated at {args.output}.')


if __name__ == '__main__':
    main()
