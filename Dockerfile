# Base Image: La que especificaste, con Pytorch y CUDA
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

# --- INSTALACIÓN DE DEPENDENCIAS GLOBALES ---
RUN apt-get update && apt-get install -y software-properties-common && \
    add-apt-repository universe && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    # Dependencias de gestión
    curl supervisor nginx \
    # Dependencias de text-animate-kit
    ffmpeg \
    chromium-browser \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    # Dependencias de nca-toolkit
    ca-certificates wget tar xz-utils fonts-liberation fontconfig build-essential yasm cmake meson ninja-build nasm libssl-dev libvpx-dev libx264-dev libx265-dev libnuma-dev libmp3lame-dev libopus-dev libvorbis-dev libtheora-dev libspeex-dev libfreetype6-dev libfontconfig1-dev libgnutls28-dev libaom-dev libdav1d-dev librav1e-dev libsvtav1-dev libzimg-dev libwebp-dev git pkg-config autoconf automake libtool libfribidi-dev libharfbuzz-dev \
    && rm -rf /var/lib/apt/lists/*

# --- PASO 2: CONFIGURAR ENTORNO DE NODE.JS (PARA TEXT-ANIMATE-KIT Y N8N) ---
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
RUN apt-get install -y nodejs

# --- PASO 3: INSTALAR APLICACIONES Y DEPENDENCIAS PYTHON/NODE ---
WORKDIR /workspace

# Instalar dependencias de text-animate-kit y n8n
COPY text-animate-kit/package.json /workspace/text-animate-kit/
WORKDIR /workspace/text-animate-kit
RUN npm install
RUN npx playwright install chromium-browser
RUN npm install -g n8n

# Instalar dependencias de nca-toolkit
WORKDIR /workspace/nca-toolkit
COPY nca-toolkit/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip
RUN pip install --no-cache-dir -r requirements.txt

# --- PASO 5: COPIAR CÓDIGO FUENTE Y ARCHIVOS DE CONFIGURACIÓN ---
WORKDIR /workspace
COPY text-animate-kit /workspace/text-animate-kit
COPY nca-toolkit /workspace/nca-toolkit

# Crear directorio de logs y copiar configuraciones
RUN mkdir -p /workspace/logs
COPY nginx.conf /etc/nginx/sites-available/default
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# --- PASO 6: EXPOSICIÓN DE PUERTO Y COMANDO FINAL ---
EXPOSE 8080
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]