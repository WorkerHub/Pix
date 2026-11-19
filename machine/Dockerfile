FROM python:3.11-slim

# Prevent python from writing pyc files and enable unbuffered output
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive

# System dependencies: git to clone pinned ComfyUI, curl, libgl1/libglib for graphics/image processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Pin ComfyUI commit / tag (v0.9.2: commit 8f40b43e0204d5b9780f3e9618e140e929e80594)
ARG COMFYUI_VERSION=v0.9.2
RUN git clone --depth 1 --branch ${COMFYUI_VERSION} https://github.com/comfyanonymous/ComfyUI.git /app/ComfyUI \
    && rm -rf /app/ComfyUI/.git

# Install PyTorch CPU first to avoid pulling massive CUDA wheels
RUN pip install --no-cache-dir \
    torch torchvision torchaudio \
    --index-url https://download.pytorch.org/whl/cpu

# Install ComfyUI dependencies
RUN pip install --no-cache-dir -r /app/ComfyUI/requirements.txt

# ComfyUI v0.9.2 app/frontend_management.py imports requests which upstream requirements omits
RUN pip install --no-cache-dir requests

# Copy proxy requirements and install
COPY requirements.txt /app/machine/requirements.txt
RUN pip install --no-cache-dir -r /app/machine/requirements.txt

# Copy machine package
COPY . /app/machine/

# Ensure entrypoint is executable
RUN chmod +x /app/machine/entrypoint.sh

# Volumes for host persistence (models, output, user data)
VOLUME ["/app/ComfyUI/models/checkpoints", "/app/ComfyUI/output", "/app/ComfyUI/user"]

# Expose proxy port (ComfyUI 8188 is strictly internal 127.0.0.1)
EXPOSE 8190

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python3 -c "import urllib.request, os; secret=os.getenv('PIX_SERVER_SECRET', ''); req=urllib.request.Request('http://127.0.0.1:8190/health', headers={'X-Pix-Secret': secret}); res=urllib.request.urlopen(req, timeout=4); exit(0 if res.status == 200 else 1)" || exit 1

ENTRYPOINT ["/app/machine/entrypoint.sh"]
