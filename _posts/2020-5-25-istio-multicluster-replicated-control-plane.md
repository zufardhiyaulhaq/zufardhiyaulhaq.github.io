---
layout: post
title: Install Istio Multicluster Replicated Control Plane
---

Istio is a service mesh platform that can control and modify traffic policy behaviour in Kubernetes by injecting sidecar to a container. Multicluster Replicated Control Plane is an uses cases to enable communication between two service in two difference service meshes without using Ingress and can enable mutual TLS between the service.

Multicluster Replicated Control Plane allow your service to communicate each other with `*.global` FQDN between service mesh network. This tutorial is written because the original installation documentation is sucks lol (theory behind it is good).

### Requirement
- virtualbox
- minikube
- kubectl
- istioctl 1.4.9 or 1.5.4
- [step and step-ca](https://smallstep.com/docs/getting-started/#1-installing-step-and-step-ca)

### Bootstraping two Kubernetes clusters

Use minikube to start two kubernetes cluster named `cluster1` and `cluster2`.
{% highlight shell %}
minikube start --driver=virtualbox --force=true --kubernetes-version='1.15.11' --memory 16128 --cpus 8 --profile cluster1
minikube start --driver=virtualbox --force=true --kubernetes-version='1.15.11' --memory 16128 --cpus 8 --profile cluster2
{% endhighlight %}
*Notes: please adjust with your environment*

### Generate Certificate with step and step-ca
{% highlight shell %}
step certificate create zufar-root-ca root-cert.pem root-key.pem --profile root-ca  --kty RSA --no-password --insecure --not-after 87600h --san zufardhiyaulhaq.com
step certificate create zufar-intermediate-ca ca-cert.pem ca-key.pem --profile intermediate-ca --kty RSA --ca ./root-cert.pem --ca-key ./root-key.pem --no-password --insecure --not-after 43800h --san zufardhiyaulhaq.com
step certificate bundle ca-cert.pem root-cert.pem cert-chain.pem
{% endhighlight %}

This will create root certificate, intermediate certificate, and certificate chain.

### Add Kiali environment
{% highlight shell %}
KIALI_USERNAME=$(read -p 'Kiali Username: ' uval && echo -n $uval | base64)
KIALI_PASSPHRASE=$(read -sp 'Kiali Passphrase: ' pval && echo -n $pval | base64)
NAMESPACE=istio-system
{% endhighlight %}

## Install Istio

Istioctl 1.4.9 use CRD named `IstioControlPlane` to create the cluster. We will use this CRD:
{% highlight yml %}
apiVersion: install.istio.io/v1alpha2
kind: IstioControlPlane
spec:
  coreDNS:
    enabled: true
  values:
    istiocoredns:
      enabled: true
    kiali:
      enabled: true
    global:
      podDNSSearchNamespaces:
      - global
      - {% raw  %}"{{ valueOrDefault .DeploymentMeta.Namespace \"default\" }}.global"{% endraw %}
      multiCluster:
        enabled: true
      controlPlaneSecurityEnabled: true
    security:
      selfSigned: false
    gateways:
      istio-ingressgateway:
        enabled: true
        type: NodePort
{% endhighlight %}

For Istio 1.5.4, use `IstioOperator`
{% highlight yml %}
apiVersion: install.istio.io/v1alpha1
kind: IstioOperator
spec:
  components:
    pilot:
      enabled: true
      k8s:
        replicaCount: 1
        hpaSpec:
          maxReplicas: 3
          minReplicas: 1
  addonComponents:
    ingressGateways:
      enabled: true
      k8s:
        replicaCount: 1
        hpaSpec:
          maxReplicas: 3
          minReplicas: 1
    prometheus:
      enabled: true
      k8s:
        replicaCount: 1
    kiali:
      enabled: true
      k8s:
        replicaCount: 1
    istiocoredns:
      enabled: true
      k8s:
        replicaCount: 1
  values:
    global:
      podDNSSearchNamespaces:
        - global
        - "{{ valueOrDefault .DeploymentMeta.Namespace \"default\" }}.global"
      multiCluster:
        enabled: true
      controlPlaneSecurityEnabled: true
    security:
      selfSigned: false
    gateways:
      istio-ingressgateway:
        type: NodePort
        name: istio-ingressgateway
{% endhighlight %}

`IstioControlPlane` change to `IstioOperator` in 1.5 release. This CRD install kiali and change ingressgateway into NodePort. please adjust with your environment. Save this file as `istio.yaml`.

### Install Istio in Cluster1

- Add cacerts certificate
{% highlight shell %}
kubectl --context cluster1 create namespace istio-system
kubectl --context cluster1 create secret generic cacerts -n istio-system \
    --from-file=ca-cert.pem \
    --from-file=ca-key.pem \
    --from-file=root-cert.pem \
    --from-file=cert-chain.pem
{% endhighlight %}
- Add kiali secret
{% highlight shell %}
kubectl --context cluster1 apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: kiali
  namespace: $NAMESPACE
  labels:
    app: kiali
type: Opaque
data:
  username: $KIALI_USERNAME
  passphrase: $KIALI_PASSPHRASE
EOF
{% endhighlight %}
- Install Istio
{% highlight shell %}
istioctl --context cluster1 manifest apply -f istio.yaml
{% endhighlight %}
- Patch the coredns

This patch introduce a config to proxy `*.global` FQDN request from main `coredns` to `istiocoredns`.
{% highlight shell %}
kubectl --context cluster1 apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns
  namespace: kube-system
data:
  Corefile: |
    .:53 {
        errors
        health
        kubernetes cluster.local in-addr.arpa ip6.arpa {
           pods insecure
           upstream
           fallthrough in-addr.arpa ip6.arpa
        }
        prometheus :9153
        proxy . /etc/resolv.conf
        cache 30
        loop
        reload
        loadbalance
    }
    global:53 {
        errors
        cache 30
        proxy . $(kubectl --context cluster1 get svc -n istio-system istiocoredns -o jsonpath={.spec.clusterIP})
    }
EOF
{% endhighlight %}

Do the same thing with other kubernetes cluster.

### Install Istio in cluster2

- Add cacerts certificate
{% highlight shell %}
kubectl --context cluster2 create namespace istio-system
kubectl --context cluster2 create secret generic cacerts -n istio-system \
    --from-file=ca-cert.pem \
    --from-file=ca-key.pem \
    --from-file=root-cert.pem \
    --from-file=cert-chain.pem
{% endhighlight %}
- Add kiali secret
{% highlight shell %}
kubectl --context cluster2 apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: kiali
  namespace: $NAMESPACE
  labels:
    app: kiali
type: Opaque
data:
  username: $KIALI_USERNAME
  passphrase: $KIALI_PASSPHRASE
EOF
{% endhighlight %}
- Install Istio
{% highlight shell %}
istioctl --context cluster2 manifest apply -f istio.yaml
{% endhighlight %}
- Patch the coredns

This patch introduce a config to proxy `*.global` FQDN request from main `coredns` to `istiocoredns`.
{% highlight shell %}
kubectl --context cluster2 apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: coredns
  namespace: kube-system
data:
  Corefile: |
    .:53 {
        errors
        health
        kubernetes cluster.local in-addr.arpa ip6.arpa {
           pods insecure
           upstream
           fallthrough in-addr.arpa ip6.arpa
        }
        prometheus :9153
        proxy . /etc/resolv.conf
        cache 30
        loop
        reload
        loadbalance
    }
    global:53 {
        errors
        cache 30
        proxy . $(kubectl --context cluster2 get svc -n istio-system istiocoredns -o jsonpath={.spec.clusterIP})
    }
EOF
{% endhighlight %}

We have two Kubernetes cluster with istio enabled. This istio shared same root CA.

## Mutual TLS Testing

### Install httpbin service in Cluster2

- Create namespace `istio-testing` and enable injection.
{% highlight shell %}
kubectl --context cluster2 create namespace istio-testing
kubectl --context cluster2 label namespace istio-testing istio-injection=enabled
{% endhighlight %}

- Apply httpbin deployment and service
{% highlight shell %}
kubectl --context cluster2 apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: httpbin
  namespace: istio-testing
  labels:
    app: httpbin
spec:
  ports:
  - name: http
    port: 80
  selector:
    app: httpbin
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: httpbin
  namespace: istio-testing
spec:
  replicas: 1
  selector:
    matchLabels:
      app: httpbin
      version: v1
  template:
    metadata:
      labels:
        app: httpbin
        version: v1
    spec:
      containers:
      - image: docker.io/kennethreitz/httpbin
        imagePullPolicy: IfNotPresent
        name: httpbin
        ports:
        - containerPort: 80
EOF
{% endhighlight %}

Cluster1 will communicate to this service via `httpbin.istio-testing.global` FQDN. But how? please read the official documentation. I am to lazy to explain in here, just contact me if you still confuse about the concept.

### Install sleep deployment and Istio ServiceEntry in Cluster1

ServiceEntry is a special object in Istio, this basically configure in `istiocoredns` to resolve `httpbin.istio-testing.global` into an unused ip `240.0.0.2` and force sidecar to forward the traffic into spesific endpoint (ingressgateway cluster2 with a special port 15443) and force mutual TLS.

{% highlight shell %}
kubectl --context cluster1 create namespace istio-testing
kubectl --context cluster1 label namespace istio-testing istio-injection=enabled
{% endhighlight %}

- Apply httpbin deployment and service
{% highlight shell %}
kubectl --context cluster1 apply -f - <<EOF
---
apiVersion: networking.istio.io/v1alpha3
kind: ServiceEntry
metadata:
  name: httpbin-cluster2-se
spec:
  hosts:
  - httpbin.istio-testing.global
  location: MESH_INTERNAL
  ports:
  - name: http
    number: 80
    protocol: http
  resolution: DNS
  addresses:
  - 240.0.0.2
  endpoints:
  - address: $(minikube --profile cluster2 ip)
    ports:
      http: $(kubectl --context cluster2 get svc -n istio-system istio-ingressgateway -o=jsonpath='{.spec.ports[?(@.port==15443)].nodePort}')
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sleep
  namespace: istio-testing
spec:
  replicas: 1
  selector:
    matchLabels:
      app: sleep
  template:
    metadata:
      labels:
        app: sleep
    spec:
      containers:
      - name: sleep
        image: governmentpaas/curl-ssl
        command: ["/bin/sleep", "3650d"]
        imagePullPolicy: IfNotPresent
EOF
{% endhighlight %}

## Testing
- Exec from sleep pod in Cluster1
{% highlight shell %}
kubectl --context cluster1 -n istio-testing exec -it $(kubectl --context cluster1 -n istio-testing get pod | grep -m 1 sleep | awk '{print $1}') -c sleep sh
{% endhighlight %}
- Test nslookup
{% highlight shell %}
nslookup httpbin.istio-testing.global
{% endhighlight %}
- Test curl
{% highlight shell %}
curl http://httpbin.istio-testing.global/headers
{% endhighlight %}

Thanks
