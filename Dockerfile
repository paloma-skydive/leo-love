FROM node:24-slim

# ffmpeg + imagemagick power the media normalisation (iPhone HEVC/.mov -> MP4,
# HEIC -> JPEG, EXIF rotation, resizing). Without these, some phone uploads
# won't play in browsers — so they're baked into the image.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg imagemagick \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for better layer caching.
COPY package.json ./
RUN npm install --omit=dev

# App source + first-boot data snapshot.
COPY server.ts ./
COPY public ./public
COPY seed ./seed

# Render sets PORT; the app also reads DATA_DIR for the persistent disk mount.
ENV NODE_ENV=production
EXPOSE 3001

CMD ["npm", "start"]
