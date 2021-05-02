---
layout: post
title: Configure Istio Gateway as Haproxy backend
---

I have been working and using Istio for the past 1 year. Istio provide tons of feature, and I heavily using Istio Ingress gateway to expose my services to publics. There is an use cases when some other proxy like HAProxy is pointing to Istio gateway. The configuration on HAProxy might changes because Istio Gateway implement Server Name Indicator (SNI). Server Name Indicator will provide proxy to be apply to serve multiple domain on single proxy.

![sni]({{ site.baseurl }}/images/sni-extension.png)

In the TLS handshake, the client will send the hello packet that contain Server Name Indicator, this mostly a domain name. The proxy will receive and check if there is certificate that match the Server Name Indicator, and send back the correct certificate to the client.

The most basic HAProxy configuration that is works with Istio gateway should looks like:

{% highlight shell %}
global
defaults
        mode http

frontend stats
        bind *:8404
        stats enable
        stats uri /stats
        stats refresh 10s

frontend istio-gateway
        bind *:80
        use_backend istio-gateway

backend istio-gateway
        http-request set-header Host helloworld.zufardhiyaulhaq.tech
        server helloworld helloworld.zufardhiyaulhaq.tech:443 ssl sni str(helloworld.zufardhiyaulhaq.tech) verify none
{% highlight shell %}

- `http-request set-header Host domain` is to make sure every request forwarded from HAProxy to Istio gateway have `Host` header. This is very important if you applied allowlisting based on domain in the Istio side.
- `ssl sni str(domain)` is to make sure that TLS handshake between haproxy to Istio gateway is using SNI.

If you plan to have HTTP health check mechanism, the configuration should looks like:

{% highlight shell %}
backend istio-gateway
        option httplog
        option httpchk GET / HTTP/1.1\r\nHost:\ helloworld.zufardhiyaulhaq.tech

        http-request set-header Host helloworld.zufardhiyaulhaq.tech
        server helloworld helloworld.zufardhiyaulhaq.tech:443 check check-ssl check-sni helloworld.zufardhiyaulhaq.tech ssl sni str(helloworld.zufardhiyaulhaq.tech) verify none
{% highlight shell %}

- `option httpchk` will check with `GET` method on `/` with `Host` header.
- `check check-ssl check-sni domain` will enable the healthcheck.

![haproxy-stats]({{ site.baseurl }}/images/haproxy-l7.png)
