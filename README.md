# joshmckee.com

A retro 3D research office you can click around in. It's a plain static site
for GitHub Pages: no build step, no dependencies to install.

Everything the office shows (reports, books, tapes, links) comes from the
HTML in `index.html`. That same HTML is the accessible text version, so search
engines, screen readers and browsers without WebGL still get the content.

## Preview locally

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` straight from the filesystem won't work. Browsers block
ES modules over `file://`.

## Editing content

All content lives in `index.html`, inside `<main id="text-version">`.

### Add a research report

Copy one `<article class="report">` block inside `<div class="reports">` and edit it:

```html
<article class="report" data-id="cost" data-ticker="COST" data-exchange="NASDAQ"
         data-company="Costco" data-image="assets/img/research/costco.jpg">
  <p class="report-meta"><span class="report-ticker">NASDAQ: COST</span> <time datetime="2025-03-01">March 1, 2025</time></p>
  <h3 class="report-title"><a href="https://…" target="_blank" rel="noopener">Costco: …</a></h3>
  <p class="report-dek">One-line question or thesis.</p>
  <figure class="report-figure">
    <img src="assets/img/research/costco.jpg" alt="Describe the chart" width="700" height="400" loading="lazy">
  </figure>
</article>
```

- `data-id` must be unique. It's used in links like `/#report/cost`.
- Put the chart image in `assets/img/research/`. It's printed on the paper pile
  on the desk and redrawn in green phosphor on the CRT.
- The desk has room for four piles. Any further reports still appear in the terminal.

### Add a book to the library

Add an `<li class="item">` to one of the shelves in `<section id="library">`:

```html
<li class="item" data-id="akre" data-spine="AKRE LETTERS" data-mark="C.A.">
  <h4 class="item-title"><a href="https://…" target="_blank" rel="noopener">Akre Capital letters</a></h4>
  <p class="item-by">Chuck Akre</p>
  <p class="item-desc">One or two sentences.</p>
</li>
```

`data-spine` is the gold-foil title on the spine; keep it to about 12 characters.
`data-mark` is the small text at the foot of the spine. The shelf holds about
ten books comfortably.

### Add a podcast tape

Same pattern inside `<section id="podcasts">`, with `data-short` for the
cassette label (two words read best). The credenza holds up to six tapes.

## How it's built

| File | What it does |
| --- | --- |
| `assets/js/main.js` | Boot, navigation, clicking, animation loop |
| `assets/js/room.js` · `shelves.js` · `desk.js` · `decor.js` | The office, built from code (no 3D model files) |
| `assets/js/textures.js` | Every texture is pixel art drawn at load time |
| `assets/js/post.js` | Low-res render, sunbeams, bloom, dithering, CRT effect |
| `assets/js/ui.js` | Panels, terminal, boot screen, hint markers, text mode |
| `assets/js/audio.js` | Synthesised sound effects (off by default) |
| `assets/css/office.css` | All styling, including the text version |
| `assets/vendor/three.module.min.js` | three.js r170 (MIT licence) |

Useful URL switches while working on it: `?shot` (skip the intro),
`?view=library` (jump to a camera view), `?open=report:ulta` (open a panel),
`?raw` (no retro effects), `?nodither`, `?noshaft`, `?lowh=240` (render height),
`?text` (text version).

Nothing on this site is investment advice.
