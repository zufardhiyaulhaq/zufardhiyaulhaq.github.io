---
layout: post
title: A GEO checklist for a static site
tags: [ai, tooling, networking]
---

Generative Engine Optimization (GEO) is SEO for answers instead of links: making your content easy for AI systems to find, read, and cite. The term comes from a 2023 paper that measured up to 40% more visibility in AI-generated answers from changes to the content alone.

**For Google, there is nothing extra to do.** Google's docs say its AI features need no new machine-readable files, AI text files, or markup. Normal SEO is the work. Everything below is for the other agents: assistants that fetch a page because a user asked, coding agents handed a URL, and the crawlers behind other AI search products.

I made this site agent-ready over a few days, on GitHub Pages with no server. This is the checklist I ended up with, what each piece is for, and the parts a static host cannot do.

## The checklist

| Layer | Piece | What it does | Static host |
|-|-|-|-|
| Access | `robots.txt` that allows AI crawlers | lets search and AI crawlers in | Yes |
| Access | `Content-Signal` line in `robots.txt` | states your search, AI-answer, and AI-training preference | Yes |
| Discovery | `sitemap.xml` with `lastmod` | lists every page and when it changed | Yes |
| Discovery | `/llms.txt` | a markdown map of the site for LLMs | Yes |
| Discovery | `/.well-known/agent-card.json`, `/.well-known/ard.json` | a machine-readable description of what the site offers | Yes |
| Discovery | DNS-AID `SVCB` record | points agents at the site from DNS | DNS, not the repo |
| Understanding | JSON-LD `Person`, `WebSite`, `BlogPosting` | says who wrote what, links your real profiles | Yes |
| Understanding | Clean HTML | one `h1`, no skipped heading levels, text readable without JavaScript | Yes |
| Reading | A markdown copy of every post | the text without the layout, about 3x smaller | Yes, with a script |
| Reading | `Accept: text/markdown` on the same URL | the same URL returns markdown to agents | No, needs an edge |
| Discovery | `Link:` response headers (RFC 8288) | advertises resources in HTTP headers | No, needs an edge |

Everything marked yes is live on this site, so you can `curl` it. The rest of this post is the detail the table does not show.

## Access: let them in, then say what they may do

```text
User-agent: *
Allow: /
Content-Signal: search=yes, ai-input=yes, ai-train=yes

Sitemap: https://example.com/sitemap.xml
```

`Content-Signal` comes from Cloudflare's Content Signals Policy. It has three signals: `search` (indexing and classic results), `ai-input` (using your content to build an answer right now, like retrieval), and `ai-train` (training or fine-tuning models). They are stated preferences, not enforcement. A crawler can ignore them.

`ai-train` is a real decision, not a default. I write in public to be read, so mine is `yes`. Set yours on purpose.

## Discovery: give them a map

**`llms.txt`** is a proposal from Jeremy Howard (September 2024), not a standard. Only the `# Title` line is required. The rest is a short summary and lists of links. Mine lists every post with a link to its markdown copy. Google says its AI features need no such file. I keep it because it is one file, and an agent handed my domain gets a map instead of a homepage full of layout.

Scanners also look for `/llms.md` and `/index.md`, so I serve the same body at all three paths from one shared include. One source, three URLs, nothing to keep in sync.

**`.well-known` files** are where it gets tempting to lie. `/.well-known/agent-card.json` is the A2A path, but a real A2A card describes an agent you can call: its skills, its endpoint, how to authenticate. A blog has none of that. Mine says `"kind": "content-resource"`, lists the files above, and states there is nothing to call. The ARD catalog at `/.well-known/ard.json` follows the same rule: four entries, all real files, each with its true media type.

**DNS-AID** is an IETF draft that puts agent discovery in DNS, as `SVCB` records under an `_agents` label:

```text
_index._agents.example.com. 3600 IN SVCB 1 example.com. ( alpn="h2,h3" port=443 )
```

The record carries no path. It only says the discovery entry is `example.com` over HTTPS. The agent then finds the files above by convention. Adoption is early, the record only carries trust with DNSSEC on, and on a content site it has nothing agent-shaped to point at. I added it because it is one record, but it is the lowest-value item here.

## Understanding: say who you are

JSON-LD is the one piece with years of support behind it. Search engines already read schema.org, and it is the cleanest way to tell any machine who the author is:

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Person",
      "@id": "https://example.com/#person",
      "name": "Your Name",
      "description": "One line about what you do.",
      "sameAs": ["https://github.com/you", "https://www.linkedin.com/in/you"]
    },
    {
      "@type": "BlogPosting",
      "headline": "Post title",
      "datePublished": "2026-10-16T00:00:00+07:00",
      "author": { "@id": "https://example.com/#person" }
    }
  ]
}
```

Put real profiles in `sameAs`, nothing invented. Generate the `BlogPosting` for each post from the template so it never goes stale.

Clean HTML matters because plenty of fetchers do not run JavaScript. One `h1`, no skipped levels, the text in the server response. A scanner caught my homepage jumping from `h1` to `h3`: the post titles on the cards were `h3`. It was a one-word fix.

## Reading: hand them markdown

Every post here has a raw markdown copy: take the post URL, drop the trailing slash, add `.md`. Across 21 posts the markdown is 33% of the HTML bytes. That is a third of the text for an agent to read.

GitHub Pages only runs whitelisted plugins, so a small script writes one file per post. The trick that makes Jekyll serve it raw: the source is a `.html` file (so Jekyll skips the markdown converter), with `permalink: /<slug>.md` and `layout: null`. GitHub Pages then serves it as `text/markdown`.

An agent only finds a copy you advertise, so each post's `<head>` gets:

```html
<link rel="alternate" type="text/markdown" href="/post-slug.md">
```

**Check every link, not a sample.** Jekyll keeps the filename's case in the URL, so 8 of my 21 posts live at mixed-case paths like `/Automatic-certificate-Private-PKI/`. My script lowercased the slugs, and every markdown link for those 8 posts returned 404. I had spot-checked the lowercase ones and called it done.

## What a static host cannot do

GitHub Pages serves files. It cannot set custom response headers, and it cannot return different content based on the request. That rules out three things:

- `Link:` response headers pointing at your resources (RFC 8288). A `<link>` tag in the HTML is not the same thing, and scanners check the header.
- `Accept: text/markdown` returning markdown from the same URL, with `Vary: Accept`.
- Serving markdown to known AI user agents.

All three need an edge in front, such as a Cloudflare Worker. With the markdown copies already built, the Worker only has to route on the `Accept` header. One surprise went the other way: GitHub Pages already sends `Access-Control-Allow-Origin: *` on every response, so a requirement that only needs CORS is already met.

## Sources

1. Aggarwal et al., [GEO: Generative Engine Optimization](https://arxiv.org/abs/2311.09735), KDD 2024.
2. Google Search Central, [AI features and your website](https://developers.google.com/search/docs/appearance/ai-features).
3. Jeremy Howard, [The /llms.txt file](https://llmstxt.org/).
4. Cloudflare, [Giving users choice with Cloudflare's new Content Signals Policy](https://blog.cloudflare.com/content-signals-policy/).
5. IETF, [DNS for AI Discovery](https://www.ietf.org/archive/id/draft-mozleywilliams-dnsop-dnsaid-01.html) (draft).
6. [ARD specification](https://github.com/ards-project/ard-spec/blob/main/spec/ard.md).
7. [A2A protocol specification](https://a2a-protocol.org/latest/specification/).
8. schema.org, [BlogPosting](https://schema.org/BlogPosting).
