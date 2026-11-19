import http.server
import json
import threading
from urllib.parse import parse_qs, urlparse
import pytest
from starlette.testclient import TestClient

from machine import config
from machine.model_manager import model_manager
from machine.proxy import app, tracked_jobs


class MockComfyUIHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # 禁用标准输出日志，保持测试输出整洁

    def do_GET(self):
        parsed = urlparse(self.path)
        state = self.server.state

        if parsed.path == "/system_stats":
            if state.get("unhealthy"):
                self.send_response(503)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"system": {"os": "linux"}, "devices": []}')
            return

        if parsed.path == "/queue":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            queue_data = {
                "queue_running": state.get("queue_running", []),
                "queue_pending": state.get("queue_pending", []),
            }
            self.wfile.write(json.dumps(queue_data).encode("utf-8"))
            return

        if parsed.path.startswith("/history/"):
            prompt_id = parsed.path.split("/")[-1]
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            history_data = state.get("history", {})
            self.wfile.write(json.dumps(history_data).encode("utf-8"))
            return

        if parsed.path == "/view":
            query = parse_qs(parsed.query)
            filename = query.get("filename", [""])[0]
            if state.get("view_error"):
                self.send_response(500)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.end_headers()
            # 伪造一个微型有效 PNG 二进制
            self.wfile.write(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4")
            return

        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        state = self.server.state

        if parsed.path == "/prompt":
            content_len = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_len)
            prompt_json = json.loads(body.decode("utf-8"))
            state["last_received_prompt"] = prompt_json
            state["last_received_headers"] = dict(self.headers)

            if state.get("prompt_error"):
                self.send_response(500)
                self.end_headers()
                return

            prompt_id = prompt_json.get("prompt_id", "test-job-id")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps({
                    "prompt_id": prompt_id,
                    "number": 1,
                    "node_errors": {},
                }).encode("utf-8")
            )
            return

        self.send_response(404)
        self.end_headers()


@pytest.fixture(scope="session")
def mock_comfy_server():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), MockComfyUIHandler)
    server.state = {
        "unhealthy": False,
        "queue_running": [],
        "queue_pending": [],
        "history": {},
        "view_error": False,
        "last_received_prompt": None,
        "last_received_headers": None,
    }
    port = server.server_port
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()

    # 配置 proxy 指向 mock ComfyUI
    config.COMFYUI_HOST = "127.0.0.1"
    config.COMFYUI_PORT = port
    config.COMFYUI_BASE_URL = f"http://127.0.0.1:{port}"
    config.PIX_SERVER_SECRET = "test-secret-12345"

    yield server

    server.shutdown()


@pytest.fixture(autouse=True)
def reset_server_state(mock_comfy_server):
    mock_comfy_server.state["unhealthy"] = False
    mock_comfy_server.state["queue_running"] = []
    mock_comfy_server.state["queue_pending"] = []
    mock_comfy_server.state["history"] = {}
    mock_comfy_server.state["view_error"] = False
    mock_comfy_server.state["prompt_error"] = False
    mock_comfy_server.state["last_received_prompt"] = None
    mock_comfy_server.state["last_received_headers"] = None
    model_manager.is_ready = True
    model_manager.lora_ready = True
    tracked_jobs.clear()


@pytest.fixture
def client(mock_comfy_server):
    with TestClient(app) as test_client:
        yield test_client


AUTH_HEADERS = {"X-Pix-Secret": "test-secret-12345"}


# --------------------------------------------------------------------------
# 1. 鉴权测试 (X-Pix-Secret)
# --------------------------------------------------------------------------
def test_auth_missing_secret(client):
    """缺失 X-Pix-Secret 时所有接口一律 401"""
    assert client.get("/health").status_code == 401
    assert client.post("/generate", json={"prompt": "cat"}).status_code == 401
    assert client.get("/status/some-job").status_code == 401
    assert client.get("/image/some-job").status_code == 401


def test_auth_wrong_secret(client):
    """X-Pix-Secret 错误时一律 401"""
    bad_headers = {"X-Pix-Secret": "invalid-secret"}
    assert client.get("/health", headers=bad_headers).status_code == 401
    assert client.post("/generate", json={"prompt": "cat"}, headers=bad_headers).status_code == 401


