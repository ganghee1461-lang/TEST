#!/usr/bin/env python3
"""enc/ 의 암호 파일을 src/ 평문으로 되돌린다 (새 PC에서 작업을 이어갈 때).
  GP_PASS='비밀번호' python3 tools/decrypt.py
src/index.html(앱 원본)은 app.html에서 shim 부분을 빼서 되살린다."""
import base64, json, os, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from build import ROOT, SRC, ENC, key_from, open_sealed

pw = os.environ.get("GP_PASS") or (sys.argv[1] if len(sys.argv) > 1 else None)
if not pw:
    raise SystemExit("GP_PASS 환경변수로 비밀번호를 주세요")
meta = json.loads((ENC / "meta.json").read_text())
key = key_from(pw, base64.b64decode(meta["salt"]))
open_sealed(key, base64.b64decode(meta["check"]))  # 틀리면 여기서 오류
n = 0
for p in ENC.rglob("*.bin"):
    rel = p.relative_to(ENC).as_posix()[:-4]
    out = SRC / rel
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(open_sealed(key, p.read_bytes()))
    n += 1
app = (ROOT / "app.html").read_text(encoding="utf-8")
app = app.replace('<body>\n<script src="shim.js"></script>', "<body>", 1)
app = re.sub(r'<link rel="manifest".*?type="image/svg\+xml">(</head>)', r"\1", app, count=1, flags=re.S)
(SRC / "index.html").write_text(app, encoding="utf-8")
print(f"복원 완료: {n}개 파일 → {SRC}")
