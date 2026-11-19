"""Build the Chrome Web Store upload.

    python store/pack.py

Writes dist/clean-your-saved-posts-<version>.zip from the contents of extension/, with
manifest.json at the top of the archive and forward-slash paths (the store rejects archives
written with backslashes, which older Windows PowerShell's Compress-Archive produces).
Stops before writing if a file the manifest points at is missing. README files are left out.
"""

import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "extension"
OUT_DIR = ROOT / "dist"
SKIP_NAMES = {".DS_Store", "Thumbs.db"}


def referenced_files(manifest):
    files = {manifest["background"]["service_worker"], manifest["action"]["default_popup"]}
    files.update(manifest.get("icons", {}).values())
    files.update(manifest["action"].get("default_icon", {}).values())
    for script in manifest.get("content_scripts", []):
        files.update(script.get("js", []))
    files.add(f"_locales/{manifest['default_locale']}/messages.json")
    files.add("offscreen.html")  # created at run time by lib/engine.js
    return files


def packaged_files():
    for path in sorted(SOURCE.rglob("*")):
        if path.is_file() and path.name not in SKIP_NAMES and not path.name.startswith("README"):
            yield path


def main():
    manifest = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8"))
    missing = sorted(f for f in referenced_files(manifest) if not (SOURCE / f).is_file())
    if missing:
        sys.exit("Missing files: " + ", ".join(missing))

    OUT_DIR.mkdir(exist_ok=True)
    target = OUT_DIR / f"clean-your-saved-posts-{manifest['version']}.zip"
    count = 0
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in packaged_files():
            archive.write(path, path.relative_to(SOURCE).as_posix())
            count += 1
    print(f"{target} ({count} files, {target.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
