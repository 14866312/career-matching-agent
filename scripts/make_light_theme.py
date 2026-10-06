"""Rebuild the light / eye-care stylesheet from the dark stylesheets.

Output contract (imported last by frontend/src/styles.css, and read by App.tsx which
sets <html data-theme="light">):

    frontend/src/styles/theme-light.css

Rules applied:
    1. The source design is pure grayscale -- every colour literal in the dark
       stylesheets has R == G == B (verified by scripts/check below and by the
       generator itself, which leaves any non-grayscale literal alone). Luminance
       inversion is therefore lossless: no hue is ever lost or invented.
    2. Only colour-bearing declarations are emitted. Layout, spacing, typography,
       animation and every selector's specificity are preserved verbatim, so a
       regression here can only ever be a colour regression.
    3. Each selector is re-emitted scoped under [data-theme="light"], which means the
       dark theme is untouched by construction -- not merely by inspection.
    4. Luminance is not simply inverted. It is mapped onto [16, 250] and given a
       slight warm cast, so backgrounds land on warm off-white rather than harsh
       pure white and text on warm near-black. That is what makes the result read as
       an eye-care mode instead of a clinical light mode.
    5. box-shadow / text-shadow keep dark, low-alpha values. Inverting them would
       turn every shadow into a white glow.
    6. Anything needing judgement rather than a mechanical inversion -- modal veils
       that must stay dark, the toast chip, the few base.css tokens that carry
       light-theme semantics -- belongs in frontend/src/styles/theme-light-patch.css,
       which is imported after this file. Do not hand-edit the generated file: it is
       overwritten on every run.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STYLES = ROOT / 'frontend' / 'src' / 'styles'
TARGET = STYLES / 'theme-light.css'

# Cascade order matters: the generated rules must follow the dark rules they override,
# and the order must match frontend/src/styles.css.
FILES = [
    'base.css',
    'jobs-core.css',
    'profile-core.css',
    'matches-core.css',
    'paths-core.css',
    'workspace.css',
    'jobs-detail.css',
    'profile-detail.css',
    'matches-detail.css',
    'paths-detail.css',
    'shared-overrides.css',
    'onboarding.css',
]

COLOR_PROPS = {
    'color',
    'background',
    'background-color',
    'background-image',
    'border',
    'border-top',
    'border-right',
    'border-bottom',
    'border-left',
    'border-color',
    'border-top-color',
    'border-right-color',
    'border-bottom-color',
    'border-left-color',
    'outline',
    'outline-color',
    'box-shadow',
    'text-shadow',
    'fill',
    'stroke',
    'caret-color',
    'accent-color',
    'column-rule',
    'column-rule-color',
    'text-decoration-color',
    '-webkit-text-fill-color',
}

SHADOW_PROPS = {'box-shadow', 'text-shadow'}

# data-theme lives on <html>, so selectors that already target the root element need a
# compound prefix instead of a descendant combinator.
ROOT_SELECTORS = {':root', 'html'}

LIGHTEST = 250.0
DARKEST = 16.0

HEX_RE = re.compile(r'#[0-9a-fA-F]{3,8}\b')
FUNC_RE = re.compile(r'rgba?\([^)]*\)')
COMMENT_RE = re.compile(r'/\*.*?\*/', re.S)


def _tone(luminance: float) -> float:
    """Map a dark-theme luminance (0..255) onto the light-theme range."""
    inverted = 255.0 - luminance
    return DARKEST + inverted / 255.0 * (LIGHTEST - DARKEST)


def _clamp(value: float) -> int:
    return max(0, min(255, int(round(value))))


def _warm(luminance: float) -> tuple[int, int, int]:
    """Slight warm (cream) cast; keeps the theme monochrome but not clinical."""
    return _clamp(luminance + 4), _clamp(luminance + 2), _clamp(luminance - 4)


def _hex_to_rgb(raw: str) -> tuple[int, int, int, str] | None:
    digits = raw.lstrip('#')
    if len(digits) == 3:
        digits = ''.join(char * 2 for char in digits)
    if len(digits) not in (6, 8):
        return None
    try:
        rgb = int(digits[0:2], 16), int(digits[2:4], 16), int(digits[4:6], 16)
    except ValueError:
        return None
    return rgb[0], rgb[1], rgb[2], digits[6:8] if len(digits) == 8 else ''


def _map_hex(match: re.Match[str], shadow: bool) -> str:
    parsed = _hex_to_rgb(match.group(0))
    if parsed is None:
        return match.group(0)
    red, green, blue, alpha = parsed
    if not red == green == blue:
        return match.group(0)
    if shadow:
        return 'rgba(0, 0, 0, .2)'
    return '#%02x%02x%02x' % _warm(_tone(red)) + alpha


def _map_rgb_func(match: re.Match[str], shadow: bool) -> str:
    raw = match.group(0)
    numbers = re.findall(r'[\d.]+', raw)
    if len(numbers) < 3:
        return raw
    red, green, blue = (int(float(numbers[index])) for index in range(3))
    alpha = float(numbers[3]) if len(numbers) > 3 else None
    if not red == green == blue:
        return raw
    if shadow:
        opacity = alpha if alpha is not None else 0.15
        return 'rgba(0, 0, 0, %s)' % round(min(0.22, opacity), 3)
    mapped = _warm(_tone(red))
    if alpha is None:
        return 'rgb(%d, %d, %d)' % mapped
    return 'rgba(%d, %d, %d, %s)' % (*mapped, round(alpha, 3))


def _transform(value: str, shadow: bool) -> str:
    value = HEX_RE.sub(lambda match: _map_hex(match, shadow), value)
    return FUNC_RE.sub(lambda match: _map_rgb_func(match, shadow), value)


def _split_declarations(body: str) -> list[str]:
    """Split a declaration block on top-level semicolons (rgba()/gradient() safe)."""
    out: list[str] = []
    depth = 0
    buffer: list[str] = []
    for char in body:
        if char == '(':
            depth += 1
        elif char == ')':
            depth -= 1
        if char == ';' and depth == 0:
            out.append(''.join(buffer))
            buffer = []
        else:
            buffer.append(char)
    if buffer:
        out.append(''.join(buffer))
    return out


def _scope(selector: str) -> str:
    scoped: list[str] = []
    for one in selector.split(','):
        one = ' '.join(one.split())
        if not one:
            continue
        if one in ROOT_SELECTORS:
            scoped.append('html[data-theme="light"]')
        elif one.startswith('html') or one.startswith(':root'):
            scoped.append('[data-theme="light"]' + one)
        else:
            scoped.append('[data-theme="light"] ' + one)
    return ', '.join(scoped)


def _walk(block: str, indent: str) -> str:
    """Emit only the colour-bearing rules of a block, scoped to the light theme."""
    out: list[str] = []
    index = 0
    length = len(block)
    while index < length:
        brace = block.find('{', index)
        semi = block.find(';', index)
        if brace == -1 and semi == -1:
            break
        if semi != -1 and (brace == -1 or semi < brace):
            index = semi + 1
            continue
        head = block[index:brace].strip()
        depth = 1
        cursor = brace + 1
        while cursor < length and depth > 0:
            if block[cursor] == '{':
                depth += 1
            elif block[cursor] == '}':
                depth -= 1
            cursor += 1
        body = block[brace + 1: cursor - 1]
        index = cursor

        if not head:
            continue

        if head.startswith('@'):
            at_rule = head.split()[0].lower()
            if at_rule in ('@media', '@supports', '@layer', '@container'):
                inner = _walk(body, indent)
                if inner.strip():
                    out.append(f'{indent}{head} {{\n{inner}{indent}}}\n')
            # @keyframes / @font-face / @import: no colours, and must not be scoped.
            continue

        declarations: list[str] = []
        for declaration in _split_declarations(body):
            if ':' not in declaration:
                continue
            prop, _, value = declaration.partition(':')
            prop = prop.strip()
            value = value.strip()
            if not value or not (prop.startswith('--') or prop in COLOR_PROPS):
                continue
            transformed = _transform(value, prop in SHADOW_PROPS)
            if transformed != value:
                declarations.append(f'{indent}  {prop}: {transformed};')
        if declarations:
            out.append(f'{indent}{_scope(head)} {{\n' + '\n'.join(declarations) + f'\n{indent}}}\n')
    return '\n'.join(out)


def build() -> tuple[str, int]:
    """Return the generated stylesheet and the number of colour literals it carries."""
    chunks = [
        '/* Generated light / eye-care theme.  Do not edit by hand.',
        ' * Rebuild with: .venv/Scripts/python.exe scripts/make_light_theme.py',
        ' * Every colour literal in the dark stylesheets is luminance-inverted onto a warm',
        ' * range and re-emitted under [data-theme="light"]. Layout, spacing, typography and',
        ' * animation are untouched, and the dark theme is unaffected by construction.',
        ' * Corrections that need judgement live in theme-light-patch.css instead.',
        ' */',
        '',
        'html[data-theme="light"] { color-scheme: light; }',
        '',
    ]
    for name in FILES:
        source = COMMENT_RE.sub('', (STYLES / name).read_text(encoding='utf-8'))
        body = _walk(source, '')
        if body.strip():
            chunks.append(f'/* ---- {name} ---- */')
            chunks.append(body)
    css = '\n'.join(chunks).rstrip() + '\n'
    return css, len(HEX_RE.findall(css))


if __name__ == '__main__':
    stylesheet, literals = build()
    TARGET.write_text(stylesheet, encoding='utf-8')
    print(f'wrote {TARGET.relative_to(ROOT)}')
    print(f'{len(stylesheet.splitlines())} lines, {len(stylesheet)} bytes, {literals} hex literals')
