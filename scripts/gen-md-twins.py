#!/usr/bin/env python3
"""Generate per-post raw-markdown twins for the site.

For every post in _posts/*.md this writes a source file under mdtwins/ that
Jekyll serves as RAW markdown at /<slug>.md (same slug as the post's HTML URL).

Why it works on GitHub Pages (no generator plugin allowed):
  - source lives in mdtwins/ (NOT an underscore dir, so Jekyll processes it)
  - the source is a .html file, so Jekyll does NOT run the markdown converter
  - front matter sets `permalink: /<slug>.md` + `layout: null`, so the output
    is the bare body written to _site/<slug>.md
  - the body is wrapped in {% raw %}...{% endraw %} so Helm/Go/Jekyll braces in
    old posts are emitted literally instead of being evaluated as Liquid

Re-run this whenever posts are added or edited, then commit mdtwins/.
    python3 scripts/gen-md-twins.py
"""
import glob
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POSTS = sorted(glob.glob(os.path.join(ROOT, "_posts", "*.md")))
OUT = os.path.join(ROOT, "mdtwins")
BASE = "https://zufardhiyaulhaq.com"

FM = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.S)
DATE = re.compile(r"^\d{4}-\d{1,2}-\d{1,2}-")


def field(front_matter, key):
    m = re.search(r"^%s:\s*(.*)$" % re.escape(key), front_matter, re.M)
    return m.group(1).strip().strip("\"'") if m else ""


os.makedirs(OUT, exist_ok=True)
for stale in glob.glob(os.path.join(OUT, "*.html")):
    os.remove(stale)

count = 0
skipped = []
for path in POSTS:
    raw = open(path, encoding="utf-8").read()
    m = FM.match(raw)
    front = m.group(1) if m else ""
    body = (raw[m.end():] if m else raw).strip()

    title = field(front, "title")
    tags = field(front, "tags")
    slug = DATE.sub("", os.path.basename(path)[:-3]).lower()
    canonical = "%s/%s/" % (BASE, slug)

    md = ["# %s" % title, "", "> Canonical: %s" % canonical]
    if tags:
        md.append("> Tags: %s" % tags)
    md += ["", body, ""]
    md = "\n".join(md)

    # If the post already uses {% raw %} blocks (old Jekyll posts that escaped
    # Helm/Go braces), leave them in place and do NOT add an outer wrapper
    # (nested raw does not nest). Otherwise wrap the whole body so any stray
    # braces are emitted literally.
    if "{% raw %}" in body or "{%raw%}" in body:
        inner = md
    else:
        inner = "{% raw %}" + md + "{% endraw %}"

    out = (
        "---\n"
        "permalink: /%s.md\n"
        "layout: null\n"
        "sitemap: false\n"
        "---\n"
        "%s\n"
    ) % (slug, inner)
    open(os.path.join(OUT, slug + ".html"), "w", encoding="utf-8").write(out)
    count += 1

print("generated %d markdown twins in %s" % (count, OUT))
if skipped:
    print("skipped (contain 'endraw'):", ", ".join(skipped))
