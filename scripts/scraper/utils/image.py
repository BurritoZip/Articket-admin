"""포스터 이미지 다운로드 → Supabase Storage 업로드"""
import io
import os
from typing import Optional

import requests
from PIL import Image


def download_and_upload_poster(
    image_url: str,
    dedup_key: str,
    supabase_client,
    bucket: str = "concert-posters",
) -> Optional[str]:
    """
    원본 URL에서 이미지를 다운로드하고 Supabase Storage에 업로드.
    반환값: public URL (실패 시 None)
    """
    try:
        resp = requests.get(image_url, timeout=15)
        resp.raise_for_status()

        # 이미지 유효성 확인 및 JPEG 변환
        img = Image.open(io.BytesIO(resp.content)).convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        buf.seek(0)

        file_path = f"{dedup_key}.jpg"

        supabase_client.storage.from_(bucket).upload(
            path=file_path,
            file=buf.getvalue(),
            file_options={"content-type": "image/jpeg", "upsert": "true"},
        )

        supabase_url = os.environ["SUPABASE_URL"]
        return f"{supabase_url}/storage/v1/object/public/{bucket}/{file_path}"

    except Exception as e:
        print(f"  [이미지 업로드 실패] {image_url}: {e}")
        return None
