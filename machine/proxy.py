import asyncio
from contextlib import asynccontextmanager
import logging
import random
import time
import uuid
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
import httpx
from machine import config
from machine.model_manager import model_manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("pix-service.proxy")

tracked_jobs: dict[str, dict] = {}
submission_lock = asyncio.Lock()


def get_comfy_headers() -> dict[str, str]:
    # Host 改 127.0.0.1:8188，不带 Origin（ComfyUI 来源校验）
    return {
        "Host": f"{config.COMFYUI_HOST}:{config.COMFYUI_PORT}",
    }


async def check_comfy_liveness() -> bool:
    try:
        timeout = httpx.Timeout(connect=2.0, read=2.0, write=2.0, pool=2.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(
                f"{config.COMFYUI_BASE_URL}/system_stats",
                headers=get_comfy_headers(),
            )
            return resp.status_code == 200
    except Exception:
        return False


async def is_comfy_ready() -> bool:
    if not model_manager.is_default_ready():
        return False
    return await check_comfy_liveness()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting pix-service proxy...")
    asyncio.create_task(model_manager.ensure_all_models())
    yield
    logger.info("Shutting down pix-service proxy...")


app = FastAPI(title="Pix Server Proxy", lifespan=lifespan)


@app.middleware("http")
async def authenticate_request(request: Request, call_next):
    secret = request.headers.get("x-pix-secret")
    if not config.PIX_SERVER_SECRET or secret != config.PIX_SERVER_SECRET:
        return JSONResponse(status_code=401, content={"error": "unauthorized"})
    return await call_next(request)


@app.get("/health")
async def health():
    ready = await is_comfy_ready()
    return {"ok": True, "comfyReady": ready}


@app.post("/generate")
async def generate(request: Request):
    ready = await is_comfy_ready()
    if not ready:
        return JSONResponse(status_code=503, content={"error": "starting"})

    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "invalid_json"})

    prompt = body.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 1000:
        return JSONResponse(status_code=400, content={"error": "invalid_prompt"})

    size = body.get("size", "portrait")
    if size not in config.SIZES:
        return JSONResponse(status_code=400, content={"error": "invalid_size"})

    model_id = body.get("model")
    if model_id is None:
        model_id = config.DEFAULT_MODEL_ID
    elif not isinstance(model_id, str) or model_id not in config.MODEL_REGISTRY:
        return JSONResponse(status_code=400, content={"error": "invalid_model"})

    if not model_manager.is_model_ready(model_id):
        return JSONResponse(status_code=503, content={"error": "model_not_ready"})

    dims = config.SIZES[size]
    model_cfg = config.MODEL_REGISTRY[model_id]

    async with submission_lock:
        # 检查单并发限制（已有任务排队/运行 -> 409 busy）
        try:
            timeout = httpx.Timeout(connect=3.0, read=3.0, write=3.0, pool=3.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                queue_resp = await client.get(
                    f"{config.COMFYUI_BASE_URL}/queue",
                    headers=get_comfy_headers(),
                )
                if queue_resp.status_code != 200:
                    return JSONResponse(status_code=503, content={"error": "starting"})
                queue_data = queue_resp.json()
                running = queue_data.get("queue_running", [])
                pending = queue_data.get("queue_pending", [])
                if len(running) > 0 or len(pending) > 0:
                    return JSONResponse(status_code=409, content={"error": "busy"})
        except Exception as e:
            logger.error(f"Error querying ComfyUI queue: {e}")
            return JSONResponse(status_code=503, content={"error": "starting"})

        job_id = str(uuid.uuid4())
        seed = random.randint(0, 0xFFFFFFFFFFFFFFFF)
        ckpt_filename = model_manager.get_model_filename(model_id)
        workflow = {
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {"ckpt_name": ckpt_filename},
            },
            "2": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": prompt.strip(), "clip": ["1", 1]},
            },
            "3": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": config.FIXED_NEGATIVE_PROMPT, "clip": ["1", 1]},
            },
            "4": {
                "class_type": "EmptyLatentImage",
                "inputs": {
                    "width": dims["width"],
                    "height": dims["height"],
                    "batch_size": 1,
                },
            },
            "5": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["1", 0],
                    "positive": ["2", 0],
                    "negative": ["3", 0],
                    "latent_image": ["4", 0],
                    "seed": seed,
                    "steps": model_cfg["steps"],
                    "cfg": model_cfg["cfg"],
                    "sampler_name": model_cfg["sampler_name"],
                    "scheduler": model_cfg["scheduler"],
                    "denoise": model_cfg["denoise"],
                },
            },
            "6": {
                "class_type": "VAEDecode",
                "inputs": {"samples": ["5", 0], "vae": ["1", 2]},
            },
            "7": {
                "class_type": "SaveImage",
                "inputs": {"filename_prefix": "Pix", "images": ["6", 0]},
            },
        }

        try:
            timeout = httpx.Timeout(connect=5.0, read=5.0, write=5.0, pool=5.0)
            async with httpx.AsyncClient(timeout=timeout) as client:
                prompt_resp = await client.post(
                    f"{config.COMFYUI_BASE_URL}/prompt",
                    json={"prompt": workflow, "prompt_id": job_id},
                    headers=get_comfy_headers(),
                )
                if prompt_resp.status_code != 200:
                    logger.error(
                        f"ComfyUI prompt submission failed: {prompt_resp.status_code} {prompt_resp.text}"
                    )
                    return JSONResponse(status_code=503, content={"error": "starting"})
                prompt_data = prompt_resp.json()
                returned_id = prompt_data.get("prompt_id")
                if returned_id:
                    job_id = returned_id
        except Exception as e:
            logger.error(f"Error submitting prompt to ComfyUI: {e}")
            return JSONResponse(status_code=503, content={"error": "starting"})

        tracked_jobs[job_id] = {
            "created_at": time.time(),
            "prompt": prompt,
            "size": size,
            "seed": seed,
            "model": model_id,
        }
        return JSONResponse(status_code=202, content={"jobId": job_id})


