---
layout: post
title: Leverage Single Sign-On with oauth2-proxy and Istio
---

Not every application we found has a single sign-on build-in feature, this is a little tricky if you want to make it public but only want to provide access to the authenticated user. Luckily, there is an open-source project call oauth2-proxy that acts as a middleware as an authenticating system.

<iframe width="750" height="315" src="https://www.youtube.com/embed/kfYjuouU5JU" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

From my understanding, only using oauth2-proxy is not enough, because every application should have an oauth2-proxy service in front of them. With Istio, we can use a single oauth2-proxy for every endpoint/service/domain that we want to expose to the public.

## Setup oauth2-proxy
You can run oauth2-proxy as a service in Kubernetes or VM, we can use helm charts for that. You can refer to this [official site](https://artifacthub.io/packages/helm/k8s-at-home/oauth2-proxy).

I am using Keycloak as a identity provider, the helm charts values look like this

{% highlight shell %}
config:
  clientID: <CLIENT-ID>
  clientSecret: <CLIENT-SECRET>
  cookieSecret: <COOKIE-SECRET>
  configFile: |-
    provider="oidc"
    provider_display_name="<DISPLAY-NAME>"
    oidc_issuer_url="<OIDC-ISSUER-URL>"

    client_secret="<CLIENT-SECRET>"
    client_id="<CLIENT-ID>"

    cookie_secret="<COOKIE-SECRET>"

    standard_logging = true
    auth_logging = true
    request_logging = true
    silence_ping_logging = true

    pass_access_token = true
    pass_authorization_header = true
    set_authorization_header = true
    skip_jwt_bearer_tokens = true
    skip_provider_button = true
    skip_auth_strip_headers = false

    session_store_type = "cookie"
    cookie_httponly = true
    cookie_refresh = "1h"
    cookie_secure = false

    upstreams = [ "static://" ]
    email_domains = "*"
{% endhighlight %}

For logging, it's up to you to set the value to true or false, after you deploy the oauth2-proxy service, you need to expose your application via Istio ingress gateway

## Exposing Service
I will use Kubernetes dashboard as a example service, an example how to expose a service via ingressgateway

{% highlight shell %}
---
apiVersion: networking.istio.io/v1beta1
kind: Gateway
metadata:
  name: dashboard-zufardhiyaulhaq-com-gateway
  namespace: istio-system
spec:
  selector:
    istio: ingressgateway
  servers:
  - hosts:
    - "dashboard.zufardhiyaulhaq.com"
    port:
      name: http
      number: 80
      protocol: HTTP
    tls:
      httpsRedirect: true
  - hosts:
    - "dashboard.zufardhiyaulhaq.com"
    port:
      name: https-default
      number: 443
      protocol: HTTPS
    tls:
      credentialName: dashboard-zufardhiyaulhaq-com-cert
      mode: SIMPLE
---
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: dashboard-zufardhiyaulhaq-com-vs
  namespace: istio-system
spec:
  hosts:
  - "dashboard.zufardhiyaulhaq.com"
  gateways:
  - istio-system/dashboard-zufardhiyaulhaq-com-gateway
  http:
  - name: "kubernetes-dashboard-infrastructure-route"
    match:
    - uri:
        prefix: /
    route:
      - destination:
          port:
            number: 80
          host: kubernetes-dashboard.infrastructure.svc.cluster.local
        headers:
          response:
            set:
              Strict-Transport-Security: max-age=31536000; includeSubDomains
{% endhighlight %}

after exposing the service, we need to setup an EnvoyFilter to start redirection for unauthentication users. This EnvoyFilter will works on Istio ingressgateway.

{% highlight shell %}
apiVersion: networking.istio.io/v1alpha3
kind: EnvoyFilter
metadata:
  name: oauth-dashboard-zufardhiyaulhaq-com-1.6-ef
  namespace: istio-system
spec:
  workloadSelector:
    labels:
      istio: ingressgateway
  configPatches:
  - applyTo: HTTP_FILTER
    match:
      context: GATEWAY
      listener:
        filterChain:
          filter:
            name: envoy.http_connection_manager
            subFilter:
              name: istio.metadata_exchange
          sni: dashboard.zufardhiyaulhaq.com
      proxy:
        proxyVersion: ^1\.6.*
    patch:
      operation: INSERT_AFTER
      value:
        name: envoy.filters.http.ext_authz
        typed_config:
          '@type': type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthz
          http_service:
            authorizationRequest:
              allowedHeaders:
                patterns:
                - exact: accept
                - exact: authorization
                - exact: cookie
                - exact: from
                - exact: proxy-authorization
                - exact: user-agent
                - exact: x-forwarded-access-token
                - exact: x-forwarded-email
                - exact: x-forwarded-for
                - exact: x-forwarded-host
                - exact: x-forwarded-proto
                - exact: x-forwarded-user
                - prefix: x-auth-request
                - prefix: x-forwarded
            authorizationResponse:
              allowedClientHeaders:
                patterns:
                - exact: authorization
                - exact: location
                - exact: proxy-authenticate
                - exact: set-cookie
                - exact: www-authenticate
                - prefix: x-auth-request
                - prefix: x-forwarded
              allowedUpstreamHeaders:
                patterns:
                - exact: authorization
                - exact: location
                - exact: proxy-authenticate
                - exact: set-cookie
                - exact: www-authenticate
                - prefix: x-auth-request
                - prefix: x-forwarded
            server_uri:
              cluster: outbound|80||oauth2-proxy.infrastructure.svc.cluster.local
              timeout: 1.5s
              uri: http://oauth2-proxy.infrastructure.svc.cluster.local
{% endhighlight %}

the most important part is the SNI matching only your service and `server_uri` which is your oauth2-proxy service. After applying this, when you access the service, it will force you to login before sending to the upstream service which is Kubernetes dashboard.

The concept behind External Authorization is istio:

1. first-time requests, packet go to Istio ingressgateway, got forwarded to oauth2-proxy service via external authz envoyfilter
2. oauth2-proxy check that authentication is missing, force client to log in and redirected to the authentication provider
3. client login, login success, the OAuth tokens are stored in the configured session store (cookie or Redis in oauth2-proxy) and a cookie is set in the client
4. client get callback URL
5. client do requests again, go to istio ingressgateway, forwarded to oauth2-proxy
6. oauth2-proxy verify the credentials, return 200 OK to Istio, Istio forward to upstream
