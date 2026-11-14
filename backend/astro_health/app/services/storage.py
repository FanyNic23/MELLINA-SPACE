import asyncio
import logging
from pathlib import Path
from typing import Optional

from app.core.config import Settings

log = logging.getLogger("storage")


class ObjectStore:
    """Audio y logs: siempre local (para servirlo al casco) + S3 si está configurado."""

    def __init__(self, settings: Settings) -> None:
        self.s = settings
        self.dir = Path(settings.audio_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self._s3 = None

    @property
    def s3_enabled(self) -> bool:
        return bool(self.s.s3_bucket)

    def client(self, service: str):
        import boto3

        return boto3.client(
            service,
            region_name=self.s.aws_region,
            aws_access_key_id=self.s.aws_access_key_id or None,
            aws_secret_access_key=self.s.aws_secret_access_key or None,
        )

    async def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> bool:
        if not self.s3_enabled:
            return False
        try:
            if self._s3 is None:
                self._s3 = self.client("s3")
            await asyncio.to_thread(self._s3.put_object, Bucket=self.s.s3_bucket, Key=key,
                                    Body=data, ContentType=content_type)
            return True
        except Exception:
            log.exception("Fallo subiendo a S3 (%s)", key)
            return False

    async def save_audio(self, filename: str, data: bytes, content_type: str = "audio/mpeg",
                         prefix: str = "audio") -> str:
        await asyncio.to_thread((self.dir / filename).write_bytes, data)
        await self.put(f"{prefix}/{filename}", data, content_type)
        return f"/audio/{filename}"

    def path_of(self, filename: str) -> Optional[Path]:
        p = (self.dir / filename).resolve()
        return p if p.is_file() and self.dir.resolve() in p.parents else None
