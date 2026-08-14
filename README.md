# web-render-lab

A growing collection of standalone web rendering techniques — each one a self-contained demo with no framework and no build step, meant to be read as a reference or dropped straight into another project.

## Techniques

| Technique | Folder | Demo | What it is |
|---|---|---|---|
| Particle portrait | [`particle-portrait/`](particle-portrait/) | [`demo.html`](particle-portrait/demo.html) | An image dissolves into an interactive Canvas2D particle field — hover to disturb it, release to let it spring back. |

## How this repo is organized

Every technique gets its own top-level folder, and each folder is self-contained:

```
<technique>/
├── README.md       what it is, how it works, API/options
├── demo.html        a runnable page — just open it or serve the folder
├── <technique>.js   the engine, plain JS, no build step
└── assets/          whatever images/data the demo needs
```

No shared build tooling, no bundler, no framework — just `<script>`/`<link>` tags with relative paths, so any folder here still works if you copy it out on its own.

## Previewing

Open any `demo.html` directly (`file://` works fine, nothing here needs a build step), or serve the repo and browse via GitHub Pages if it's enabled.

## Adding a new technique

Copy the folder shape above, add a row to the table in this README, and keep the same conventions: no dependencies, no build step, one folder = one fully working thing.

## License

MIT — see [LICENSE](LICENSE).
