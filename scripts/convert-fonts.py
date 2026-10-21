"""Create TrueType copies of the owned CFF fonts for the dotLottie renderer.
Original fonts remain unchanged. No font substitution or metric scaling.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path('.tools/font-converter').resolve()))
from fontTools.ttLib import TTFont
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen

for name in ('BeninSemiBold-Regular', 'SuisseIntl'):
    font = TTFont(f'public/fonts/{name}.otf')
    glyph_set = font.getGlyphSet()
    glyphs = {}
    for glyph_name in font.getGlyphOrder():
        pen = TTGlyphPen(glyph_set)
        glyph_set[glyph_name].draw(Cu2QuPen(pen, max_err=0.25, reverse_direction=True))
        glyphs[glyph_name] = pen.glyph()
    del font['CFF ']
    font.sfntVersion = '\x00\x01\x00\x00'
    builder = FontBuilder(font=font)
    builder.isTTF = True
    builder.setupGlyf(glyphs)
    builder.setupMaxp()
    font['post'].formatType = 2.0
    font['post'].extraNames = []
    font['post'].mapping = {}
    font.save(f'public/fonts/{name}.ttf')
    print(name, len(glyphs), 'glyphs; original names, metrics and Unicode mapping retained')