# --------------------------------------------------------------------------
# 2. 健康检查 (/health)
# --------------------------------------------------------------------------
def test_health_when_ready(client):
    """ComfyUI 可达且模型就绪 -> 200 {"ok": true, "comfyReady": true}"""
    resp = client.get("/health", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "comfyReady": True}


def test_health_when_model_unready(client):
    """模型未就绪 -> 200 {"ok": true, "comfyReady": false}"""
    model_manager.is_ready = False
    resp = client.get("/health", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "comfyReady": False}


def test_health_when_lora_unready(client):
    """LoRA 未就绪 -> 200 {"ok": true, "comfyReady": false}"""
    model_manager.is_ready = True
    model_manager.lora_ready = False
    resp = client.get("/health", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "comfyReady": False}


def test_health_when_comfy_down(client, mock_comfy_server):
    """ComfyUI 异常 -> 200 {"ok": true, "comfyReady": false}"""
    mock_comfy_server.state["unhealthy"] = True
    resp = client.get("/health", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "comfyReady": False}


# --------------------------------------------------------------------------
# 3. 生图提交 (/generate)
# --------------------------------------------------------------------------
def test_generate_503_when_not_ready(client):
    """服务未就绪时生图返回 503 starting"""
    model_manager.is_ready = False
    resp = client.post("/generate", json={"prompt": "cyberpunk city"}, headers=AUTH_HEADERS)
    assert resp.status_code == 503
    assert resp.json() == {"error": "starting"}


def test_generate_503_when_lora_unready(client):
    """checkpoint 就绪但 LoRA 未就绪 -> 503 starting"""
    model_manager.is_ready = True
    model_manager.lora_ready = False
    resp = client.post("/generate", json={"prompt": "cyberpunk city"}, headers=AUTH_HEADERS)
    assert resp.status_code == 503
    assert resp.json() == {"error": "starting"}


def test_generate_400_invalid_prompt(client):
    """prompt 为空、纯空白或超过 1000 字符时返回 400"""
    resp_empty = client.post("/generate", json={"prompt": ""}, headers=AUTH_HEADERS)
    assert resp_empty.status_code == 400
    assert resp_empty.json() == {"error": "invalid_prompt"}

    resp_spaces = client.post("/generate", json={"prompt": "   \n  "}, headers=AUTH_HEADERS)
    assert resp_spaces.status_code == 400

    resp_too_long = client.post("/generate", json={"prompt": "a" * 1001}, headers=AUTH_HEADERS)
    assert resp_too_long.status_code == 400


def test_generate_400_invalid_size(client):
    """非法的 size 返回 400 invalid_size"""
    resp = client.post("/generate", json={"prompt": "landscape", "size": "landscape_wide"}, headers=AUTH_HEADERS)
    assert resp.status_code == 400
    assert resp.json() == {"error": "invalid_size"}


def test_generate_409_busy_when_queue_occupied(client, mock_comfy_server):
    """已有任务排队或正在运行 -> 409 busy (v1 单并发)"""
    mock_comfy_server.state["queue_running"] = [[1, "existing-job", {}, {}, {}]]
    resp = client.post("/generate", json={"prompt": "a cute puppy"}, headers=AUTH_HEADERS)
    assert resp.status_code == 409
    assert resp.json() == {"error": "busy"}

    mock_comfy_server.state["queue_running"] = []
    mock_comfy_server.state["queue_pending"] = [[2, "queued-job", {}, {}, {}]]
    resp2 = client.post("/generate", json={"prompt": "a cute puppy"}, headers=AUTH_HEADERS)
    assert resp2.status_code == 409
    assert resp2.json() == {"error": "busy"}


