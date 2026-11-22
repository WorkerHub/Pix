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
MODELS_LORAS_DIR = os.getenv(
    "MODELS_LORAS_DIR",
    os.path.join(COMFYUI_DIR, "models", "loras"),
)

# Realistic Vision V6.0 B1 VAE Baked Model (Pinned)
DEFAULT_MODEL_NAME = "Realistic_Vision_V6.0_B1_VAE.safetensors"
DEFAULT_MODEL_URL = "https://huggingface.co/everynightdawns/Realistic_Vision_V6.0_B1_VAE/resolve/main/Realistic_Vision_V6.0_B1_VAE.safetensors"
DEFAULT_MODEL_SHA256 = "fe7578cb5ee0be63aa15baa894ab5d1751ff9b5b25ef611d5fafb2186d930c30"

MODEL_NAME = os.getenv("MODEL_NAME", DEFAULT_MODEL_NAME)
MODEL_DOWNLOAD_URL = os.getenv("MODEL_DOWNLOAD_URL", DEFAULT_MODEL_URL)
MODEL_SHA256 = os.getenv("MODEL_SHA256", DEFAULT_MODEL_SHA256)

# LCM-LoRA (SD1.5) for LCM acceleration (Pinned)
# Official LoRA: latent-consistency/lcm-lora-sdv1-5, file pytorch_lora_weights.safetensors
DEFAULT_LORA_NAME = "lcm-lora-sdv1-5.safetensors"
DEFAULT_LORA_URL = "https://huggingface.co/latent-consistency/lcm-lora-sdv1-5/resolve/main/pytorch_lora_weights.safetensors"
DEFAULT_LORA_SHA256 = "8f90d840e075ff588a58e22c6586e2ae9a6f7922996ee6649a7f01072333afe4"

LORA_NAME = os.getenv("LORA_NAME", DEFAULT_LORA_NAME)
LORA_DOWNLOAD_URL = os.getenv("LORA_DOWNLOAD_URL", DEFAULT_LORA_URL)
LORA_SHA256 = os.getenv("LORA_SHA256", DEFAULT_LORA_SHA256)

# Offline Merged Model (Base checkpoint + LCM-LoRA baked in)
DEFAULT_MERGED_MODEL_NAME = "Realistic_Vision_V6.0_B1_LCM.safetensors"
MERGED_MODEL_NAME = os.getenv("MERGED_MODEL_NAME", DEFAULT_MERGED_MODEL_NAME)

# majicMIX realistic v7 (Pinned)
DEFAULT_MAJICMIX_MODEL_NAME = "majicmixRealistic_v7.safetensors"
DEFAULT_MAJICMIX_DOWNLOAD_URL = "https://huggingface.co/digiplay/majicMIX_realistic_v7/resolve/main/majicmixRealistic_v7.safetensors"
DEFAULT_MAJICMIX_SHA256 = "7c819b6d13663ed720c2254f4fe18373107dfef2448d337913c8fc545640881e"

MAJICMIX_MODEL_NAME = os.getenv("MAJICMIX_MODEL_NAME", DEFAULT_MAJICMIX_MODEL_NAME)
MAJICMIX_DOWNLOAD_URL = os.getenv("MAJICMIX_DOWNLOAD_URL", DEFAULT_MAJICMIX_DOWNLOAD_URL)
MAJICMIX_SHA256 = os.getenv("MAJICMIX_SHA256", DEFAULT_MAJICMIX_SHA256)

# DreamShaper 8 (Lykon/DreamShaper pruned, Pinned)
DEFAULT_DREAMSHAPER_MODEL_NAME = "DreamShaper_8_pruned.safetensors"
DEFAULT_DREAMSHAPER_DOWNLOAD_URL = "https://huggingface.co/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors"
DEFAULT_DREAMSHAPER_SHA256 = "879db523c30d3b9017143d56705015e15a2cb5628762c11d086fed9538abd7fd"

DREAMSHAPER_MODEL_NAME = os.getenv("DREAMSHAPER_MODEL_NAME", DEFAULT_DREAMSHAPER_MODEL_NAME)
DREAMSHAPER_DOWNLOAD_URL = os.getenv("DREAMSHAPER_DOWNLOAD_URL", DEFAULT_DREAMSHAPER_DOWNLOAD_URL)
DREAMSHAPER_SHA256 = os.getenv("DREAMSHAPER_SHA256", DEFAULT_DREAMSHAPER_SHA256)

# Counterfeit-V3.0 (gsdf/Counterfeit-V3.0 fix_fp16, Pinned)
DEFAULT_COUNTERFEIT_MODEL_NAME = "Counterfeit-V3.0_fix_fp16.safetensors"
DEFAULT_COUNTERFEIT_DOWNLOAD_URL = "https://huggingface.co/gsdf/Counterfeit-V3.0/resolve/main/Counterfeit-V3.0_fix_fp16.safetensors"
DEFAULT_COUNTERFEIT_SHA256 = "a54c944e4c04e9d9ca43468ef5b90ea0408bb6264829a4980de79a768df7179f"

