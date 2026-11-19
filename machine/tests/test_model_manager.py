import hashlib
import http.server
import os
import tempfile
import threading
import pytest

from machine import config
from machine.model_manager import ModelManager


class MockModelDownloadHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        if self.path == "/model.safetensors":
            data = b"realistic-vision-mock-model-content-data"
            self.send_response(200)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if self.path == "/lora.safetensors":
            data = b"lcm-lora-mock-content-data"
            self.send_response(200)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_response(404)
        self.end_headers()


@pytest.fixture
def mock_download_server():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), MockModelDownloadHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    yield server
    server.shutdown()


@pytest.mark.anyio
async def test_model_manager_verify_and_download(mock_download_server, monkeypatch):
    test_content = b"realistic-vision-mock-model-content-data"
    expected_sha256 = hashlib.sha256(test_content).hexdigest()

    with tempfile.TemporaryDirectory() as tmp_dir:
        manager = ModelManager()
        manager.checkpoints_dir = tmp_dir
        manager.model_name = "test_model.safetensors"
        manager.download_url = f"http://127.0.0.1:{mock_download_server.server_port}/model.safetensors"
        manager.expected_sha256 = expected_sha256

        # 1. 首次检查，无模型，触发下载与校验
        success = await manager.ensure_model()
        assert success is True
        assert manager.is_ready is True
        target_path = os.path.join(tmp_dir, "test_model.safetensors")
        assert os.path.isfile(target_path)

        # 2. 第二次检查，模型已存在，直接校验通过
        success_cached = await manager.ensure_model()
        assert success_cached is True
        assert manager.is_ready is True

        # 3. 校验失败场景（篡改文件）
        with open(target_path, "wb") as f:
            f.write(b"corrupted data")
        manager.is_ready = False
        success_corrupted = await manager.ensure_model()
        assert success_corrupted is False
        assert manager.is_ready is False


@pytest.mark.anyio
async def test_model_manager_verify_and_download_lora(mock_download_server, monkeypatch):
    test_content = b"lcm-lora-mock-content-data"
    expected_sha256 = hashlib.sha256(test_content).hexdigest()

    with tempfile.TemporaryDirectory() as tmp_dir:
        manager = ModelManager()
        manager.loras_dir = tmp_dir
        manager.lora_name = "lcm-lora-sdv1-5.safetensors"
        manager.lora_download_url = f"http://127.0.0.1:{mock_download_server.server_port}/lora.safetensors"
        manager.expected_lora_sha256 = expected_sha256

        # 1. 首次检查，无 LoRA，触发下载与校验
        success = await manager.ensure_lora()
        assert success is True
        assert manager.lora_ready is True
        target_path = os.path.join(tmp_dir, "lcm-lora-sdv1-5.safetensors")
        assert os.path.isfile(target_path)

        # 2. 第二次检查，LoRA 已存在，直接校验通过（不重下）
        success_cached = await manager.ensure_lora()
        assert success_cached is True
        assert manager.lora_ready is True

        # 3. 校验失败场景（篡改文件）
        with open(target_path, "wb") as f:
            f.write(b"corrupted data")
        manager.lora_ready = False
        success_corrupted = await manager.ensure_lora()
        assert success_corrupted is False
        assert manager.lora_ready is False


@pytest.mark.anyio
async def test_model_manager_skip_download_marks_lora_ready(monkeypatch):
    monkeypatch.setattr(config, "SKIP_MODEL_DOWNLOAD", True)
    manager = ModelManager()
    success = await manager.ensure_lora()
    assert success is True
    assert manager.lora_ready is True
