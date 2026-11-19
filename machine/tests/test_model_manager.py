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
        if self.path == "/majicmix.safetensors":
            data = b"majicmix-v7-mock-content-data"
            self.send_response(200)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if self.path == "/dreamshaper.safetensors":
            data = b"dreamshaper-8-mock-content-data"
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


@pytest.mark.anyio
async def test_model_manager_merged_model_cached(monkeypatch):
    """已存在合并模型时，直接标记就绪并复用缓存，跳过下载与合并"""
    with tempfile.TemporaryDirectory() as tmp_dir:
        manager = ModelManager()
        manager.checkpoints_dir = tmp_dir
        manager.merged_model_name = "test_merged.safetensors"
        merged_file = os.path.join(tmp_dir, "test_merged.safetensors")
        with open(merged_file, "wb") as f:
            f.write(b"existing-merged-checkpoint-data")

        success = await manager.ensure_merged_model()
        assert success is True
        assert manager.merged_ready is True
        assert manager.active_model_name == "test_merged.safetensors"


@pytest.mark.anyio
async def test_model_manager_merge_pipeline_triggers_merge(monkeypatch):
    """缺失合并模型但 base checkpoint + LoRA 就绪时，调起子进程合并"""
    with tempfile.TemporaryDirectory() as tmp_dir:
        cp_dir = os.path.join(tmp_dir, "checkpoints")
        lora_dir = os.path.join(tmp_dir, "loras")
        os.makedirs(cp_dir, exist_ok=True)
        os.makedirs(lora_dir, exist_ok=True)

        manager = ModelManager()
        manager.checkpoints_dir = cp_dir
        manager.loras_dir = lora_dir
        manager.model_name = "base.safetensors"
        manager.merged_model_name = "merged.safetensors"
        manager.checkpoints_ready["realistic_vision"] = True
        manager.loras_ready["lcm"] = True

        merge_called = []

        async def fake_merge_checkpoint(base_path=None, lora_path=None, output_path=None):
            out = output_path or manager.get_merged_path()
            with open(out, "wb") as f:
                f.write(b"merged-content")
            merge_called.append(True)
            return True

        monkeypatch.setattr(manager, "merge_checkpoint", fake_merge_checkpoint)

        success = await manager.ensure_merged_model()
        assert success is True
        assert manager.merged_ready is True
        assert manager.active_model_name == "merged.safetensors"
        assert len(merge_called) == 1
        assert os.path.isfile(manager.get_merged_path())


@pytest.mark.anyio
async def test_model_manager_skip_download_marks_merged_ready(monkeypatch):
    """SKIP_MODEL_DOWNLOAD=1 时，合并模型直接标记就绪"""
    monkeypatch.setattr(config, "SKIP_MODEL_DOWNLOAD", True)
    manager = ModelManager()
    success = await manager.ensure_merged_model()
    assert success is True
    assert manager.merged_ready is True
    assert manager.active_model_name == config.MERGED_MODEL_NAME


@pytest.mark.anyio
async def test_model_manager_ensure_all_models_default_ready(monkeypatch):
    monkeypatch.setattr(config, "SKIP_MODEL_DOWNLOAD", True)
    manager = ModelManager()
    await manager.ensure_all_models()
    assert manager.is_default_ready() is True
    assert manager.is_model_ready(config.DEFAULT_MODEL_ID) is True
    for model_id in config.MODEL_REGISTRY:
        assert manager.is_model_ready(model_id) is True


@pytest.mark.anyio
async def test_model_manager_is_model_ready_requires_merged(monkeypatch):
    monkeypatch.setattr(config, "SKIP_MODEL_DOWNLOAD", False)
    manager = ModelManager()
    manager.checkpoints_ready["realistic_vision"] = True
    manager.merged_ready = False
    assert manager.is_model_ready("realistic-lcm") is False
    manager.merged_ready = True
    assert manager.is_model_ready("realistic-lcm") is True
    assert manager.is_model_ready("realistic") is True


@pytest.mark.anyio
async def test_model_manager_ensure_non_default_checkpoint(
    mock_download_server, monkeypatch
):
    test_content = b"majicmix-v7-mock-content-data"
    expected_sha256 = hashlib.sha256(test_content).hexdigest()
    monkeypatch.setattr(config, "SKIP_MODEL_DOWNLOAD", False)

    with tempfile.TemporaryDirectory() as tmp_dir:
        manager = ModelManager()
        manager.checkpoints_dir = tmp_dir
        monkeypatch.setitem(
            config.CHECKPOINTS,
            "majicmix",
            {
                "filename": "majicmix_test.safetensors",
                "url": f"http://127.0.0.1:{mock_download_server.server_port}/majicmix.safetensors",
                "sha256": expected_sha256,
            },
        )
        success = await manager.ensure_checkpoint("majicmix")
        assert success is True
        assert manager.checkpoints_ready["majicmix"] is True
        target_path = os.path.join(tmp_dir, "majicmix_test.safetensors")
        assert os.path.isfile(target_path)

