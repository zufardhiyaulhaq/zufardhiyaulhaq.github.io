---
layout: post
title: Istio Access/connection logging
---

There are times when we really struggle to troubleshoot the networking behaviour of our applications. The reason behind this is because the application not omitted a networking log stuff, for example what protocol they used, what the source & destination IP, what is the domain they call, etc.

By using Istio service mesh, this purpose can be archived to make troubleshooting, logging, and audit more easy because we can track every incoming or outgoing connection, but this behaviour need to be enabled since it is a additional feature that [Istio & Envoy support](https://www.envoyproxy.io/docs/envoy/latest/configuration/observability/access_log/usage).

To enabled access or connection logging in all sidecar and gateway. We can create EnvoyFilter that enabled access logging in the sidecar.

<script src="https://gist.github.com/zufardhiyaulhaq/5f03ff8839a595cb1e28b9d82c9df7f7.js"></script>

The result is pretty awesome logging on the gateway and the sidecar. For example when I try to curl a service via Istio gateway:

{% highlight shell %}
curl https://server-1.zufar.io/ 
{% endhighlight %}

In the gateway, we can check the log, and this is the log result:

{% highlight json %}
kubectl logs istio-ingressgateway-6fb59c6cc4-7plvb -f --tail 1

{
    "upstream_local_address": "10.244.1.9:59742",
    "duration": "7",
    "upstream_transport_failure_reason": "-",
    "route_name": "helloworld-istio-testing-route",
    "downstream_local_address": "10.244.1.9:443",
    "user_agent": "curl/7.58.0",
    "response_code": "200",
    "response_flags": "-",
    "start_time": "2020-10-23T11:08:53.165Z",
    "method": "GET",
    "request_id": "8bd5d27b-7e96-4631-a64e-668f8a071260",
    "upstream_host": "10.244.1.10:80",
    "x_forwarded_for": "10.244.2.0",
    "requested_server_name": "server-1.zufar.io",
    "bytes_received": "0",
    "istio_policy_status": "-",
    "bytes_sent": "1078",
    "upstream_cluster": "outbound|80||helloworld.istio-testing.svc.cluster.local",
    "downstream_remote_address": "10.244.2.0:41474",
    "authority": "server-1.zufar.io",
    "path": "/",
    "protocol": "HTTP/2",
    "upstream_service_time": "7"
}
{% endhighlight %}

With this log result, we can get lot of information that might be useful for debugging and auditing. Another example is communicating between workload in Istio mesh, we can check in both of source client and destination service log (container istio-proxy):

source client, you can see there is an outbout connection from the client.
{% highlight json %}
kubectl logs sleep-f879cc66-dzbwr -f -c istio-proxy

{
    "response_flags": "-",
    "start_time": "2020-10-23T11:15:19.184Z",
    "method": "GET",
    "request_id": "be5acb4a-9e3e-4540-814d-07c2c7dcf7f1",
    "upstream_host": "10.244.1.10:80",
    "x_forwarded_for": "-",
    "requested_server_name": "-",
    "bytes_received": "0",
    "istio_policy_status": "-",
    "bytes_sent": "935",
    "upstream_cluster": "outbound|80||helloworld.istio-testing.svc.cluster.local",
    "downstream_remote_address": "10.244.4.4:37034",
    "authority": "helloworld",
    "path": "/",
    "protocol": "HTTP/1.1",
    "upstream_service_time": "31",
    "upstream_local_address": "10.244.4.4:33806",
    "duration": "47",
    "upstream_transport_failure_reason": "-",
    "route_name": "default",
    "downstream_local_address": "10.32.29.63:80",
    "user_agent": "curl/7.69.1",
    "response_code": "200"
}
{% endhighlight %}


destination service, you can see there is an inbound connection to this service.
{% highlight json %}
kubectl logs helloworld-65b9467fd4-q9mhc -f -c istio-proxy

{
    "response_flags": "-",
    "start_time": "2020-10-23T11:15:19.207Z",
    "method": "GET",
    "request_id": "be5acb4a-9e3e-4540-814d-07c2c7dcf7f1",
    "upstream_host": "127.0.0.1:80",
    "x_forwarded_for": "-",
    "requested_server_name": "outbound_.80_._.helloworld.istio-testing.svc.cluster.local",
    "bytes_received": "0",
    "istio_policy_status": "-",
    "bytes_sent": "935",
    "upstream_cluster": "inbound|80|http|helloworld.istio-testing.svc.cluster.local",
    "downstream_remote_address": "10.244.4.4:33806",
    "authority": "helloworld",
    "path": "/",
    "protocol": "HTTP/1.1",
    "upstream_service_time": "1",
    "upstream_local_address": "127.0.0.1:52576",
    "duration": "1",
    "upstream_transport_failure_reason": "-",
    "route_name": "default",
    "downstream_local_address": "10.244.1.10:80",
    "user_agent": "curl/7.69.1",
    "response_code": "200"
}
{% endhighlight %}

May this is help for you who implement Istio and struggling to troubleshoot networking problem in the application. 
