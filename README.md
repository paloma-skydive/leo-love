# leo-love

Leo's family keepsake app — a private, password-gated photo/video feed,
milestones timeline, and family tree for baby Leo.

Runs as a Docker web service on Render with a persistent disk for media.

- `server.ts` — Node/Express app (run with `npm start`)
- `public/` — front-end (Bennie design system)
- `seed/` — first-boot snapshot copied onto the persistent disk (`DATA_DIR`)
- `Dockerfile` — bakes in ffmpeg + imagemagick for phone media conversion
- `render.yaml` — Render blueprint (web service + 2GB disk at /var/data)

Env: `PORT` (Render-set), `DATA_DIR` (persistent disk mount, e.g. /var/data).
