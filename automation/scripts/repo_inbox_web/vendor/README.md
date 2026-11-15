# Reading-guide browser dependencies

Vendored from official npm release tarballs; versions, URLs and SHA-512 integrity are in VERSIONS.json. Licenses are retained next to each package. All scripts, styles and fonts are served from the local Kian service; the reader has no CDN requirement.

- markdown-it: UMD browser build, raw HTML disabled.
- KaTeX: browser renderer, CSS and fonts; trust disabled.
- markdown-it-texmath: dollar/bracket math tokenization.

When updating, verify the tarball integrity, preserve licenses, check actual package filenames, and test guide rendering, formulas, figures and CSP in a browser. Source maps are not shipped.

The texmath text files have LF line endings and trailing whitespace normalized; their runtime logic is unchanged.
