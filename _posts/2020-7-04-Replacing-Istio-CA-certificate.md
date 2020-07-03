---
layout: post
title: Replacing Istio CA Certificate
---

Istio CA certificate is the most sensitive object in Istio. When enable multicluster shared control plane, the CA certificate got shared on multiple cluster. Once this certificate leak out to public, there is no way but replacing the old CA certificate with the new one.

Istio CA certificate consists of four components:
- Root Certificate
- Intermediate Certificate
- Intermediate Private Key
- CA bundle

This article will help you to replace all of the certificate with the new generated one. But please make it save!

### Environment
- Kubernetes with Istio installed
- step & step-ca to generate certificate

### Certificate Generation
Before replacing, we need to generate new root CA. we will using step certificate for that.

{% highlight shell %}
step certificate create istio-root-ca root-cert.pem root-key.pem --profile root-ca  --kty RSA --no-password --insecure --not-after 87600h

step certificate create istio-intermediate-ca ca-cert.pem ca-key.pem --profile intermediate-ca --kty RSA --ca ./root-cert.pem --ca-key ./root-key.pem --no-password --insecure --not-after 43800h 

step certificate bundle ca-cert.pem root-cert.pem cert-chain.pem
{% endhighlight %}

### Configuration

Istio have two secret object for CA certificate:
- `istio-ca-secret` secret in `istio-system namespace. This is the default secret that Istio used.
- `cacerts` secret in `istio-system` namespace. This will be used rather than `istio-ca-secret` when enabling Istio multicluster feature.

This article will try using `cacerts`.

- Backup and delete the old cacerts secret
{% highlight shell %}
kubectl get secret -n istio-system cacerts -oyaml > old-cacerts.yaml
kubectl delete secret -n istio-system cacerts
{% endhighlight %}

When you start deleting, it is expected that Istio mesh will broken.

- Apply the new cacerts
{% highlight shell %}
kubectl create secret generic cacerts -n istio-system \
    --from-file=ca-cert.pem \
    --from-file=ca-key.pem \
    --from-file=root-cert.pem \
    --from-file=cert-chain.pem
{% endhighlight %}

- Rollout istio-system namespace to apply cacerts
{% highlight shell %}
kubectl rollout restart deployment --namespace istio-system
{% endhighlight %}

- Check istio-ca-root-cert configmap in all namespace, make sure it contains new Root certificate configuration
{% highlight shell %}
kubectl get cm istio-ca-root-cert -o jsonpath='{.data.root-cert\.pem}' -n <NAMESPACE> | openssl x509 -text -noout
{% endhighlight %}

**Note**: `istio-ca-root-cert` is a secret created automatically by Istiod service in all Kubernetes namespace. This contain Root certificate that sidecar used (mounted to each sidecar).

- Rollout all Istio enabled namespace
{% highlight shell %}
kubectl rollout restart deployment --namespace <NAMESPACE>
{% endhighlight %}

- Check `proxy-status`
{% highlight shell %}
istioctl proxy-status
{% endhighlight %}

Make sure all the service & component is listed & all configuration are sync. If the sidecar is not showing in the proxy-status, try to rollout again!

At this state, all component in Istio mesh is already get new certificate & configuration sync.
