#!/bin/bash
set -euo pipefail
SOURCE="$(cd "$(dirname "$0")/.." && pwd)"
DEST=/Users/lizhichao/vc/vpshelf
for name in index.html app.js i18n.js dropdowns.js style.css favicon.svg; do
  cp "$SOURCE/vpshelf/static/$name" "$DEST/vpshelf/static/$name"
done
# Only add the new static routes; keep the deployed service implementation intact.
export VPSHELF_UI_DEST="$DEST"
python3 - <<'PY'
import os
from pathlib import Path
p=Path(os.environ['VPSHELF_UI_DEST'])/'vpshelf/app.py'
s=p.read_text()
needle="'/app.js':('app.js','text/javascript')"
assert needle in s,'Static route declaration not found; no server change made'
for path,kind in [('i18n.js','text/javascript'),('dropdowns.js','text/javascript'),('favicon.svg','image/svg+xml'),('favicon.ico','image/svg+xml')]:
    if "'/"+path+"':" not in s:
        file='favicon.svg' if path=='favicon.ico' else path
        s=s.replace(needle,needle+",'/"+path+"':('"+file+"','"+kind+"')")
p.write_text(s)
PY
launchctl kickstart -k "gui/$(id -u)/cc.chaox.vpshelf"
echo 'Compact bilingual interface and favicon deployed. Refresh the dashboard.'
