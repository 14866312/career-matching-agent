from io import BytesIO
from pathlib import Path
from zipfile import ZipFile
from docx import Document
from docx.oxml.ns import qn
from pypdf import PdfReader
from .llm import AIError

MAX_BYTES = 5 * 1024 * 1024
MAX_CHARS = 30000


def extract_text(filename, content):
    if len(content) > MAX_BYTES:
        raise AIError('FILE_TOO_LARGE', '简历不能超过5 MB，请精简后重试。')
    if not content:
        raise AIError('FILE_EMPTY', '文件为空，请选择有效简历。')
    suffix = Path(filename or '').suffix.lower()
    if suffix not in ('.pdf', '.docx', '.txt'):
        raise AIError('FILE_TYPE', '仅支持文本型 PDF、DOCX、TXT。')
    try:
        if suffix == '.txt':
            try:
                text = content.decode('utf-8-sig')
            except UnicodeDecodeError:
                text = content.decode('gb18030')
            if any(ord(ch) < 32 and ch not in '\n\r\t\f' for ch in text):
                raise ValueError('binary text')
        elif suffix == '.pdf':
            reader = PdfReader(BytesIO(content))
            if reader.is_encrypted:
                raise AIError('FILE_ENCRYPTED', 'PDF已加密，请先解除保护或换用TXT。')
            if len(reader.pages) > 50:
                raise AIError('FILE_TOO_LONG', 'PDF超过50页，请精简简历。')
            chunks = []
            for page in reader.pages:
                chunks.append(page.extract_text() or '')
                if sum(map(len, chunks)) > MAX_CHARS:
                    raise AIError('FILE_TOO_LONG', '简历文字超过30000字符，请精简后重试。')
            text = '\n'.join(chunks)
        else:
            with ZipFile(BytesIO(content)) as z:
                info = z.getinfo('word/document.xml')
                if info.file_size > 10 * 1024 * 1024 or sum(i.file_size for i in z.infolist()) > 20 * 1024 * 1024:
                    raise AIError('FILE_TOO_LARGE', 'DOCX解压内容过大，请精简文件。')
                raw = z.read(info)
                if b'<!DOCTYPE' in raw or b'<!ENTITY' in raw:
                    raise ValueError('unsupported xml')
            document = Document(BytesIO(content))
            paragraphs = []
            for p in document.element.body.iter(qn('w:p')):
                paragraphs.append(''.join((node.text or '') if node.tag == qn('w:t') else (' ' if node.tag == qn('w:tab') else '\n' if node.tag == qn('w:br') else '') for node in p.iter()))
            text = '\n'.join(paragraphs)
    except AIError:
        raise
    except Exception as exc:
        raise AIError('FILE_UNREADABLE', '文件损坏或编码不支持，请换用有效文件或手动填写。') from exc
    text = text.strip()
    if len(text) < 10:
        raise AIError('FILE_NO_TEXT', '未提取到足够文字；扫描件暂不支持，请使用文本型简历或手动填写。')
    if len(text) > MAX_CHARS:
        raise AIError('FILE_TOO_LONG', '简历文字超过30000字符，请精简后重试。')
    return text
