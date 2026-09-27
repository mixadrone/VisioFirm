# ──────────────────────────────────────────────
# VisioFirm — Docker image
# Base: python:3.12-slim (stable with ultralytics,
#        torch+cu126, groundingdino-py, SAM2)
# ──────────────────────────────────────────────
FROM python:3.12-slim

# Standard Python env vars: disable .pyc files and
# force unbuffered stdout/stderr for cleaner logs
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install OS-level build dependencies required by
# some Python packages (e.g. OpenCV, groundingdino)
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        git \
        libglib2.0-0 \
        libgl1 \
        libsm6 \
        libxext6 \
        libxrender1 \
        libgomp1 \
        libfontconfig1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy project source (respects .dockerignore)
COPY . .

# Install all Python dependencies from requirements.txt first.
# requirements.txt contains a `-e file:///Z:/...` line (Windows editable install)
# that is meaningless inside the container — strip it with grep before piping to pip.
# torch cu126 wheel index is specified because pip may not find it on PyPI.
RUN pip install --upgrade pip && \
    grep -v '^\s*-e\s' requirements.txt > /tmp/requirements_clean.txt && \
    pip install --no-cache-dir \
        --extra-index-url https://download.pytorch.org/whl/cu126 \
        -r /tmp/requirements_clean.txt && \
    # Install VisioFirm itself in editable mode so that the
    # visiofirm package is importable from any working directory
    pip install --no-cache-dir -e .

# Expose the application port
EXPOSE 9000

# Launch via uvicorn using the factory pattern.
# --host 0.0.0.0 is required to be reachable from outside the container.
# --factory tells uvicorn that create_app is a callable that returns the ASGI app.
CMD ["uvicorn", "visiofirm.create_app:create_app", \
     "--factory", \
     "--host", "0.0.0.0", \
     "--port", "9000", \
     "--log-level", "info"]
