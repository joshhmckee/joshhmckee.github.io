# joshmckee.com

A retro 3D research office you can click around in. It's a plain static site
for GitHub Pages: no build step, no dependencies to install.

With a mouse you see through the eyes of someone standing in the office: there's no cursor over
it, just a dot in the middle of the view, and the view follows the mouse. Click once and the
mouse turns the view as far and as fast as you move it, as in a game; Esc gives the cursor back,
and Esc again steps back. A panel (the library, the terminal and so on) brings the cursor back
while it's open. On phones, drag to look around and tap things.

Point the dot at something you can use and a prompt says what it does ("E Use the computer");
press E or click. On your feet you have to be within reach of it. The desk chair you can sit in:
look around and it swivels with you, and it stays turned the way you leave it when you get up (E,
Esc or a walking key). You can't walk through it, but you can hold the click on it and look (or
drag) to move it, and the library ladder slides the same way.

To walk around, use W A S D (the arrow keys turn; hold Shift to run), or click the floor where
you want to go. You speed up and slow down like a person rather than starting and stopping dead,
and the view has a gentle step, sway and breath to it. Esc goes back to the starting view.

Click the door in the right-hand wall (or choose Outside in the keyboard menu) and you walk over
and open it; from there it's up to you. Walk out onto the balcony, round the chalet and up the
yard behind it, or click the snow to walk there. The door also opens if you walk into it, and
it's pulled shut once you've been through and walked on. Press Esc or use the Back inside button
to walk back in.

Everything the office shows (reports, books, tapes, links) comes from the
HTML in `index.html`, so search engines and screen readers get the content too.
Keyboard users can press Tab to reveal a small menu.

## Preview locally

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` straight from the filesystem won't work. Browsers block
ES modules over `file://`.

## Editing content

All content lives in `index.html`, inside `<main id="content">`.

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

Same pattern inside the Podcasts shelf of `<section id="podcasts">`, with `data-short` for the
cassette label (two words read best). The credenza holds up to six tapes.

### Add a mixtape

Mixtapes go in the Mixtapes shelf of the same section. Pick one and its cassette flies into
the deck and plays through YouTube's embedded player, which loads only then and stays on screen
in a small "now playing" card while the song plays:

```html
<li class="item song" data-id="softcore" data-short="SOFTCORE" data-youtube="ggG9ySCChYw">
  <h4 class="item-title"><a href="https://www.youtube.com/watch?v=ggG9ySCChYw" target="_blank" rel="noopener">Softcore</a></h4>
  <p class="item-by">The Neighbourhood</p>
</li>
```

`data-youtube` is the video ID from the YouTube link. Use an official upload that allows
embedding. The holder beside the deck takes five tapes.

## How it's built

| File | What it does |
| --- | --- |
| `assets/js/main.js` | Boot, navigation, clicking and dragging, walking (and in and out of the door), the tape deck, animation loop |
| `assets/js/room.js` · `shelves.js` · `desk.js` · `decor.js` | The office, built from code (no 3D model files) |
| `assets/js/textures.js` | Every texture is drawn in code at load time |
| `assets/js/post.js` | Rendering: the outdoors (through the window and door, or all round once you're out), sunbeams, ambient occlusion, bloom, tone mapping, anti-aliasing |
| `assets/js/dog.js` | The long-haired dachshund: body, hair, trot, wandering and naps |
| `assets/js/plants.js` | Rubber plant, snake plant and pothos |
| `assets/js/outdoors.js` | Everything outside: the chalet itself, its cliff-edge balcony and the wooded mountainside behind it, and the valley, its village and the ski mountain across it (terrain, runs, forest, chairlifts, skiers, the heli-ski helicopter) |
| `assets/js/music.js` | The mixtape player (YouTube's embedded player, loaded on first use) |
| `assets/js/diploma.js` | The framed University of Waterloo degree (drawn in code, with gold foil and glass) |
| `assets/js/ui.js` | Content cards, terminal, boot screen, hint markers |
| `assets/css/office.css` | All styling |
| `assets/vendor/three.module.min.js` | three.js r170 (MIT licence) |

Useful URL switches while working on it: `?shot` (skip the intro),
`?view=library` (jump to a camera view; `?view=outside` for the balcony), `?open=report:ulta` (open a panel),
`?raw` (no post-processing), `?noshaft`, `?lowh=600` (render height).

Nothing on this site is investment advice.
