FROM debian:bookworm-slim AS media
ARG FFMPEG_VERSION=8.1.3
ARG WHISPER_VERSION=1.9.5
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates cmake curl nasm pkg-config xz-utils \
    libass-dev libgnutls28-dev libqrencode-dev libx264-dev \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN curl -fsSL --retry 3 "https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/refs/tags/v${WHISPER_VERSION}" -o whisper.tar.gz \
 && mkdir whisper && tar -xzf whisper.tar.gz -C whisper --strip-components=1 \
 && cmake -S whisper -B whisper/build -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX=/opt/cliparia-media -DCMAKE_INSTALL_LIBDIR=lib \
    -DBUILD_SHARED_LIBS=ON -DGGML_NATIVE=OFF -DWHISPER_BUILD_EXAMPLES=OFF \
    -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
 && cmake --build whisper/build --parallel 2 \
 && cmake --install whisper/build \
 && echo /opt/cliparia-media/lib > /etc/ld.so.conf.d/cliparia-media.conf \
 && ldconfig
RUN curl -fsSL --retry 3 "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" -o ffmpeg.tar.xz \
 && mkdir ffmpeg && tar -xJf ffmpeg.tar.xz -C ffmpeg --strip-components=1 \
 && cd ffmpeg \
 && PKG_CONFIG_PATH=/opt/cliparia-media/lib/pkgconfig LD_LIBRARY_PATH=/opt/cliparia-media/lib \
    ./configure --prefix=/opt/cliparia-media --disable-autodetect --disable-doc \
    --disable-ffplay --enable-gpl --enable-gnutls --enable-libass --enable-libqrencode \
    --enable-libx264 --enable-whisper --extra-ldflags=-Wl,-rpath-link,/opt/cliparia-media/lib \
 && make -j"$(nproc)" ffmpeg ffprobe \
 && install -Dm755 ffmpeg /opt/cliparia-media/bin/ffmpeg \
 && install -Dm755 ffprobe /opt/cliparia-media/bin/ffprobe

ARG TARGETARCH
RUN case "$TARGETARCH" in \
      amd64) checksum=e1bc0cf084fd9e590554fe769a86b1db46701c3f847a43d902f7b974a4e16298 ;; \
      arm64) checksum=72e0d05a67e09da87cf495e409a28c3cc5994dd23fc66a982eebea6a55923b7d ;; \
      *) exit 1 ;; \
    esac \
 && curl -fsSL --retry 3 "https://github.com/cloudflare/cloudflared/releases/download/2026.10.5/cloudflared-linux-${TARGETARCH}" -o /tmp/cloudflared \
 && echo "$checksum  /tmp/cloudflared" | sha256sum -c - \
 && install -m755 /tmp/cloudflared /opt/cliparia-media/bin/cloudflared \
 && /opt/cliparia-media/bin/cloudflared --version \
 && rm /tmp/cloudflared

FROM node:22-bookworm-slim
COPY --from=media /opt/cliparia-media/ /opt/cliparia-media/
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-dejavu-core libass9 libgnutls30 libgomp1 libqrencode4 libx264-164 python3-venv \
 && echo /opt/cliparia-media/lib > /etc/ld.so.conf.d/cliparia-media.conf \
 && ldconfig \
 && python3 -m venv /opt/cliparia-tools \
 && /opt/cliparia-tools/bin/pip install --no-cache-dir 'yt-dlp[default,curl-cffi]' \
 && /opt/cliparia-media/bin/ffmpeg -hide_banner -filters | grep -E '(^|[[:space:]])whisper[[:space:]]' \
 && /opt/cliparia-media/bin/ffmpeg -hide_banner -filters | grep -E '(^|[[:space:]])ass[[:space:]]' \
 && /opt/cliparia-media/bin/ffmpeg -hide_banner -encoders | grep -E '(^|[[:space:]])libx264[[:space:]]' \
 && rm -rf /var/lib/apt/lists/*
ENV PATH="/opt/cliparia-media/bin:/opt/cliparia-tools/bin:$PATH" CLIPARIA_DATA="/data" CLIPARIA_BIND="0.0.0.0"
WORKDIR /app
COPY --chown=node:node *.mjs ./
COPY --chown=node:node public/ public/
COPY --chown=node:node vendor/ vendor/
RUN mkdir /data && chown node:node /data
ARG CLIPARIA_BUILD_MODEL=0
RUN if [ "$CLIPARIA_BUILD_MODEL" = 1 ]; then mkdir -p /opt/cliparia-model && node --input-type=module -e "import {installModel} from './speech.mjs'; await installModel('/opt/cliparia-model')"; fi
USER node
CMD ["node","app.mjs"]