COUNTERFEIT_MODEL_NAME = os.getenv("COUNTERFEIT_MODEL_NAME", DEFAULT_COUNTERFEIT_MODEL_NAME)
COUNTERFEIT_DOWNLOAD_URL = os.getenv("COUNTERFEIT_DOWNLOAD_URL", DEFAULT_COUNTERFEIT_DOWNLOAD_URL)
COUNTERFEIT_SHA256 = os.getenv("COUNTERFEIT_SHA256", DEFAULT_COUNTERFEIT_SHA256)

# Photon V1 (Civitai 84728 / version 90072, Pinned)
DEFAULT_PHOTON_MODEL_NAME = "Photon_v1.safetensors"
DEFAULT_PHOTON_DOWNLOAD_URL = "https://civitai.com/api/download/models/90072"
DEFAULT_PHOTON_SHA256 = "ec41bd2a8271acde4ae81cac004d9f3300e7fb0870eae8cbfe0bbc4ef8e27f91"

PHOTON_MODEL_NAME = os.getenv("PHOTON_MODEL_NAME", DEFAULT_PHOTON_MODEL_NAME)
PHOTON_DOWNLOAD_URL = os.getenv("PHOTON_DOWNLOAD_URL", DEFAULT_PHOTON_DOWNLOAD_URL)
PHOTON_SHA256 = os.getenv("PHOTON_SHA256", DEFAULT_PHOTON_SHA256)

# CyberRealistic v3.2 (ckpt/CyberRealistic, Pinned)
DEFAULT_CYBERREALISTIC_MODEL_NAME = "cyberrealistic_v32.safetensors"
DEFAULT_CYBERREALISTIC_DOWNLOAD_URL = "https://huggingface.co/ckpt/CyberRealistic/resolve/main/cyberrealistic_v32.safetensors"
DEFAULT_CYBERREALISTIC_SHA256 = "9584e2c050bf081141f470689d303a1239246eda12bc21894f8907f053ef595a"

CYBERREALISTIC_MODEL_NAME = os.getenv("CYBERREALISTIC_MODEL_NAME", DEFAULT_CYBERREALISTIC_MODEL_NAME)
CYBERREALISTIC_DOWNLOAD_URL = os.getenv("CYBERREALISTIC_DOWNLOAD_URL", DEFAULT_CYBERREALISTIC_DOWNLOAD_URL)
CYBERREALISTIC_SHA256 = os.getenv("CYBERREALISTIC_SHA256", DEFAULT_CYBERREALISTIC_SHA256)

# OpenJourney v4 (prompthero/openjourney-v4, Pinned)
DEFAULT_OPENJOURNEY_MODEL_NAME = "openjourney-v4.ckpt"
DEFAULT_OPENJOURNEY_DOWNLOAD_URL = "https://huggingface.co/prompthero/openjourney-v4/resolve/main/openjourney-v4.ckpt"
DEFAULT_OPENJOURNEY_SHA256 = "02e37aad9f74f574808ad456043b89e8c6b24e22828743fcf002168f76493d9b"

OPENJOURNEY_MODEL_NAME = os.getenv("OPENJOURNEY_MODEL_NAME", DEFAULT_OPENJOURNEY_MODEL_NAME)
OPENJOURNEY_DOWNLOAD_URL = os.getenv("OPENJOURNEY_DOWNLOAD_URL", DEFAULT_OPENJOURNEY_DOWNLOAD_URL)
OPENJOURNEY_SHA256 = os.getenv("OPENJOURNEY_SHA256", DEFAULT_OPENJOURNEY_SHA256)

# ToonYou alpha3 (ckpt/toonyou, Pinned)
DEFAULT_TOONYOU_MODEL_NAME = "toonyou_alpha3.safetensors"
DEFAULT_TOONYOU_DOWNLOAD_URL = "https://huggingface.co/ckpt/toonyou/resolve/main/toonyou_alpha3.safetensors"
DEFAULT_TOONYOU_SHA256 = "d6b4207a8ea237660de15b58ce9bf7195d5595d3f99bdaf1c6ce87db88700cb5"

TOONYOU_MODEL_NAME = os.getenv("TOONYOU_MODEL_NAME", DEFAULT_TOONYOU_MODEL_NAME)
TOONYOU_DOWNLOAD_URL = os.getenv("TOONYOU_DOWNLOAD_URL", DEFAULT_TOONYOU_DOWNLOAD_URL)
TOONYOU_SHA256 = os.getenv("TOONYOU_SHA256", DEFAULT_TOONYOU_SHA256)

