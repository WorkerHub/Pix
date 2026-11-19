import os

# ComfyUI internal service configuration (runs within container on 127.0.0.1:8188)
COMFYUI_HOST = os.getenv("COMFYUI_HOST", "127.0.0.1")
COMFYUI_PORT = int(os.getenv("COMFYUI_PORT", "8188"))
COMFYUI_BASE_URL = os.getenv("COMFYUI_BASE_URL", f"http://{COMFYUI_HOST}:{COMFYUI_PORT}")

# Proxy service configuration
PROXY_HOST = os.getenv("PROXY_HOST", "0.0.0.0")
PROXY_PORT = int(os.getenv("PROXY_PORT", "8190"))

# Shared authentication secret (injected via .env, shared with Worker)
PIX_SERVER_SECRET = os.getenv("PIX_SERVER_SECRET") or os.getenv("PIX_SECRET") or ""

# ComfyUI Paths
COMFYUI_DIR = os.getenv("COMFYUI_DIR", "/app/ComfyUI")
MODELS_CHECKPOINTS_DIR = os.getenv(
    "MODELS_CHECKPOINTS_DIR",
    os.path.join(COMFYUI_DIR, "models", "checkpoints"),
)

# Realistic Vision V6.0 B1 VAE Baked Model (Pinned)
DEFAULT_MODEL_NAME = "Realistic_Vision_V6.0_B1_VAE.safetensors"
DEFAULT_MODEL_URL = "https://huggingface.co/everynightdawns/Realistic_Vision_V6.0_B1_VAE/resolve/main/Realistic_Vision_V6.0_B1_VAE.safetensors"
DEFAULT_MODEL_SHA256 = "fe7578cb5ee0be63aa15baa894ab5d1751ff9b5b25ef611d5fafb2186d930c30"

MODEL_NAME = os.getenv("MODEL_NAME", DEFAULT_MODEL_NAME)
MODEL_DOWNLOAD_URL = os.getenv("MODEL_DOWNLOAD_URL", DEFAULT_MODEL_URL)
MODEL_SHA256 = os.getenv("MODEL_SHA256", DEFAULT_MODEL_SHA256)

# Skip model download (for contract testing / offline builds)
SKIP_MODEL_DOWNLOAD = os.getenv("SKIP_MODEL_DOWNLOAD", "0").lower() in ("1", "true", "yes")

# Baked Generation Parameters (Frozen)
FIXED_NEGATIVE_PROMPT = (
    "deformed, distorted, disfigured, blurry, low-res, low quality, watermark, text, logo"
)
SAMPLER_NAME = "euler_ancestral"
SCHEDULER = "normal"
STEPS = 20
CFG = 7.0
DENOISE = 1.0

SIZES = {
    "portrait": {"width": 512, "height": 768},
    "square": {"width": 512, "height": 512},
}
