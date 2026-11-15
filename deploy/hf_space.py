"""Publica A-HAMS como demo en Hugging Face Spaces (Docker, plan gratuito).

Sube el último commit (no los cambios sin confirmar) usando el Dockerfile del repositorio; Hugging Face
construye la imagen y la sirve en https://<usuario>-<space>.hf.space. Requiere una sesión iniciada con un
token de escritura:  hf auth login

Uso:  python deploy/hf_space.py [nombre-del-space]      (por defecto: ahams)
"""
import io
import re
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parents[1]
SPACE_CARD = """---
title: A-HAMS
colorFrom: gray
colorTo: blue
sdk: docker
app_port: 8000
pinned: false
license: mit
short_description: Autonomous astronaut health assessment and monitoring
---

"""


def main() -> None:
    name = sys.argv[1] if len(sys.argv) > 1 else "ahams"
    api = HfApi()
    user = api.whoami()["name"]
    repo_id = f"{user}/{name}"

    if subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True).stdout.strip():
        print("Aviso: hay cambios sin confirmar; se publica el último commit.")
    commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()

    with tempfile.TemporaryDirectory() as tmp:
        archive = subprocess.run(["git", "archive", "HEAD"], cwd=ROOT, capture_output=True, check=True).stdout
        tarfile.open(fileobj=io.BytesIO(archive)).extractall(tmp, filter="data")
        readme = Path(tmp, "README.md")
        readme.write_text(SPACE_CARD + readme.read_text(encoding="utf-8"), encoding="utf-8")

        api.create_repo(repo_id, repo_type="space", space_sdk="docker", exist_ok=True)
        api.upload_folder(folder_path=tmp, repo_id=repo_id, repo_type="space", delete_patterns="*",
                          commit_message=f"Despliegue {commit}")

    host = re.sub(r"[^a-z0-9-]", "-", f"{user}-{name}".lower())
    print(f"Publicado {commit}. Construcción: https://huggingface.co/spaces/{repo_id}")
    print(f"Demo (cuando termine el build): https://{host}.hf.space")


if __name__ == "__main__":
    main()
