---
layout: post
title: Advanced Istio features you can safely enable during upgrade
tags: [istio, security, networking, observability]
---

Istio upgrade is usually treated as a version bump and nothing else: move the control plane, restart the gateways and sidecars, and it's done. But a major release quietly ships features you can turn on in the same change window, most of them additive and low-risk. Here are six worth feature that you can enable during upgrade:

## 1. Post-quantum key exchange on your gateways

Latest Istio version offer a hybrid post-quantum key exchange, `X25519MLKEM768` (classical X25519 combined with ML-KEM-768), for TLS. A client that supports it negotiates a quantum-resistant handshake. a client that does not falls back to plain X25519. It is additive: nothing breaks, you just gain the option.

```yaml
meshConfig:
  tlsDefaults:
    ecdhCurves:
    - X25519MLKEM768   # hybrid PQC, preferred
    - X25519           # classical fallback
    - P-256
```

`tlsDefaults.ecdhCurves` applies to your ingress and egress gateways, and TLS to external services. It does **not** touch mesh-internal mTLS between sidecars, which uses Istio's own mTLS stack. 

So this hardens your edge against "harvest now, decrypt later", not pod-to-pod traffic. List the hybrid curve first so it is preferred, and keep X25519 so older clients still connect.

## 2. Move your image hub off gcr.io

Istio is retiring `gcr.io/istio-release` and `registry.istio.io/release`, with the old location working until late 2026 and a hard cutoff on January 1, 2027. An upgrade is the natural moment to repoint your hub, and a good moment to mirror it into your own registry so a public-registry outage or rate limit can never block a rollout.

```yaml
# IstioOperator
spec:
  hub: ghcr.io/zufardhiyaulhaq/istio-mirror
  # or pull through your own mirror:
  # hub: <your-registry>/istio
```

With Helm, the same setting is `global.hub=ghcr.io/zufardhiyaulhaq/istio-mirror`. If you mirror, make sure it has the exact tags for the version you are installing (`proxyv2`, `pilot`, and so on) before you cut over. Otherwise this is as safe as it gets: it only changes where images are pulled from.

## 3. Emit both B3 and W3C trace headers

Latest Istio exposes `traceContextOption` on the Zipkin tracing provider. `USE_B3_WITH_W3C_PROPAGATION` reads trace context from B3, falls back to the W3C `traceparent` header when B3 is missing, and emits both upstream.

```yaml
meshConfig:
  extensionProviders:
  - name: zipkin
    zipkin:
      service: zipkin.istio-system.svc.cluster.local
      port: 9411
      traceContextOption: USE_B3_WITH_W3C_PROPAGATION
```

This is a migration bridge. Your existing B3 apps (Zipkin, Jaeger) keep working, and any OpenTelemetry-instrumented service, which reads `traceparent` and not `x-b3-*`, stops orphaning its spans at the mesh hop. 

The cost is one extra header upstream, a fixed `traceparent` line of about 55 bytes, and it does not accumulate across hops because each proxy overwrites its own span. But it is only worth turning on if something in your mesh actually reads W3C. On an all-B3 stack it just carries a header nobody consumes, so enable it when you have, or are adding, OTel services, not reflexively.

## 4. Raise the header size and count limits

Envoy caps request headers by size (default 60 KiB) and by count (default 100). Cross either limit and the request is rejected with `431 Request Header Fields Too Large` before it ever reaches your application.you can raise both gateway and sidecar with an EnvoyFilter pinned to the proxy version.

```yaml
apiVersion: networking.istio.io/v1alpha3
kind: EnvoyFilter
metadata:
  name: header-size-and-count-1.28-ef
  namespace: istio-system
spec:
  configPatches:
  - applyTo: NETWORK_FILTER
    match:
      context: ANY
      listener:
        filterChain:
          filter:
            name: envoy.filters.network.http_connection_manager
      proxy:
        proxyVersion: ^1\.28.*
    patch:
      operation: MERGE
      value:
        typed_config:
          "@type": type.googleapis.com/envoy.extensions.filters.network.http_connection_manager.v3.HttpConnectionManager
          max_request_headers_kb: 128
          common_http_protocol_options:
            max_headers_count: 200
```

