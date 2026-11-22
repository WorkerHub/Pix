#!/bin/bash
set -e

echo "[pix-service] Starting container entrypoint..."

# 确保模型目录与输出目录存在
mkdir -p /app/ComfyUI/models/checkpoints
mkdir -p /app/ComfyUI/models/loras
mkdir -p /app/ComfyUI/output
mkdir -p /app/ComfyUI/user

# 信号处理：优雅关闭 ComfyUI
cleanup() {
    echo "[pix-service] Shutting down ComfyUI..."
    if [ -n "$COMFY_PID" ]; then
        kill -TERM "$COMFY_PID" 2>/dev/null || true
        wait "$COMFY_PID" 2>/dev/null || true
    fi
    exit 0
}
trap cleanup SIGTERM SIGINT

# 入口脚本先起 ComfyUI（只听容器内 127.0.0.1:8188）
echo "[pix-service] Launching ComfyUI on 127.0.0.1:8188 (CPU mode)..."
python3 /app/ComfyUI/main.py \
    --listen 127.0.0.1 \
    --port 8188 \
    --cpu \
    --disable-auto-launch \
    --disable-metadata &
COMFY_PID=$!

# 前台运行代理（端口 8190）
echo "[pix-service] Starting proxy on port 8190..."
export PYTHONPATH="/app:${PYTHONPATH}"
exec python3 -u -m machine.proxy
