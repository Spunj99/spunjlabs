# spunjlabs.com

Static site for SpunjLabs — three pages, no build dependencies, no JavaScript.

## Layout

| Path | What it is |
|------|------------|
| `index.html`, `sky-scramble.html`, `tetragrade.html` | **Generated.** Don't edit these directly. |
| `src/` | The real sources — edit these. |
| `src/style.css` | The one stylesheet, inlined into every page at build time. |
| `img/` | All images, pre-sized and compressed for the web. |
| `build.sh` | Regenerates the three pages from `src/`. |
| `CNAME` | Custom domain for GitHub Pages (`spunjlabs.com`). |

## Making a change

```sh
# edit src/style.css or src/<page>.html, then:
sh build.sh
git add -A && git commit -m "..." && git push
```

## Deploying

Push to the repo's default branch, then in **Settings → Pages** set the source to
that branch, root folder. For the custom domain, add these DNS records at your
registrar:

```
A     @   185.199.108.153
A     @   185.199.109.153
A     @   185.199.110.153
A     @   185.199.111.153
CNAME www <your-github-username>.github.io
```

Then tick **Enforce HTTPS** in Settings → Pages once the certificate is issued
(can take a few minutes to an hour).

## Performance notes

The pages are built to pass Core Web Vitals without any tuning after the fact:

- **No external requests at all** — CSS is inlined, the favicon is an inline SVG
  data URI, and there are no web fonts or scripts. Nothing blocks rendering.
- **Every `<img>` carries `width`/`height`**, and image boxes have a fixed CSS
  `aspect-ratio`, so layout never shifts as images load (CLS ≈ 0).
- **The LCP image on each page is preloaded** with `fetchpriority="high"`;
  below-the-fold screenshots are `loading="lazy"`.
- **Images are pre-compressed** to the size they're actually displayed at, so no
  page ships more than ~230 KB of images.
- **No JavaScript**, so interaction latency (INP) is whatever the browser does.

If you add images, keep the same discipline: resize to the display size, set
`width`/`height`, and lazy-load anything below the fold.

## Adding a third game

Copy `src/tetragrade.html` as the starting point — it's the "in development"
variant, with no store link. Add a card to the `.grid` in `src/index.html`,
drop the images in `img/`, and rerun `build.sh`.