# Pinned Checkpoints Registry
CHECKPOINTS = {
    "realistic_vision": {
        "filename": MODEL_NAME,
        "url": MODEL_DOWNLOAD_URL,
        "sha256": MODEL_SHA256,
    },
    "majicmix": {
        "filename": MAJICMIX_MODEL_NAME,
        "url": MAJICMIX_DOWNLOAD_URL,
        "sha256": MAJICMIX_SHA256,
    },
    "dreamshaper": {
        "filename": DREAMSHAPER_MODEL_NAME,
        "url": DREAMSHAPER_DOWNLOAD_URL,
        "sha256": DREAMSHAPER_SHA256,
    },
    "counterfeit": {
        "filename": COUNTERFEIT_MODEL_NAME,
        "url": COUNTERFEIT_DOWNLOAD_URL,
        "sha256": COUNTERFEIT_SHA256,
    },
    "photon": {
        "filename": PHOTON_MODEL_NAME,
        "url": PHOTON_DOWNLOAD_URL,
        "sha256": PHOTON_SHA256,
    },
    "cyberrealistic": {
        "filename": CYBERREALISTIC_MODEL_NAME,
        "url": CYBERREALISTIC_DOWNLOAD_URL,
        "sha256": CYBERREALISTIC_SHA256,
    },
    "openjourney": {
        "filename": OPENJOURNEY_MODEL_NAME,
        "url": OPENJOURNEY_DOWNLOAD_URL,
        "sha256": OPENJOURNEY_SHA256,
    },
    "toonyou": {
        "filename": TOONYOU_MODEL_NAME,
        "url": TOONYOU_DOWNLOAD_URL,
        "sha256": TOONYOU_SHA256,
    },
}

# Pinned LoRAs Registry
LORAS = {
    "lcm": {
        "filename": LORA_NAME,
        "url": LORA_DOWNLOAD_URL,
        "sha256": LORA_SHA256,
    }
}

# Supported Model Options Catalog
# "merged": True 表示该模型使用首启时离线合并了 LCM-LoRA 的 checkpoint，
# 运行时不再挂载 LoraLoader（避免动态补丁导致 OOM）。
MODEL_REGISTRY = {
    "realistic-lcm": {
        "id": "realistic-lcm",
        "name": "写实·极速",
        "checkpoint_key": "realistic_vision",
        "merged": True,
        "steps": 8,
        "cfg": 1.5,
        "sampler_name": "lcm",
        "scheduler": "sgm_uniform",
        "denoise": 1.0,
    },
    "realistic": {
        "id": "realistic",
        "name": "写实·原版",
        "checkpoint_key": "realistic_vision",
        "merged": False,
        "steps": 20,
        "cfg": 7.0,
        "sampler_name": "euler_ancestral",
        "scheduler": "normal",
        "denoise": 1.0,
    },
    "majicmix": {
        "id": "majicmix",
        "name": "人像·东方",
        "checkpoint_key": "majicmix",
        "merged": False,
        "steps": 20,
        "cfg": 7.0,
        "sampler_name": "euler_ancestral",
        "scheduler": "normal",
        "denoise": 1.0,
    },
    "dreamshaper": {
        "id": "dreamshaper",
        "name": "通用·梦境",
        "checkpoint_key": "dreamshaper",
        "merged": False,
        "steps": 20,
        "cfg": 7.0,
        "sampler_name": "euler_ancestral",
        "scheduler": "normal",
        "denoise": 1.0,
    },
    "counterfeit": {
        "id": "counterfeit",
        "name": "动漫",
        "checkpoint_key": "counterfeit",
        "merged": False,
        "steps": 20,
        "cfg": 7.0,
        "sampler_name": "euler_ancestral",
        "scheduler": "normal",
        "denoise": 1.0,
    },
    "photon": {
        "id": "photon",
        "name": "人像·光子",
        "checkpoint_key": "photon",
        "merged": False,
        "steps": 20,
        "cfg": 7.0,
        "sampler_name": "euler_ancestral",
        "scheduler": "normal",
        "denoise": 1.0,
    },
    "cyberrealistic": {
        "id": "cyberrealistic",
        "name": "写实·纪实",
        "checkpoint_key": "cyberrealistic",
        "merged": False,
        "steps": 20,
        "cfg": 7.0,
        "sampler_name": "euler_ancestral",
        "scheduler": "normal",
        "denoise": 1.0,
    },
    "openjourney": {
        "id": "openjourney",
        "name": "插画·旅程",
        "checkpoint_key": "openjourney",
        "merged": False,
        "steps": 20,
        "cfg": 7.0,
        "sampler_name": "euler_ancestral",
        "scheduler": "normal",
        "denoise": 1.0,
    },
    "toonyou": {
        "id": "toonyou",
        "name": "卡通",
        "checkpoint_key": "toonyou",
        "merged": False,
        "steps": 20,
        "cfg": 7.0,
        "sampler_name": "euler_ancestral",
        "scheduler": "normal",
        "denoise": 1.0,
    },
}

DEFAULT_MODEL_ID = os.getenv("DEFAULT_MODEL_ID", "realistic-lcm")

# Skip model download (for contract testing / offline builds)
SKIP_MODEL_DOWNLOAD = os.getenv("SKIP_MODEL_DOWNLOAD", "0").lower() in ("1", "true", "yes")

# Baked Generation Parameters (Frozen)
FIXED_NEGATIVE_PROMPT = (
    "deformed, distorted, disfigured, blurry, low-res, low quality, watermark, text, logo"
)

SIZES = {
    "portrait": {"width": 512, "height": 768},
    "square": {"width": 512, "height": 512},
}