@app.get("/status/{job_id}")
async def get_status(job_id: str):
    timeout = httpx.Timeout(connect=3.0, read=3.0, write=3.0, pool=3.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            # 1. 检查 history
            hist_resp = await client.get(
                f"{config.COMFYUI_BASE_URL}/history/{job_id}",
                headers=get_comfy_headers(),
            )
            if hist_resp.status_code == 200:
                hist_data = hist_resp.json()
                if job_id in hist_data:
                    entry = hist_data[job_id]
                    status = entry.get("status", {})
                    status_str = status.get("status_str")
                    completed = status.get("completed", False)
                    if status_str == "success" or completed:
                        return {"state": "done"}
                    else:
                        messages = status.get("messages", [])
                        error_msg = "; ".join(str(m) for m in messages) if messages else "execution failed"
                        return {"state": "error", "error": error_msg}

            # 2. 检查 queue
            queue_resp = await client.get(
                f"{config.COMFYUI_BASE_URL}/queue",
                headers=get_comfy_headers(),
            )
            if queue_resp.status_code == 200:
                queue_data = queue_resp.json()
                running = queue_data.get("queue_running", [])
                for item in running:
                    if len(item) > 1 and item[1] == job_id:
                        return {"state": "running"}

                pending = queue_data.get("queue_pending", [])
                for item in pending:
                    if len(item) > 1 and item[1] == job_id:
                        return {"state": "queued"}

            # 3. 检查代理自身追踪记录（60秒内过渡态视作 running，超时或未知返回 404）
            if job_id in tracked_jobs:
                if time.time() - tracked_jobs[job_id]["created_at"] < 60:
                    return {"state": "running"}

            return JSONResponse(status_code=404, content={"error": "job not found"})
    except Exception as e:
        logger.error(f"Error querying job status: {e}")
        if job_id in tracked_jobs and time.time() - tracked_jobs[job_id]["created_at"] < 60:
            return {"state": "running"}
        return JSONResponse(status_code=500, content={"error": "failed to query status"})


@app.get("/image/{job_id}")
async def get_image(job_id: str):
    timeout = httpx.Timeout(connect=5.0, read=30.0, write=5.0, pool=5.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            hist_resp = await client.get(
                f"{config.COMFYUI_BASE_URL}/history/{job_id}",
                headers=get_comfy_headers(),
            )
            if hist_resp.status_code != 200 or job_id not in hist_resp.json():
                # 未完成或未知任务：检查是否还在队列
                queue_resp = await client.get(
                    f"{config.COMFYUI_BASE_URL}/queue",
                    headers=get_comfy_headers(),
                )
                if queue_resp.status_code == 200:
                    queue_data = queue_resp.json()
                    running = queue_data.get("queue_running", [])
                    pending = queue_data.get("queue_pending", [])
                    for item in running + pending:
                        if len(item) > 1 and item[1] == job_id:
                            return JSONResponse(status_code=409, content={"error": "job not ready"})

                if job_id in tracked_jobs and time.time() - tracked_jobs[job_id]["created_at"] < 600:
                    return JSONResponse(status_code=409, content={"error": "job not ready"})

                return JSONResponse(status_code=404, content={"error": "job not found"})

            entry = hist_resp.json()[job_id]
            status = entry.get("status", {})
            if status.get("status_str") != "success" and not status.get("completed", False):
                return JSONResponse(status_code=500, content={"error": "generation failed"})

            outputs = entry.get("outputs", {})
            image_info = None
            for node_id, node_output in outputs.items():
                if "images" in node_output and len(node_output["images"]) > 0:
                    image_info = node_output["images"][0]
                    break

            if not image_info:
                return JSONResponse(status_code=404, content={"error": "no image found in job outputs"})

            filename = image_info["filename"]
            subfolder = image_info.get("subfolder", "")
            img_type = image_info.get("type", "output")

            view_resp = await client.get(
                f"{config.COMFYUI_BASE_URL}/view",
                params={"filename": filename, "subfolder": subfolder, "type": img_type},
                headers=get_comfy_headers(),
            )
            if view_resp.status_code != 200:
                return JSONResponse(status_code=view_resp.status_code, content={"error": "failed to retrieve image from ComfyUI"})

            return Response(content=view_resp.content, media_type="image/png")
    except Exception as e:
        logger.error(f"Error fetching image for {job_id}: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.PROXY_HOST, port=config.PROXY_PORT)