def test_generate_202_default_portrait_and_parameters(client, mock_comfy_server):
    """成功提交生图：默认 portrait 512x768、随机 seed、固定负面词、无 Origin 头"""
    resp = client.post("/generate", json={"prompt": "masterpiece, ultra-detailed portrait"}, headers=AUTH_HEADERS)
    assert resp.status_code == 202
    data = resp.json()
    assert "jobId" in data
    job_id = data["jobId"]

    # 验证 ComfyUI 收到的请求
    last_prompt = mock_comfy_server.state["last_received_prompt"]
    assert last_prompt is not None
    assert last_prompt["prompt_id"] == job_id
    workflow = last_prompt["prompt"]

    # 验证模型节点
    assert workflow["1"]["class_type"] == "CheckpointLoaderSimple"
    assert workflow["1"]["inputs"]["ckpt_name"] == config.DEFAULT_MODEL_NAME

    # 验证 LoRA 加载节点（checkpoint 后串 LCM-LoRA，strength 1.0）
    assert workflow["8"]["class_type"] == "LoraLoader"
    assert workflow["8"]["inputs"]["model"] == ["1", 0]
    assert workflow["8"]["inputs"]["clip"] == ["1", 1]
    assert workflow["8"]["inputs"]["lora_name"] == config.LORA_NAME
    assert workflow["8"]["inputs"]["strength_model"] == 1.0
    assert workflow["8"]["inputs"]["strength_clip"] == 1.0

    # 验证正负面词（clip 取自 LoRA 节点输出）
    assert workflow["2"]["class_type"] == "CLIPTextEncode"
    assert workflow["2"]["inputs"]["text"] == "masterpiece, ultra-detailed portrait"
    assert workflow["2"]["inputs"]["clip"] == ["8", 1]
    assert workflow["3"]["class_type"] == "CLIPTextEncode"
    assert workflow["3"]["inputs"]["text"] == config.FIXED_NEGATIVE_PROMPT
    assert workflow["3"]["inputs"]["clip"] == ["8", 1]

    # 验证尺寸默认 portrait 512x768
    assert workflow["4"]["class_type"] == "EmptyLatentImage"
    assert workflow["4"]["inputs"]["width"] == 512
    assert workflow["4"]["inputs"]["height"] == 768

    # 验证 LCM 采样参数与随机 seed（model 取自 LoRA 节点输出）
    ksampler = workflow["5"]["inputs"]
    assert ksampler["model"] == ["8", 0]
    assert ksampler["sampler_name"] == "lcm"
    assert ksampler["scheduler"] == "sgm_uniform"
    assert ksampler["steps"] == 8
    assert ksampler["cfg"] == 1.5
    assert isinstance(ksampler["seed"], int)
    assert ksampler["seed"] > 0

    # 验证请求头：Host 改 127.0.0.1:8188（或 mock 端口），绝无 Origin
    received_headers = mock_comfy_server.state["last_received_headers"]
    header_keys = [k.lower() for k in received_headers.keys()]
    assert "origin" not in header_keys
    assert received_headers.get("Host") == f"127.0.0.1:{mock_comfy_server.server_port}"


def test_generate_202_square_size(client, mock_comfy_server):
    """指定 size=square -> 512x512"""
    resp = client.post("/generate", json={"prompt": "square avatar", "size": "square"}, headers=AUTH_HEADERS)
    assert resp.status_code == 202
    last_prompt = mock_comfy_server.state["last_received_prompt"]
    workflow = last_prompt["prompt"]
    assert workflow["4"]["inputs"]["width"] == 512
    assert workflow["4"]["inputs"]["height"] == 512


def test_generate_400_invalid_model(client):
    """非法的 model ID 返回 400 invalid_model"""
    resp = client.post("/generate", json={"prompt": "cat", "model": "nonexistent"}, headers=AUTH_HEADERS)
    assert resp.status_code == 400
    assert resp.json() == {"error": "invalid_model"}


def test_generate_503_model_not_ready(client):
    """model 合法但 checkpoint 未就绪 -> 503 model_not_ready"""
    model_manager.checkpoints_ready["majicmix"] = False
    resp = client.post("/generate", json={"prompt": "cat", "model": "majicmix"}, headers=AUTH_HEADERS)
    assert resp.status_code == 503
    assert resp.json() == {"error": "model_not_ready"}


def test_generate_202_non_lcm_model_direct_connection(client, mock_comfy_server):
    """model=realistic（无 LCM-LoRA）时节点 1 直连 2/3/5，使用 euler_ancestral 采样参数"""
    model_manager.checkpoints_ready["realistic_vision"] = True
    resp = client.post("/generate", json={"prompt": "a portrait", "model": "realistic"}, headers=AUTH_HEADERS)
    assert resp.status_code == 202
    last_prompt = mock_comfy_server.state["last_received_prompt"]
    workflow = last_prompt["prompt"]

    # 无 LoraLoader 节点
    assert "8" not in workflow

    # clip 直接取自 CheckpointLoaderSimple
    assert workflow["2"]["inputs"]["clip"] == ["1", 1]
    assert workflow["3"]["inputs"]["clip"] == ["1", 1]
    ksampler = workflow["5"]["inputs"]
    assert ksampler["model"] == ["1", 0]
    assert ksampler["sampler_name"] == "euler_ancestral"
    assert ksampler["scheduler"] == "normal"
    assert ksampler["steps"] == 20
    assert ksampler["cfg"] == 7.0
    assert workflow["1"]["inputs"]["ckpt_name"] == config.MODEL_NAME


