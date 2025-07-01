# Base Image: La que especificaste, con Pytorch y CUDA
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

# --- PASO 1: INSTALAR DEPENDENCIAS DE SISTEMA (COMBINADAS Y CORREGIDAS) ---
# Se habilita el repositorio 'universe' y se usan los nombres de paquete correctos
RUN apt-get update && apt-get install -y software-properties-common && \
    add-apt-repository universe && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    # Dependencias de gestión
    curl supervisor nginx \
    # Dependencias de text-animate-kit (con el nombre corregido)
    chromium-browser fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    # Dependencias de nca-toolkit (incluyendo librav1e-dev del repo universe)
    ca-certificates wget tar xz-utils fonts-liberation fontconfig build-essential yasm cmake meson ninja-build nasm libssl-dev libvpx-dev libx264-dev libx265-dev libnuma-dev libmp3lame-dev libopus-dev libvorbis-dev libtheora-dev libspeex-dev libfreetype6-dev libfontconfig1-dev libgnutls28-dev libaom-dev libdav1d-dev librav1e-dev libsvtav1-dev libzimg-dev libwebp-dev git pkg-config autoconf automake libtool libfribidi-dev libharfbuzz-dev \
    && rm -rf /var/lib/apt/lists/*

# --- PASO 2: COMPILAR DEPENDENCIAS DE NCA-TOOLKIT (DESDE CÓDIGO FUENTE) ---
# Esta sección replica los pasos de compilación del Dockerfile original para asegurar compatibilidad.
# ADVERTENCIA: Este proceso puede tardar MUCHO tiempo en completarse.

# Instalar SRT
RUN git clone https://github.com/Haivision/srt.git && cd srt && mkdir build && cd build && cmake .. && make -j$(nproc) && make install && cd ../.. && rm -rf srt

# Instalar fdk-aac
RUN git clone https://github.com/mstorsjo/fdk-aac && cd fdk-aac && autoreconf -fiv && ./configure && make -j$(nproc) && make install && cd .. && rm -rf fdk-aac

# Instalar libass
RUN git clone https://github.com/adah1972/libunibreak.git && cd libunibreak && ./autogen.sh && ./configure && make -j$(nproc) && make install && ldconfig && cd .. && rm -rf libunibreak
RUN git clone https://github.com/libass/libass.git && cd libass && autoreconf -i && ./configure --enable-libunibreak && make -j$(nproc) && make install && ldconfig && cd .. && rm -rf libass

# Compilar e instalar FFmpeg con todas las librerías
RUN git clone https://git.ffmpeg.org/ffmpeg.git ffmpeg && cd ffmpeg && git checkout n7.0.2 && \
    PKG_CONFIG_PATH="/usr/local/lib/pkgconfig" ./configure --prefix=/usr/local --enable-gpl --enable-nonfree --enable-pthreads --enable-libaom --enable-libsvtav1 --enable-libvmaf --enable-libx264 --enable-libx265 --enable-libvpx --enable-libmp3lame --enable-libopus --enable-libvorbis --enable-libass --enable-libfdk-aac --enable-libsrt --enable-gnutls && \
    make -j$(nproc) && make install && cd .. && rm -rf ffmpeg

# --- PASO 3: CONFIGURAR ENTORNO DE NODE.JS (PARA TEXT-ANIMATE-KIT Y N8N) ---
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
RUN apt-get install -y nodejs

# --- PASO 4: INSTALAR APLICACIONES Y DEPENDENCIAS PYTHON/NODE ---
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