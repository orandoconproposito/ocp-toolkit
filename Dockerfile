# Base Image: La que especificaste, con Pytorch y CUDA
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

# --- INSTALACIÓN DE DEPENDENCIAS GLOBALES ---
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Dependencias de gestión
    curl \
    supervisor \
    nginx \
    # Dependencias de text-animate-kit
    ffmpeg \
    chromium-browser \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    # Dependencias de nca-toolkit
    ca-certificates \
    wget \
    tar \
    xz-utils \
    fonts-liberation \
    fontconfig \
    build-essential \
    yasm \
    cmake \
    meson \
    ninja-build \
    nasm \
    libssl-dev \
    libvpx-dev \
    libx264-dev \
    libx265-dev \
    libnuma-dev \
    libmp3lame-dev \
    libopus-dev \
    libvorbis-dev \
    libtheora-dev \
    libspeex-dev \
    libfreetype6-dev \
    libfontconfig1-dev \
    libgnutls28-dev \
    libaom-dev \
    libdav1d-dev \
    libzimg-dev \
    libwebp-dev \
    git \
    pkg-config \
    autoconf \
    automake \
    libtool \
    libfribidi-dev \
    libharfbuzz-dev \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# --- INSTALACIÓN DE NODE.JS (PARA TEXT-ANIMATE-KIT Y N8N) ---
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# --- CONFIGURACIÓN DEL WORKSPACE ---
WORKDIR /workspace

# --- CREAR Y ACTIVAR VIRTUAL ENVIRONMENT ---
RUN python3 -m venv /workspace/venv
ENV PATH="/workspace/venv/bin:$PATH"
ENV VIRTUAL_ENV="/workspace/venv"

# --- INSTALACIÓN DE TEXT-ANIMATE-KIT ---
# Copiar solo package.json primero para aprovechar el cache de Docker
COPY text-animate-kit/package.json /workspace/text-animate-kit/
WORKDIR /workspace/text-animate-kit
RUN npm install && \
    npx playwright install chromium

# --- INSTALACIÓN DE N8N ---
RUN npm install -g n8n

# --- INSTALACIÓN DE NCA-TOOLKIT ---
WORKDIR /workspace/nca-toolkit
# Copiar solo requirements.txt primero para aprovechar el cache
COPY nca-toolkit/requirements.txt .

# VIRTUAL ENV FIX: Install packages in virtual environment
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# --- COPIAR CÓDIGO FUENTE ---
WORKDIR /workspace
COPY text-animate-kit /workspace/text-animate-kit
COPY nca-toolkit /workspace/nca-toolkit

# --- CONFIGURACIÓN DE NGINX Y SUPERVISOR ---
# Crear directorio de logs
RUN mkdir -p /workspace/logs

# Copiar configuraciones
COPY nginx.conf /etc/nginx/sites-available/default
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# --- EXPOSICIÓN DE PUERTO Y COMANDO FINAL ---
EXPOSE 8080
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]