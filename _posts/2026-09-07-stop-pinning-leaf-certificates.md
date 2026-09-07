---
layout: post
title: Stop pinning leaf certificates
tags: [security, networking]
---

Certificate pinning used to be a safe: hard-code the certificate you trust, reject everything else. That assumption is about to break for a lot of integrations, because the certificates themselves are about to get very short-lived.

## The industry is moving to short-lived certificates

On April 11, 2025, the CA/Browser Forum unanimously approved ballot SC-081v3. All four major browser vendors (Apple, Google, Mozilla, Microsoft) and 25 certificate authorities voted in favor; none voted against. It phases down the maximum lifetime of a public TLS certificate:

| From | Max certificate lifetime |
|------|--------------------------|
| Today | 398 days |
| March 2026 | 200 days |
| March 2027 | 100 days |
| March 2029 | 47 days |

This is not a proposal or a voluntary guideline. It is an approved, binding requirement that every publicly-trusted CA has to enforce. By 2029 a certificate you pin will be replaced roughly every six weeks, whether you like it or not.

## Three ways to pin, and how they hold up

Pinning means telling a client which part of the TLS chain to trust ahead of time. There are three common levels.

**Leaf (certificate) pinning.** You pin the exact server certificate. Any renewal, reissuance, or revocation instantly breaks the client. Under 47-day certificates, that is a guaranteed outage every few weeks.

**SPKI pinning.** You pin the SHA-256 hash of the certificate's public key (the Subject Public Key Info), not the whole certificate. As long as the key is reused on renewal, the pin survives certificate rotation, and it can survive a CA change too.

**Root CA pinning.** You pin the root certificate authority at the top of the chain. Roots live for years, so this is the most operationally stable option. The trade-off is a broader trust anchor.

| Approach | Survives renewal | Survives CA change | Operational cost |
|----------|------------------|--------------------|------------------|
| Leaf | No | No | Very high |
| SPKI | Yes, if the key is reused | Yes | Low |
| Root CA | Yes | No (same root) | Lowest |

## What to do

Leaf certificate pinning has to go. It was already fragile, and short-lived certificates make it unusable. The industry consensus (Google, Apple, Microsoft, Mozilla, Cloudflare, DigiCert, Sectigo, OWASP, and the CA/Browser Forum) is clear on this.

If you need pinning, pin the public key (SPKI) or the root CA, and always ship at least one backup pin so a planned key rotation does not lock clients out and never pin the leaf.

**Further reading:** Cloudflare, [Why certificate pinning is outdated](https://blog.cloudflare.com/why-certificate-pinning-is-outdated/); DigiCert, [TLS certificate lifetimes will reduce to 47 days](https://www.digicert.com/blog/tls-certificate-lifetimes-will-officially-reduce-to-47-days); and the CA/Browser Forum ballot SC-081v3.