def test_generate_202_model_field_recorded_in_tracked_job(client, mock_comfy_server):
    """tracked_jobs 记录请求的 model ID"""
    model_manager.checkpoints_ready["dreamshaper"] = True
    resp = client.post("/generate", json={"prompt": "cat", "model": "dreamshaper"}, headers=AUTH_HEADERS)
    assert resp.status_code == 202
    job_id = resp.json()["jobId"]
    assert tracked_jobs[job_id]["model"] == "dreamshaper"


# --------------------------------------------------------------------------
# 4. 任务状态查询 (/status/:jobId)
# --------------------------------------------------------------------------
def test_status_404_unknown(client):
    """未知任务返回 404"""
    resp = client.get("/status/unknown-uuid-000", headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json() == {"error": "job not found"}


def test_status_queued(client, mock_comfy_server):
    """排队中 -> queued"""
    mock_comfy_server.state["queue_pending"] = [[1, "job-queued-1", {}, {}, {}]]
    resp = client.get("/status/job-queued-1", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json() == {"state": "queued"}


def test_status_running(client, mock_comfy_server):
    """运行中 -> running"""
    mock_comfy_server.state["queue_running"] = [[1, "job-running-1", {}, {}, {}]]
    resp = client.get("/status/job-running-1", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json() == {"state": "running"}


def test_status_done(client, mock_comfy_server):
    """执行成功 -> done"""
    mock_comfy_server.state["history"] = {
        "job-done-1": {
            "status": {"status_str": "success", "completed": True},
            "outputs": {
                "7": {"images": [{"filename": "Pix_0001.png", "subfolder": "", "type": "output"}]}
            },
        }
    }
    resp = client.get("/status/job-done-1", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json() == {"state": "done"}


def test_status_error(client, mock_comfy_server):
    """执行失败 -> error"""
    mock_comfy_server.state["history"] = {
        "job-fail-1": {
            "status": {"status_str": "error", "completed": False, "messages": ["Out of memory"]},
            "outputs": {},
        }
    }
    resp = client.get("/status/job-fail-1", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.json() == {"state": "error", "error": "Out of memory"}


# --------------------------------------------------------------------------
# 5. 图片获取 (/image/:jobId)
# --------------------------------------------------------------------------
def test_image_404_unknown(client):
    """未知任务 -> 404"""
    resp = client.get("/image/unknown-job-999", headers=AUTH_HEADERS)
    assert resp.status_code == 404
    assert resp.json() == {"error": "job not found"}


def test_image_409_when_job_not_ready(client, mock_comfy_server):
    """任务尚在队列中未完成 -> 409 job not ready"""
    mock_comfy_server.state["queue_running"] = [[1, "job-unfinished-1", {}, {}, {}]]
    resp = client.get("/image/job-unfinished-1", headers=AUTH_HEADERS)
    assert resp.status_code == 409
    assert resp.json() == {"error": "job not ready"}


def test_image_200_when_done(client, mock_comfy_server):
    """任务完成 -> 200 image/png"""
    mock_comfy_server.state["history"] = {
        "job-success-1": {
            "status": {"status_str": "success", "completed": True},
            "outputs": {
                "7": {"images": [{"filename": "Pix_0001.png", "subfolder": "", "type": "output"}]}
            },
        }
    }
    resp = client.get("/image/job-success-1", headers=AUTH_HEADERS)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.content.startswith(b"\x89PNG")


def test_image_500_when_execution_failed(client, mock_comfy_server):
    """任务在 ComfyUI 端失败 -> 500 generation failed"""
    mock_comfy_server.state["history"] = {
        "job-crashed": {
            "status": {"status_str": "error", "completed": False},
            "outputs": {},
        }
    }
    resp = client.get("/image/job-crashed", headers=AUTH_HEADERS)
    assert resp.status_code == 500
    assert resp.json() == {"error": "generation failed"}
