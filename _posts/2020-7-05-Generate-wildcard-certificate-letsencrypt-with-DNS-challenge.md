---
layout: post
title: Generate wildcard certificate Let's Encrypt with DNS challenge
---

Let's Encrypt already support generating wildcard certificate for your domain since 2018. This article will help you generate wildcard certificate without setup web server and prefer using DNS challenge

Before generating the certificate, make sure you have an access to your DNS manager and have certbot installed. To generate certificate, you can execute this command:

{% highlight shell %}
certbot certonly --manual -d *.yourdomain.com --preferred-challenges dns
{% endhighlight %}

Certbot will ask you to configure DNS TXT record
{% highlight shell %}
Please deploy a DNS TXT record under the name
_acme-challenge.yourdomain.com with the following value:

xxxxx_xxxxxxxxxx_xxxxxxxxxx-xx

Before continuing, verify the record is deployed.
{% endhighlight %}

configure your record with something like:
- Hostname: _acme-challenge
- TTL: 300
- Type: TXT
- Address/value: xxxxx_xxxxxxxxxx_xxxxxxxxxx-xx

Be careful not to enter the certbot command directly. You must wait 10-20 minutes to make the record sync. After that you can press enter in the certbot!

{% highlight shell %}
IMPORTANT NOTES:
 - Congratulations! Your certificate and chain have been saved at:
   /etc/letsencrypt/live/yourdomain.com/fullchain.pem
{% endhighlight %}

you can check with openssl command
{% highlight shell %}
openssl x509 -in /etc/letsencrypt/live/yourdomain.com/fullchain.pem -text
openssl x509 -in /etc/letsencrypt/live/yourdomain.com/cert.pem -text
{% endhighlight %}

you can see the Subject Alternative Name
{% highlight shell %}
X509v3 Subject Alternative Name: 
    DNS:*.zufardhiyaulhaq.com
{% endhighlight %}
