#!/usr/bin/env bash
set -euo pipefail

# Basit Makineler: Çarklar ve Kasnaklar - Derleme (Build) Betiği
# Kaynak ES modüllerini (js/*.js) ve stil dosyasını (css/style.css) birleştirerek:
# 1) dist/app.bundle.js ve dist/style.css dosyalarını üretir
# 2) Sunucusuz (çift tıklamayla / akıllı tahtada / USB bellekte) doğrudan açılabilen
#    taşınabilir tek dosyalık dist/index.html paketini oluşturur.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="${ROOT_DIR}/dist"

echo "⚙️  Derleme başlatılıyor..."
rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

cp "${ROOT_DIR}/css/style.css" "${DIST_DIR}/style.css"

python3 - "${ROOT_DIR}" "${DIST_DIR}" <<'PYEOF'
import re
import sys
from pathlib import Path

root_dir = Path(sys.argv[1])
dist_dir = Path(sys.argv[2])

modules = ["state.js", "physics.js", "renderer.js", "presets.js", "main.js"]
bundle_parts = ["(function () {\n'use strict';\n"]

for mod in modules:
    src = (root_dir / "js" / mod).read_text(encoding="utf-8")
    # Tek veya çok satırlı ES import ifadelerini kaldır
    src = re.sub(
        r"^\s*import\s+[\s\S]*?from\s+['\"][^'\"]+['\"];?\s*$",
        "",
        src,
        flags=re.MULTILINE,
    )
    # export anahtar kelimelerini kaldır
    src = re.sub(
        r"^\s*export\s+(const|let|function)\s+",
        r"\1 ",
        src,
        flags=re.MULTILINE,
    )
    bundle_parts.append(f"\n// --- Modül: {mod} ---\n{src.strip()}\n")

bundle_parts.append("})();\n")
bundle_js = "\n".join(bundle_parts)

bundle_path = dist_dir / "app.bundle.js"
bundle_path.write_text(bundle_js, encoding="utf-8")

html = (root_dir / "index.html").read_text(encoding="utf-8")
css = (dist_dir / "style.css").read_text(encoding="utf-8")

html = html.replace(
    '<link rel="stylesheet" href="css/style.css">',
    f"<style>\n{css}\n</style>",
)
html = re.sub(
    r'<script id="app-loader">[\s\S]*?</script>',
    lambda _: f"<script>\n{bundle_js}\n</script>",
    html,
)

(dist_dir / "index.html").write_text(html, encoding="utf-8")
PYEOF

echo "✅ Derleme tamamlandı!"
echo "   📦 Tek dosyalık taşınabilir sürüm : ${DIST_DIR}/index.html"
echo "   📜 Birleştirilmiş JS paketi       : ${DIST_DIR}/app.bundle.js"
