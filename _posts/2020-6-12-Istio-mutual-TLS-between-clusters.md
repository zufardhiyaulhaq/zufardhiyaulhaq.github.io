---
layout: post
title: Mutual TLS communication between Istio mesh
---

Mutual TLS communication is about trusting each other between client and server. It is different from standard TLS that only client need to trust the server. In mutual TLS, server also need to trust client. 

In Istio mesh, this type of communication can be archive directly because all of the proxy share same root CA. Also mutual TLS communication between multiple Istio mesh also can be archive by sharing the root CA via [multicluster configuration](https://zufardhiyaulhaq.com/istio-multicluster-replicated-control-plane/). But what should we do when we cannot share the root CA to other? 

This article give you another prespective how to archive mutual TLS communication between Istio mesh using 3rd root CA that both of the mesh agree and trust, as shown in picture below:

![_config.yml]({{ site.baseurl }}/images/istio-mtls-3rd-ca.png)

### Environment
- two Kubernetes cluster with Istio mesh enabled
- a domain (that use to access the service) that resolve to istio-ingressgateway (that should be public, we can simulate using dnsmasq but I am to lazy to do that)
- step & step-ca to generate certificate

## Configuration

### Certificate
Before configuring the cluster, we need to generate 3rd root CA, client & server certificate that will be use to make mutual TLS, we will using step certificate for that.

{% highlight shell %}
step certificate create a-b-root-ca root-cert.pem root-key.pem --profile root-ca \
--kty RSA --no-password --insecure --not-after 87600h

step certificate create cluster-a-client cluster-a-client-cert.pem cluster-a-client-key.pem \
--profile leaf --no-password --insecure --ca ./root-cert.pem --ca-key ./root-key.pem --kty RSA \
--size 2048 --not-after 8760h --san helloworld.zufar.io

step certificate create cluster-b-server cluster-b-server-cert.pem cluster-b-server-key.pem \
--profile leaf --no-password --insecure --ca ./root-cert.pem --ca-key ./root-key.pem --kty RSA \
--size 2048 --not-after 8760h --san helloworld.zufar.io
{% endhighlight %}

Note: I still need more context how we define the subject alternative name, will comeback here to fix this if necessary. Because we will using `helloworld.zufar.io` as the service domain.

### Cluster A
Cluster A will act as client side of the mutual TLS communication.

- Create namespace client

{% highlight yml %}
apiVersion: v1
kind: Namespace
metadata:
  name: client
  labels:
    istio-injection: enabled
{% endhighlight %}

- Create certificate for client

{% highlight shell %}
kubectl -n client create secret generic \
cluster-a-client --from-file=cluster-a-client-cert.pem \
--from-file=cluster-a-client-key.pem --from-file=root-cert.pem
{% endhighlight %}

- Create client deployment and mount the certificate via Istio annotation

{% highlight yml %}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sleep
  namespace: client
spec:
  replicas: 1
  selector:
    matchLabels:
      app: sleep
  template:
    metadata:
      annotations:                                                                                       
        sidecar.istio.io/userVolumeMount: '[{"name":"cluster-a-client", "mountPath":"/etc/cluster-a-client", "readonly":true}]'
        sidecar.istio.io/userVolume: '[{"name":"cluster-a-client", "secret":{"secretName":"cluster-a-client"}}]'
      labels:
        app: sleep
    spec:
      containers:
      - name: sleep
        image: curlimages/curl
        command: ["/bin/sleep", "3650d"]
        imagePullPolicy: IfNotPresent
{% endhighlight %}
This annotation will mount certificate inside a secret to `istio-proxy` sidecar in the `/etc/cluster-a-client`.

- Create VirtualService object

virtualService will upgrade HTTP connection to HTTPS connection when accessing `helloworld.zufar.io`
{% highlight yml %}
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: helloworld-zufar-io-vs
  namespace: client
spec:
  hosts:
  - helloworld.zufar.io
  http:
  - match:
    - port: 80
    route:
    - destination:
        host: helloworld.zufar.io
        subset: tls-origination
        port:
          number: 443
{% endhighlight %}
VirtualService add a subset name `tls-origination` to HTTPS connection. This subset will be used by `DestinationRule`.

- Create ServiceEntry object

ServiceEntry object will enable Istio control feature when accessing `helloworld.zufar.io`. We will inject certificate so we need the Istio control feature
{% highlight yml %}
apiVersion: networking.istio.io/v1alpha3
kind: ServiceEntry
metadata:
  name: helloworld-zufar-io-se
  namespace: client
spec:
  hosts:
  - helloworld.zufar.io
  ports:
  - number: 443
    name: https-port-for-tls-origination
    protocol: HTTPS
  resolution: DNS
  location: MESH_EXTERNAL
{% endhighlight %}

- Create DestinationRule object

DestinationRule object will inject certificate that require by mutual TLS
{% highlight yml %}
apiVersion: networking.istio.io/v1alpha3
kind: DestinationRule
metadata:
  name: helloworld-zufar-io-dr
  namespace: client
spec:
  host: helloworld.zufar.io
  subsets:
  - name: tls-origination
    trafficPolicy:
      portLevelSettings:
      - port:
          number: 443
        tls:
          mode: MUTUAL
          clientCertificate: /etc/cluster-a-client/cluster-a-client-cert.pem
          privateKey: /etc/cluster-a-client/cluster-a-client-key.pem
          caCertificates: /etc/cluster-a-client/root-cert.pem
{% endhighlight %}

Thats all on the client side, for making mutual TLS communication, client can use HTTP communication `http://helloworld.zufar.io` and no code change. Istio sidecar will upgrade to HTTPS and enable mutual TLS!

### Cluster B
Cluster B will act as server side, have service helloworld inside. The traffic will enter istio-ingressgateway and terminate mutual TLS there. Istio then forward traffic as plain http to helloworld service.

- Create certificate for istio-ingressgateway

The certificate must be on `istio-system` namespace. Or if you have custom istio-ingressgateway, it must place in the same namespace as the istio-ingressgateway.

{% highlight shell %}
kubectl create -n istio-system secret generic cluster-b-server-cert \
--from-file=key=cluster-b-server-key.pem \
--from-file=cert=cluster-b-server-cert.pem \
--from-file=cacert=root-cert.pem
{% endhighlight %}

- Create namespace service

{% highlight yml %}
apiVersion: v1
kind: Namespace
metadata:
  name: service
  labels:
    istio-injection: enabled
{% endhighlight %}

- Create deployment and service for helloworld

{% highlight yml %}
apiVersion: v1
kind: Service
metadata:
  name: helloworld
  namespace: service
  labels:
    app: helloworld
spec:
  ports:
  - port: 5000
    name: http
  selector:
    app: helloworld
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: helloworld-v1
  namespace: service
  labels:
    version: v1
spec:
  replicas: 1
  selector:
    matchLabels:
      app: helloworld
      version: v1
  template:
    metadata:
      labels:
        app: helloworld
        version: v1
    spec:
      containers:
      - name: helloworld
        image: docker.io/istio/examples-helloworld-v1
        resources:
          requests:
            cpu: "100m"
        imagePullPolicy: IfNotPresent #Always
        ports:
        - containerPort: 5000
{% endhighlight %}

- Create Gateway object

Gateway object will serve the HTTPS communication and add the certificate to istio-ingressgateway.
{% highlight shell %}
apiVersion: networking.istio.io/v1alpha3
kind: Gateway
metadata:
  name: service-gateway
  namespace: istio-system
spec:
  selector:
    istio: ingressgateway
  servers:
    - port:
        number: 80
        name: http
        protocol: HTTP
      tls:
        httpsRedirect: true
      hosts:
        - "*"
    - port:
        number: 443
        name: https
        protocol: HTTPS
      hosts:
        - "*"
      tls:
        mode: MUTUAL
        credentialName: cluster-b-server-cert
{% endhighlight %}

Note: I need more context about why the hosts should asterisk (*). Currently, my understanding is because the root CA is created without any DNS attach to it. I will get back as I get more understanding about this.

- Create VirtualService object

VirtualService object will match host `helloworld.zufar.io` from `service-gateway` and route to the correct `helloworld` service in `service` namespace.
{% highlight yml %}
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: helloworld-zufar-io-vs
  namespace: istio-system
spec:
  hosts:
  - helloworld.zufar.io
  gateways:
  - service-gateway
  http:
  - route:
    - destination:
        host: helloworld.service.svc.cluster.local
        port:
          number: 5000
{% endhighlight %}

### Testing
We cannot se the mutual TLS communication because it is abstracted by Istio sidecar and Istio-ingressgateway. Client can use HTTP communication `http://helloworld.zufar.io` and Istio sidecar will upgrade to HTTPS and enable mutual TLS. To see the packet, we can use wireshark with [sniff to capture the packet](https://zufardhiyaulhaq.com/capture-pod-traffic-with-ksniff/). We can capture packet inside sidecar (istio-proxy) with this command from cluster A:

{% highlight shell %}
kubectl sniff POD_NAME -c istio-proxy -n client \
-f "port 443" \
-p -o - | /Applications/Wireshark.app/Contents/MacOS/Wireshark -i -
{% endhighlight %}

## Conclusion
Mutual TLS enabled trust between client and server. Mutual TLS can be archive by difference approach, via Istio multicluster or via this way. Thank you!
