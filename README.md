<div align="center">

# Portent

Shake a real 3D magic 8 ball for a verdict, with the classic 20 answers or a deck imported from your own lists

[![Live][badge-site]][url-site]
[![HTML5][badge-html]][url-html]
[![CSS3][badge-css]][url-css]
[![JavaScript][badge-js]][url-js]
[![Claude Code][badge-claude]][url-claude]
[![License][badge-license]](LICENSE)

[badge-site]:    https://img.shields.io/badge/live_site-0063e5?style=for-the-badge&logo=googlechrome&logoColor=white
[badge-html]:    https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white
[badge-css]:     https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white
[badge-js]:      https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black
[badge-claude]:  https://img.shields.io/badge/Claude_Code-CC785C?style=for-the-badge&logo=anthropic&logoColor=white
[badge-license]: https://img.shields.io/badge/license-MIT-404040?style=for-the-badge

[url-site]:   https://portent.neorgon.com/
[url-html]:   #
[url-css]:    #
[url-js]:     #
[url-claude]: https://claude.ai/code

</div>

---

## Overview

A magic 8 ball rendered in 3D, with the loop the real toy has: shake it, the die
sinks out of sight, the ball spins down, and the die rises into a window that turns
toward you. Nothing is decided until it comes to rest, so
it cannot be used as a button that prints a random string.

It ships the original twenty answers. It can also read a deck from a Stack Rank
list, a pasted list, or a JSON file, and hand the result to another page: a share
link carries the deck in its URL fragment, and an iframe embed answers questions
the host page asks it over `postMessage`.

**Live:** portent.neorgon.com

---

## Features

- **Shake it however you like** -- grab and fling it with the mouse or a finger,
  press Space, nudge it with the arrow keys, shake the phone, or shout at it.
  A hard throw briefly cracks the shell
- **A real reveal** -- the die sinks, rises and turns upright in the window so
  its answer is readable when the ball settles
- **The original twenty** -- or your own deck, edited in place, with each answer
  tagged affirmative, non-committal or negative
- **Import from Stack Rank** -- open items become answers and priority becomes the
  tone, so P1 reads as affirmative and anything blocked reads as negative
- **Share without a server** -- the deck travels in the URL fragment, which never
  reaches one
- **Embed it anywhere** -- `embed.html` is a component: no storage, no shortcuts,
  no header. A host page can shake it, swap its deck and read the answer back
- **Works without WebGL** -- a flat CSS twin takes over, and the answer always
  exists as text in a live region for a screen reader

---

## Running locally

ES modules require an HTTP server (not `file://`):

```bash
make serve
```

Or manually:

```bash
python3 -m http.server 8000
```

---

## Architecture

```
portent-site/
├── index.html          # the app shell
├── embed.html          # the same ball as an iframe component
├── embed-builder.html  # builds an embed snippet and exercises the message contract
├── css/
│   └── style.css       # all styles (kit CSS is vendored alongside)
├── js/
│   ├── app.js          # entry point
│   ├── events.js       # wiring: the reveal chain, the deck sheet, the importers
│   ├── ball3d.js       # scene, physics, and the shake to reveal phase machine
│   ├── ballart.js      # every mesh, material and canvas texture inside the shell
│   ├── flatball.js     # the no-WebGL twin, same hooks
│   ├── shake.js        # pointer, keyboard, device motion, gamepad, microphone
│   ├── deck.js         # drawing an answer, parsing and importing decks
│   ├── state.js        # shared state, localStorage, share payload encoding
│   ├── render.js       # DOM rendering
│   ├── sound.js        # WebAudio slosh, knock and chime
│   ├── embed.js        # what runs inside the iframe
│   └── utils.js        # shared helpers
├── tests/              # node --test, run with `make test`
├── vendor/three/       # three.js, vendored: no build step
├── CNAME
├── Makefile
└── README.md
```

The embed's URL and `postMessage` contract is documented at the top of
`js/embed.js`, and `embed-builder.html` is a working demonstration of it.

```

---

<div align="center">
<sub>Part of <a href="https://neorgon.com/">Neorgon</a></sub>
</div>
