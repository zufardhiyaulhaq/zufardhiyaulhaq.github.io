---
layout: post
title: Capture pod packet with sniff
---

I have hard time thinking how easily capture packet request in Kubernetes pod object when trying to debug mutual TLS communication between pod. I can run tcpdump inside the pod, but sometime pod only have read only access and its hard to see the tcpdump. With tcpdump, I also can generate wireshark format to analyze better, but its not funny to copy the result of tcpdump from pod to or desktop everytime I want to capture.

After googling, I found a kubectl plugin named [sniff](https://github.com/eldadru/ksniff). This plugin is awesome, you can capture a packet in pod and connect to wireshark in a realtime basis.

#### Installing
{% highlight shell %}
kubectl krew install sniff
{% endhighlight %}

To use sniff, just simply run this command
{% highlight shell %}
kubectl sniff POD_NAME -n NAMESPACE -f "FILTER" -p -o - | WIRESHARK_PATH -i -
{% endhighlight %}

- flag `f` is a tcpdump filter, it is optional, you can use or not use this flag.
- flag `p` is a privileged mode.
- flag `o` is output, and the example will output to stdout and will be capture with wireshark

for example:
{% highlight shell %}
kubectl sniff grpc-client-5555484dfc-hr4n8 -c grpc-client -n istio-testing -f "port 15443 or port 443" -p -o - | /Applications/Wireshark.app/Contents/MacOS/Wireshark -i -
{% endhighlight %}

