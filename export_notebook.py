"""
Turn an archive index into Markdown files you can add to NotebookLM as sources.

    python export_notebook.py downloads/instagram
    python export_notebook.py downloads/instagram downloads/x --out notebook_export

Each post becomes a short entry: author, date, link, caption, and file names.
Output is split into parts that stay under NotebookLM's per-source size limit.
"""

import argparse
from pathlib import Path

from common import FILE_SEPARATOR, read_index

WORDS_PER_PART = 300_000  # NotebookLM accepts up to 500,000 words per source


def entry(row):
    lines = [f"## @{row.get('user', 'unknown')} — {row.get('date', '')}",
             f"Link: {row.get('link', '')}"]
    files = [name for name in row.get("files", "").split(FILE_SEPARATOR) if name]
    if files:
        lines.append("Files: " + ", ".join(files))
    caption = row.get("caption", "").strip()
    lines += ["", caption if caption else "(no caption)", ""]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("folders", nargs="+", help="archive folders containing posts.csv")
    parser.add_argument("--out", default="notebook_export")
    args = parser.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for folder in map(Path, args.folders):
        rows = sorted(read_index(folder), key=lambda r: r.get("date", ""), reverse=True)
        if not rows:
            print(f"No index found in {folder}, skipped.")
            continue
        parts, current, words = [], [], 0
        for row in rows:
            text = entry(row)
            count = len(text.split())
            if current and words + count > WORDS_PER_PART:
                parts.append(current)
                current, words = [], 0
            current.append(text)
            words += count
        parts.append(current)

        for number, part in enumerate(parts, start=1):
            suffix = f"_part{number}" if len(parts) > 1 else ""
            target = out / f"{folder.name}_saved_posts{suffix}.md"
            target.write_text(f"# Saved posts archive: {folder.name}\n\n" + "\n".join(part), encoding="utf-8")
            print(f"{len(part)} posts -> {target.resolve()}")


if __name__ == "__main__":
    main()
