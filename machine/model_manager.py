import asyncio
import hashlib
import logging
import os
import httpx
from machine import config

logger = logging.getLogger("pix-service.model")


class ModelManager:
    def __init__(self):
        self.checkpoints_dir = config.MODELS_CHECKPOINTS_DIR
        self.loras_dir = config.MODELS_LORAS_DIR

        # Legacy attributes preserved for backward compatibility
        self.model_name = config.MODEL_NAME
        self.download_url = config.MODEL_DOWNLOAD_URL
        self.expected_sha256 = config.MODEL_SHA256.lower().strip()
        self.lora_name = config.LORA_NAME
        self.lora_download_url = config.LORA_DOWNLOAD_URL
        self.expected_lora_sha256 = config.LORA_SHA256.lower().strip()

        # Multi-checkpoint / LoRA readiness states
        self.checkpoints_ready: dict[str, bool] = {k: False for k in config.CHECKPOINTS}
        self.loras_ready: dict[str, bool] = {k: False for k in config.LORAS}
        self.active_checkpoints: dict[str, str] = {
            k: v["filename"] for k, v in config.CHECKPOINTS.items()
        }

        self._legacy_is_ready = False
        self._legacy_lora_ready = False
        self.is_downloading = False
        self.error_message: str | None = None
        self.active_model_name = self.model_name

    @property
    def is_ready(self) -> bool:
        return self.checkpoints_ready.get("realistic_vision", self._legacy_is_ready)

    @is_ready.setter
    def is_ready(self, val: bool):
        self._legacy_is_ready = val
        self.checkpoints_ready["realistic_vision"] = val

    @property
    def lora_ready(self) -> bool:
        return self.loras_ready.get("lcm", self._legacy_lora_ready)

    @lora_ready.setter
    def lora_ready(self, val: bool):
        self._legacy_lora_ready = val
        self.loras_ready["lcm"] = val

    @property
    def fully_ready(self) -> bool:
        return self.is_default_ready()

    def is_model_ready(self, model_id: str) -> bool:
        if config.SKIP_MODEL_DOWNLOAD:
            return True
        model_cfg = config.MODEL_REGISTRY.get(model_id)
        if not model_cfg:
            return False
        ckpt_key = model_cfg["checkpoint_key"]
        if not self.checkpoints_ready.get(ckpt_key, False):
            return False
        if model_cfg.get("use_lcm_lora", False):
            if not self.loras_ready.get("lcm", False):
                return False
        return True

    def is_default_ready(self) -> bool:
        return self.is_model_ready(config.DEFAULT_MODEL_ID)

    def get_target_path(self) -> str:
        return os.path.join(self.checkpoints_dir, self.model_name)

    def get_checkpoint_name(self, checkpoint_key: str) -> str:
        if checkpoint_key in self.active_checkpoints:
            return self.active_checkpoints[checkpoint_key]
        if checkpoint_key in config.CHECKPOINTS:
            return config.CHECKPOINTS[checkpoint_key]["filename"]
        return self.active_model_name

    def get_model_filename(self, model_id: str) -> str:
        model_cfg = config.MODEL_REGISTRY.get(model_id)
        if not model_cfg:
            return self.active_model_name
        ckpt_key = model_cfg["checkpoint_key"]
        return self.get_checkpoint_name(ckpt_key)

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
            if name.endswith(".safetensors") or name.endswith(".ckpt"):
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
                self.active_model_name = self.model_name
                self.active_checkpoints["realistic_vision"] = self.model_name
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
                self.active_model_name = first_cp
                self.active_checkpoints["realistic_vision"] = first_cp
                return True

        # Need to download
        if await self._download_and_verify(
            self.download_url, target_path, self.expected_sha256, "Model"
        ):
            self.is_ready = True
            self.active_model_name = self.model_name
            self.active_checkpoints["realistic_vision"] = self.model_name
            return True

        self.is_ready = False
        return False

    async def ensure_checkpoint(self, checkpoint_key: str) -> bool:
        if checkpoint_key == "realistic_vision":
            return await self.ensure_model()

        if config.SKIP_MODEL_DOWNLOAD:
            logger.info(f"SKIP_MODEL_DOWNLOAD is set. Marking checkpoint {checkpoint_key} ready.")
            self.checkpoints_ready[checkpoint_key] = True
            return True

        cp_info = config.CHECKPOINTS.get(checkpoint_key)
        if not cp_info:
            logger.error(f"Unknown checkpoint key: {checkpoint_key}")
            return False

        filename = cp_info["filename"]
        url = cp_info["url"]
        expected_sha256 = cp_info["sha256"].lower().strip()

        os.makedirs(self.checkpoints_dir, exist_ok=True)
        target_path = os.path.join(self.checkpoints_dir, filename)

        if os.path.isfile(target_path):
            logger.info(f"Found checkpoint file at {target_path}. Verifying sha256...")
            if self.verify_sha256(target_path, expected_sha256):
                self.checkpoints_ready[checkpoint_key] = True
                self.active_checkpoints[checkpoint_key] = filename
                return True
            else:
                self.checkpoints_ready[checkpoint_key] = False
                return False

        if await self._download_and_verify(
            url, target_path, expected_sha256, f"Checkpoint ({checkpoint_key})"
        ):
            self.checkpoints_ready[checkpoint_key] = True
            self.active_checkpoints[checkpoint_key] = filename
            return True

        self.checkpoints_ready[checkpoint_key] = False
        return False

    async def ensure_lora(self) -> bool:
        if config.SKIP_MODEL_DOWNLOAD:
            logger.info("SKIP_MODEL_DOWNLOAD is set. Marking LoRA ready.")
            self.lora_ready = True
            return True

        os.makedirs(self.loras_dir, exist_ok=True)
        target_path = os.path.join(self.loras_dir, self.lora_name)

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

    async def ensure_all_models(self) -> None:
        if config.SKIP_MODEL_DOWNLOAD:
            logger.info("SKIP_MODEL_DOWNLOAD is set. Marking all models ready.")
            for k in config.CHECKPOINTS:
                self.checkpoints_ready[k] = True
            for k in config.LORAS:
                self.loras_ready[k] = True
            self.is_ready = True
            self.lora_ready = True
            return

        default_cfg = config.MODEL_REGISTRY.get(
            config.DEFAULT_MODEL_ID, config.MODEL_REGISTRY.get("realistic-lcm", {})
        )
        default_ckpt_key = default_cfg.get("checkpoint_key", "realistic_vision")
        needs_lora = default_cfg.get("use_lcm_lora", True)

        logger.info(f"Ensuring default checkpoint ({default_ckpt_key}) and necessary LoRAs...")
        tasks = [self.ensure_checkpoint(default_ckpt_key)]
        if needs_lora:
            tasks.append(self.ensure_lora())
        await asyncio.gather(*tasks)

        # Ensure the remaining checkpoints
        for cp_key in config.CHECKPOINTS:
            if cp_key != default_ckpt_key:
                try:
                    await self.ensure_checkpoint(cp_key)
                except Exception as e:
                    logger.error(f"Failed to ensure checkpoint {cp_key}: {e}")

        if not self.lora_ready:
            try:
                await self.ensure_lora()
            except Exception as e:
                logger.error(f"Failed to ensure LoRA: {e}")


model_manager = ModelManager()
