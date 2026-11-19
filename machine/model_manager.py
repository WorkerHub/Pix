import asyncio
import hashlib
import logging
import os
import sys

import httpx

from machine import config

logger = logging.getLogger("pix-service.model")


class ModelManager:
    def __init__(self):
        self.checkpoints_dir = config.MODELS_CHECKPOINTS_DIR
        self.model_name = config.MODEL_NAME
        self.download_url = config.MODEL_DOWNLOAD_URL
        self.expected_sha256 = config.MODEL_SHA256.lower().strip()
        self.loras_dir = config.MODELS_LORAS_DIR
        self.lora_name = config.LORA_NAME
        self.lora_download_url = config.LORA_DOWNLOAD_URL
        self.expected_lora_sha256 = config.LORA_SHA256.lower().strip()
        self.merged_model_name = config.MERGED_MODEL_NAME
        self.is_ready = False
        self.lora_ready = False
        self.is_downloading = False
        self.is_merging = False
        self.error_message: str | None = None
        self.active_model_name = self.merged_model_name
        self._lock = asyncio.Lock()

    @property
    def fully_ready(self) -> bool:
        return self.is_ready and self.lora_ready

    def get_target_path(self) -> str:
        return os.path.join(self.checkpoints_dir, self.model_name)

    def get_merged_path(self) -> str:
        return os.path.join(self.checkpoints_dir, self.merged_model_name)

    def get_lora_path(self) -> str:
        return os.path.join(self.loras_dir, self.lora_name)

    def verify_sha256(self, file_path: str, expected_sha256: str) -> bool:
        expected = expected_sha256.lower().strip()
        if not os.path.isfile(file_path):
            return False
        logger.info(f"Computing sha256 for {file_path}...")
        h = hashlib.sha256()
        try:
            with open(file_path, "rb") as f:
                while chunk := f.read(1024 * 1024):
                    h.update(chunk)
            actual_sha256 = h.hexdigest().lower()
            if actual_sha256 == expected:
                logger.info(f"sha256 check passed for {file_path}: {actual_sha256}")
                return True
            else:
                msg = f"sha256 mismatch for {file_path}: expected {expected}, got {actual_sha256}"
                logger.error(msg)
                self.error_message = msg
                return False
        except Exception as e:
            msg = f"Failed to verify file {file_path}: {e}"
            logger.error(msg)
            self.error_message = msg
            return False

    def find_existing_checkpoints(self) -> list[str]:
        if not os.path.isdir(self.checkpoints_dir):
            return []
        files = []
        for name in os.listdir(self.checkpoints_dir):
            if name.endswith((".safetensors", ".ckpt")):
                files.append(name)
        return files

    async def _download_and_verify(
        self, url: str, target_path: str, expected_sha256: str, label: str
    ) -> bool:
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        tmp_path = target_path + ".download.tmp"
        logger.info(f"Downloading {label} from {url} to {tmp_path}...")
        self.is_downloading = True
        self.error_message = None
        try:
            timeout = httpx.Timeout(connect=30.0, read=600.0, write=60.0, pool=30.0)
            async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
                async with client.stream("GET", url) as response:
                    if response.status_code != 200:
                        msg = f"Download failed with HTTP status {response.status_code}"
                        logger.error(msg)
                        self.error_message = msg
                        return False

                    h = hashlib.sha256()
                    with open(tmp_path, "wb") as f:
                        async for chunk in response.aiter_bytes(chunk_size=1024 * 1024):
                            f.write(chunk)
                            h.update(chunk)

            actual_sha256 = h.hexdigest().lower()
            if actual_sha256 != expected_sha256.lower().strip():
                msg = f"Downloaded file sha256 mismatch: expected {expected_sha256.lower().strip()}, got {actual_sha256}"
                logger.error(msg)
                self.error_message = msg
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
                return False

            os.rename(tmp_path, target_path)
            logger.info(f"{label} successfully downloaded and verified at {target_path}")
            return True
        except Exception as e:
            msg = f"{label} download error: {e}"
            logger.error(msg)
            self.error_message = msg
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            return False
        finally:
            self.is_downloading = False

    async def ensure_model(self) -> bool:
        if config.SKIP_MODEL_DOWNLOAD:
            logger.info("SKIP_MODEL_DOWNLOAD is set. Marking model ready.")
            self.is_ready = True
            return True

        os.makedirs(self.checkpoints_dir, exist_ok=True)
        target_path = self.get_target_path()

        if os.path.isfile(target_path):
            logger.info(f"Found model file at {target_path}. Verifying sha256...")
            if self.verify_sha256(target_path, self.expected_sha256):
                self.is_ready = True
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
            if self.verify_sha256(first_path, self.expected_sha256):
                self.is_ready = True
                return True

        # Need to download
        if await self._download_and_verify(
            self.download_url, target_path, self.expected_sha256, "Model"
        ):
            self.is_ready = True
            return True

        self.is_ready = False
        return False

    async def ensure_lora(self) -> bool:
        if config.SKIP_MODEL_DOWNLOAD:
            logger.info("SKIP_MODEL_DOWNLOAD is set. Marking LoRA ready.")
            self.lora_ready = True
            return True

        os.makedirs(self.loras_dir, exist_ok=True)
        target_path = self.get_lora_path()

        if os.path.isfile(target_path):
            logger.info(f"Found LoRA file at {target_path}. Verifying sha256...")
            if self.verify_sha256(target_path, self.expected_lora_sha256):
                self.lora_ready = True
                return True
            else:
                self.lora_ready = False
                return False

        if await self._download_and_verify(
            self.lora_download_url, target_path, self.expected_lora_sha256, "LoRA"
        ):
            self.lora_ready = True
            return True

        self.lora_ready = False
        return False

    async def merge_checkpoint(
        self,
        base_path: str | None = None,
        lora_path: str | None = None,
        output_path: str | None = None,
    ) -> bool:
        base_path = base_path or self.get_target_path()
        lora_path = lora_path or self.get_lora_path()
        output_path = output_path or self.get_merged_path()

        cmd = [
            sys.executable,
            "-m",
            "machine.merge_lora",
            "--base-path",
            base_path,
            "--lora-path",
            lora_path,
            "--output-path",
            output_path,
            "--strength",
            "1.0",
        ]
        logger.info(f"Running LoRA merge subprocess: {' '.join(cmd)}")
        self.is_merging = True
        self.error_message = None
        try:
            env = os.environ.copy()
            comfy_dir = getattr(config, "COMFYUI_DIR", "/app/ComfyUI")
            env["PYTHONPATH"] = f"/app:{comfy_dir}:{env.get('PYTHONPATH', '')}"

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            _stdout, stderr = await proc.communicate()
            if proc.returncode != 0:
                err = stderr.decode().strip()
                msg = f"Merge subprocess failed with code {proc.returncode}: {err}"
                logger.error(msg)
                self.error_message = msg
                return False

            if not os.path.isfile(output_path) or os.path.getsize(output_path) == 0:
                msg = f"Merged output checkpoint file missing or empty: {output_path}"
                logger.error(msg)
                self.error_message = msg
                return False

            logger.info(f"LoRA merge subprocess succeeded: {output_path}")
            return True
        except Exception as e:
            msg = f"Exception running merge subprocess: {e}"
            logger.error(msg)
            self.error_message = msg
            return False
        finally:
            self.is_merging = False

    async def ensure_merged_model(self) -> bool:
        if config.SKIP_MODEL_DOWNLOAD:
            logger.info("SKIP_MODEL_DOWNLOAD is set. Marking models ready.")
            self.is_ready = True
            self.lora_ready = True
            self.active_model_name = self.merged_model_name
            return True

        merged_path = self.get_merged_path()
        if os.path.isfile(merged_path) and os.path.getsize(merged_path) > 0:
            logger.info(f"Found existing merged model at {merged_path}. Skipping merge.")
            self.is_ready = True
            self.lora_ready = True
            self.active_model_name = self.merged_model_name
            return True

        # Need base model and LoRA to merge
        base_ok = await self.ensure_model()
        if not base_ok:
            logger.error("Base model verification/download failed. Cannot merge.")
            self.is_ready = False
            return False

        lora_ok = await self.ensure_lora()
        if not lora_ok:
            logger.error("LoRA verification/download failed. Cannot merge.")
            self.lora_ready = False
            return False

        # Execute merge in child process
        merge_ok = await self.merge_checkpoint()
        if merge_ok:
            self.is_ready = True
            self.lora_ready = True
            self.active_model_name = self.merged_model_name
            logger.info(f"Active model set to merged model: {self.active_model_name}")
            return True
        else:
            self.is_ready = False
            return False

    async def ensure_models(self) -> bool:
        async with self._lock:
            return await self.ensure_merged_model()


model_manager = ModelManager()
