#!/usr/bin/env python3
"""가스기능사 실기 연습장 웹앱 빌드

src/ (평문, git에 안 올림)  →  app.html + enc/ (암호화, git에 올림)

  src/index.html            아티팩트에서 내보낸 앱 화면 (그대로)
  src/data/*.json           문제 데이터 (sets.json 포함)
  src/img/*                 문제 사진
  src/data/progress-export.json   (선택) 처음 실행 때 넣을 풀이 기록

사용법:
  GP_PASS='비밀번호' python3 tools/build.py
비밀번호를 바꾸면 모든 기기에서 새 비밀번호를 다시 넣어야 합니다.
"""
import base64, hashlib, json, os, re, sys, time
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

ROOT = Path(__file__).resolve().parent.parent
SRC, ENC = ROOT / "src", ROOT / "enc"
ITER = 310_000


def key_from(passphrase: str, salt: bytes) -> bytes:
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(passphrase.encode())


def seal(key: bytes, data: bytes) -> bytes:
    iv = os.urandom(12)
    return iv + AESGCM(key).encrypt(iv, data, None)


def open_sealed(key: bytes, blob: bytes) -> bytes:
    return AESGCM(key).decrypt(blob[:12], blob[12:], None)


def make_app_html(src_html: str) -> str:
    h = src_html
    # 1) 아티팩트 전용 '웹앱용 내보내기' 버튼 스크립트는 뺀다
    h = re.sub(r"<script>\s*/\* ─+ 웹앱 이사용 내보내기.*?</script>\s*", "", h, flags=re.S)
    # 2) '교재 N쪽' 표시: 쪽수가 아닌 출처(블로그 복원 등)는 그대로 보여 줌
    h = h.replace("교재 ${esc(q.page || set.pages)}쪽", "${esc(srcLabel(q.page || set.pages))}")
    h = h.replace("교재 ${esc(s.pages || \"\")}쪽", "${esc(srcLabel(s.pages || \"\"))}")
    h = h.replace("교재 ${q.page || set.pages}쪽", "${srcLabel(q.page || set.pages)}")
    # 2-1) 동기화 안내 문구: 웹앱은 기기별 저장
    h = h.replace('공용 기록장에 연결됨 · 두 계정·모든 기기가 같은 기록을 씁니다', '이 기기에 저장됨 · 다른 기기로 옮길 땐 ⚙ 백업')
    h = h.replace('<div class="peers" id="peers">${peersHTML()}</div>', '')
    # 3) 어댑터(shim.js)를 앱 코드보다 먼저, PWA 정보는 head에
    head_add = ('<link rel="manifest" href="manifest.webmanifest"><meta name="theme-color" content="#e0a800">'
                '<meta name="apple-mobile-web-app-capable" content="yes"><link rel="apple-touch-icon" href="icon-192.png">'
                '<link rel="icon" href="icon.svg" type="image/svg+xml">')
    h = h.replace("</head>", head_add + "</head>", 1)
    h = h.replace("<body>", '<body>\n<script src="shim.js"></script>', 1)
    if "shim.js" not in h:
        raise SystemExit("index.html에서 <body>를 찾지 못했습니다")
    return h


def main():
    pw = os.environ.get("GP_PASS") or (sys.argv[1] if len(sys.argv) > 1 else None)
    if not pw:
        raise SystemExit("GP_PASS 환경변수로 비밀번호를 주세요")
    ENC.mkdir(exist_ok=True)
    meta_p = ENC / "meta.json"
    salt = None
    if meta_p.exists():
        old = json.loads(meta_p.read_text())
        s = base64.b64decode(old["salt"])
        try:
            open_sealed(key_from(pw, s), base64.b64decode(old["check"]))
            salt = s  # 같은 비밀번호면 소금값 유지 → 기기에서 다시 입력할 필요 없음
        except Exception:
            print("※ 비밀번호가 바뀌었습니다. 모든 기기에서 새 비밀번호를 넣어야 합니다.")
    salt = salt or os.urandom(16)
    key = key_from(pw, salt)

    files = sorted(p for p in SRC.rglob("*") if p.is_file() and p.relative_to(SRC).parts[0] in ("data", "img"))
    keep = set()
    digest = hashlib.sha256()
    for p in files:
        rel = p.relative_to(SRC).as_posix()
        raw = p.read_bytes()
        digest.update(rel.encode() + hashlib.sha256(raw).digest())
        out = ENC / (rel + ".bin")
        stamp = out.with_suffix(out.suffix + ".sha")  # 내용이 같으면 다시 암호화하지 않음(깃 변경 최소화)
        h = hashlib.sha256(raw + salt).hexdigest()
        keep.add(out); keep.add(stamp)
        if out.exists() and stamp.exists() and stamp.read_text() == h:
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(seal(key, raw))
        stamp.write_text(h)
    for p in ENC.rglob("*"):
        if p.is_file() and p != meta_p and p not in keep:
            p.unlink()

    version = digest.hexdigest()[:12]
    prefetch = [p.relative_to(SRC).as_posix() for p in files if p.name != "progress-export.json"]
    check = None
    if meta_p.exists():
        old = json.loads(meta_p.read_text())
        if base64.b64decode(old["salt"]) == salt:
            check = old["check"]
    meta = {"v": 1, "version": version, "built": time.strftime("%Y-%m-%d %H:%M"), "salt": base64.b64encode(salt).decode(),
            "iter": ITER, "check": check or base64.b64encode(seal(key, b"gas-practice")).decode(), "files": prefetch}
    meta_p.write_text(json.dumps(meta, ensure_ascii=False, indent=1))

    app = make_app_html((SRC / "index.html").read_text(encoding="utf-8"))
    (ROOT / "app.html").write_text(app, encoding="utf-8")
    print(f"완료: 파일 {len(files)}개, 데이터 버전 {version}")


if __name__ == "__main__":
    main()