`proxyVersion: ^1\.28.*` binds this filter only to 1.28 proxies, so keep the equivalent EnvoyFilter for your previous version in place during the sidecar rollout.

Sidecars restart over days or weeks, and both proxy versions need to be covered the whole time. Size and count are independent limits: raise both. I wrote up why both axes matter, and the CVEs behind them, in a [separate note on HTTP header limits](https://notes.zufardhiyaulhaq.com/guides/engineering-notes/http-header-limits/).

## 5. HTTP/3 (QUIC) on the ingress gateway

Latest Istio can serve HTTP/3 over QUIC at the gateway. Clients still connect first over HTTPS on TCP, receive an `Alt-Svc` header advertising HTTP/3, and then switch to QUIC over UDP.

There are three pieces. Enable the listener through the pilot env:

```yaml
spec:
  values:
    pilot:
      env:
        PILOT_ENABLE_QUIC_LISTENERS: "true"
```

Add a UDP port to the ingress-gateway Service, alongside the existing TCP one:

```yaml
ports:
- name: https
  port: 443
  targetPort: 8443
  protocol: TCP
- name: http3
  port: 443
  targetPort: 8443
  protocol: UDP
```

The `Gateway` resource itself stays `HTTPS` on 443 with your normal TLS; QUIC negotiation happens at the Envoy layer.

This is the one feature here that is **experimental, not in the same safe tier as the rest**. Your load balancer must forward UDP/443, which many L4 load balancers do not do by default, and QUIC requires TLS 1.3. Verify with `curl --http3 -v https://<host>/` and the Envoy `http3.downstream` stats before trusting it. Try it in staging, and leave it off in production until you have confirmed the load-balancer path and measured a real benefit.

## 6. Tune the sidecar DNS refresh rate

Any host resolved by DNS (a `ServiceEntry`, an external endpoint) becomes a `STRICT_DNS` cluster, and every sidecar re-resolves it on a fixed interval: `dnsRefreshRate`. The default is aggressive (Istio [issue 27329](https://github.com/istio/istio/issues/27329) flags it defaulting to 5 seconds as too short), and at scale that is thousands of pods each firing DNS queries every few seconds.

It is a single knob with a clear tradeoff: raise it to relieve DNS load, lower it for faster reaction to endpoint changes.

```yaml
meshConfig:
  defaultConfig:
    dnsRefreshRate: 240s
```

At `240s` the DNS traffic drops sharply, at the cost of taking up to four minutes to notice an external endpoint moving IPs. Because it is a `ProxyConfig` field, you can relax the mesh-wide default and still override a handful of DNS-sensitive workloads back to a lower value with a per-workload `ProxyConfig`.

## Sources

- Istio: [retirement of gcr.io](https://istio.io/latest/blog/2026/retirement-of-gcr.io/) and the [Global Mesh Options reference](https://istio.io/latest/docs/reference/config/istio.mesh.v1alpha1/) (covers `tlsDefaults.ecdhCurves`, the Zipkin `traceContextOption`, and `defaultConfig.dnsRefreshRate`).
- Red Hat OpenShift Service Mesh: [post-quantum cryptography](https://docs.redhat.com/en/documentation/red_hat_openshift_service_mesh/3.3/html/installing/ossm-pqc-install) (the `X25519MLKEM768` hybrid curve).
- Istio: [DNS proxying](https://istio.io/latest/docs/ops/configuration/traffic-management/dns-proxy/).
- [How to configure Istio for HTTP/3 (QUIC)](https://oneuptime.com/blog/post/2026-02-24-how-to-configure-istio-for-http3-quic-support/view).
