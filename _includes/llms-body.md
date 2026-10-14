{%- comment -%}
Shared body for /llms.txt, /llms.md and /index.md, so the three never drift.
{%- endcomment -%}
{%- assign base = "https://zufardhiyaulhaq.com" -%}
# Zufar Dhiyaulhaq

> Personal site of Zufar Dhiyaulhaq. Writing and open-source projects on Kubernetes, service mesh, networking, and cloud infrastructure.

- [Home]({{ base }}/)
- [About]({{ base }}/about/)
- [Contact]({{ base }}/contact/)
- [Notes: TIL and engineering guides](https://notes.zufardhiyaulhaq.com/) (map for LLMs: https://notes.zufardhiyaulhaq.com/llms.txt)

## For AI agents

{% include agent-guide.md %}
## Writing

Each post has a plain-markdown copy: the post URL without the trailing slash, plus `.md`.
{% for post in site.posts %}
- [{{ post.title | strip_newlines }}]({{ base }}{{ post.url }}) ({{ post.date | date: "%Y-%m-%d" }}) · [md]({{ base }}/{{ post.url | replace: '/','' }}.md)
{%- endfor %}

## Work

### Products
{% for p in site.data.projects.products %}
- [{{ p.name }}]({{ p.url }}): {{ p.description | strip_newlines }}
{%- endfor %}

### Open source
{% for p in site.data.projects.opensource %}
- [{{ p.name }}]({{ p.url }}) ({{ p.lang }}, {{ p.stars }} stars): {{ p.description | strip_newlines }}
{%- endfor %}
