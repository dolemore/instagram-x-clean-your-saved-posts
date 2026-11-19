"""Draw the extension icons (16, 48 and 128 px PNG) with the standard library only.

    python store/make_icons.py

Writes extension/icons/icon16.png, icon48.png and icon128.png: a download arrow
dropping into a tray on a rounded indigo square.
"""

import struct
import zlib
from pathlib import Path

SIZES = (16, 48, 128)
GRID = 128  # the artwork is defined on a 128 x 128 grid and scaled down
TOP = (99, 102, 241)
BOTTOM = (67, 56, 202)


def in_rect(x, y, x0, y0, x1, y1):
    return x0 <= x <= x1 and y0 <= y <= y1


def in_round_rect(x, y, x0, y0, x1, y1, radius):
    if not in_rect(x, y, x0, y0, x1, y1):
        return False
    cx = min(max(x, x0 + radius), x1 - radius)
    cy = min(max(y, y0 + radius), y1 - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius


def in_triangle(x, y, a, b, c):
    def side(p, q, r):
        return (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])

    p = (x, y)
    d1, d2, d3 = side(p, a, b), side(p, b, c), side(p, c, a)
    has_neg = d1 < 0 or d2 < 0 or d3 < 0
    has_pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_neg and has_pos)


def in_glyph(x, y):
    return (in_rect(x, y, 55, 20, 73, 66)                       # arrow shaft
            or in_triangle(x, y, (32, 58), (96, 58), (64, 94))  # arrow head
            or in_rect(x, y, 24, 82, 36, 108)                   # tray, left wall
            or in_rect(x, y, 92, 82, 104, 108)                  # tray, right wall
            or in_rect(x, y, 24, 96, 104, 108))                 # tray, base


def sample(x, y):
    """RGBA of the artwork at one point of the 128-grid."""
    if not in_round_rect(x, y, 0, 0, GRID, GRID, 28):
        return (0, 0, 0, 0)
    if in_glyph(x, y):
        return (255, 255, 255, 255)
    t = y / GRID
    r, g, b = (round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
    return (r, g, b, 255)


def render(size, samples=4):
    scale = GRID / size
    raw = bytearray()
    for py in range(size):
        raw.append(0)  # PNG filter type: none
        for px in range(size):
            r = g = b = alpha = 0
            for sy in range(samples):
                for sx in range(samples):
                    cr, cg, cb, ca = sample((px + (sx + 0.5) / samples) * scale,
                                            (py + (sy + 0.5) / samples) * scale)
                    r += cr * ca
                    g += cg * ca
                    b += cb * ca
                    alpha += ca
            if alpha:
                raw += bytes((round(r / alpha), round(g / alpha), round(b / alpha),
                              round(alpha / (samples * samples))))
            else:
                raw += bytes((0, 0, 0, 0))
    return bytes(raw)


def chunk(tag, data):
    body = tag + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def png(size):
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(render(size), 9)) + chunk(b"IEND", b""))


def main():
    out = Path(__file__).resolve().parent.parent / "extension" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        target = out / f"icon{size}.png"
        target.write_bytes(png(size))
        print(f"{target} ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
