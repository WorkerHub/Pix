import hashlib
import logging
import os
import httpx
from machine import config

logger = logging.getLogger("pix-server.model")


class ModelManager:
    def __init__(self):
        self.checkpoints_dir = config.MODELS_CHECKPOINTS_DIR
        self.model_name = config.MODEL_NAME
        self.download_url = config.MODEL_DOWNLOAD_URL
        self.expected_sha256 = config.MODEL_SHA256.lower().strip()
        self.is_ready = False
        self.is_downloading = False
        self.error_message: str | None = None
        self.active_model_name = self.model_name

    def get_target_path(self) -> str:
        return os.path.join(self.checkpoints_dir, self.model_name)

    def verify_file_sha256(self, file_path: str) -> bool:
        if not os.path.isfile(file_path):
            return False
        logger.info(f"Computing sha256 for {file_path}...")
        h = hashlib.sha256()
        try:
            with open(file_path, "rb") as f:
                while chunk := f.read(1024 * 1024):
                    h.update(chunk)
            actual_sha256 = h.hexdigest().lower()
            if actual_sha256 == self.expected_sha256:
                logger.info(f"Model sha256 check passed: {actual_sha256}")
                return True
            else:
                msg = f"sha256 mismatch for {file_path}: expected {self.expected_sha256}, got {actual_sha256}"
                logger.error(msg)
                self.error_message = msg
                return False
        except Exception as e:
            msg = f"Failed to verify model file: {e}"
            logger.error(msg)
            self.error_message = msg
            return False

    def find_existing_checkpoints(self) -> list[str]:
        if not os.path.isdir(self.checkpoints_dir):
            return []
        files = []
        for name in os.listdir(self.checkpoints_dir):
            if name.endswith(".safetensors") or name.endswith(".ckpt"):
                files.append(name)
        return files

    async def ensure_model(self) -> bool:
        if config.SKIP_MODEL_DOWNLOAD:
            logger.info("SKIP_MODEL_DOWNLOAD is set. Marking model ready.")
            self.is_ready = True
            return True

        os.makedirs(self.checkpoints_dir, exist_ok=True)
        target_path = self.get_target_path()

        if os.path.isfile(target_path):
            logger.info(f"Found model file at {target_path}. Verifying sha256...")
            if self.verify_file_sha256(target_path):
                self.is_ready = True
                self.active_model_name = self.model_name
                return True
            else:
                self.is_ready = False
                return False

        # Check if another checkpoint exists
        existing = self.find_existing_checkpoints()
        if existing:
            first_cp = existing[0]
            first_path = os.path.join(self.checkpoints_dir, first_cp)
            logger.info(f"Found alternative checkpoint: {first_cp}. Verifying sha256...")
            if self.verify_file_sha256(first_path):
                self.is_ready = True
                self.active_model_name = first_cp
                return True

        # Need to download
        self.is_downloading = True
        self.error_message = None
        tmp_path = target_path + ".download.tmp"
        logger.info(f"Downloading model from {self.download_url} to {tmp_path}...")

        try:
            timeout = httpx.Timeout(connect=30.0, read=600.0, write=60.0, pool=30.0)
            async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
                async with client.stream("GET", self.download_url) as response:
                    if response.status_code != 200:
                        msg = f"Download failed with HTTP status {response.status_code}"
                        logger.error(msg)
                        self.error_message = msg
                        self.is_ready = False
                        return False

                    h = hashlib.sha256()
                    with open(tmp_path, "wb") as f:
                        async for chunk in response.aiter_bytes(chunk_size=1024 * 1024):
                            f.write(chunk)
                            h.update(chunk)

            actual_sha256 = h.hexdigest().lower()
            if actual_sha256 != self.expected_sha256:
                msg = f"Downloaded file sha256 mismatch: expected {self.expected_sha256}, got {actual_sha256}"
                logger.error(msg)
                self.error_message = msg
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
                self.is_ready = False
                return False

            os.rename(tmp_path, target_path)
            logger.info(f"Model successfully downloaded and verified at {target_path}")
            self.is_ready = True
            self.active_model_name = self.model_name
            return True
        except Exception as e:
            msg = f"Model download error: {e}"
            logger.error(msg)
            self.error_message = msg
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            self.is_ready = False
            return False
        finally:
            self.is_downloading = False


model_manager = ModelManager()
