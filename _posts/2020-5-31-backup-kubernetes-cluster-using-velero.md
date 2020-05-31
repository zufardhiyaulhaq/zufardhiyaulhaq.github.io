---
layout: post
title: Backup Kubernetes Cluster using Velero
---

Velero gives you tools to back up and restore your Kubernetes cluster resources and persistent volumes. Velero have ability to backup cluster, migrate cluster resource to other cluster, and also replicate cluster to other cluster.

This is my first time trying Velero. correct me if I am wrong.

## Requirement
- docker CLI
- docker-compose CLI
- velero CLI
- minio (mc) CLI
- virtualbox
- minikube

### Setup Minio
Minio running as storage backend for velero to store the backup, you can using other storage backend like AWS S3, GCP GCS, and other defined in [backend provider documentation](https://velero.io/docs/v1.4/supported-providers/). For simplicity, we use Minio.

- Install Minio using docker-compose
{% highlight shell %}
version: '3.7'

services:
  minio:
    container_name: minio-storage
    image: minio/minio:RELEASE.2020-05-29T14-08-49Z
    volumes:
      - minio-storage:/minio-storage
    ports:
      - "9000:9000"
    environment:
      MINIO_ACCESS_KEY: zufar_minio_access_key
      MINIO_SECRET_KEY: zufar_minio_secret_key
    command: server /minio-storage
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 20s
      retries: 3

volumes:
  minio-storage:
{% endhighlight %}

{% highlight shell %}
docker-compose up -d
{% endhighlight %}

- get minio IP
{% highlight shell %}
export MINIO_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' minio-storage)
echo "Minio IP: $MINIO_IP"
{% endhighlight %}

- create storage bucket

You can create bucket from web dashboard or via CLI.
{% highlight shell %}
mc config host add minio-storage http://$MINIO_IP:9000 zufar_minio_access_key zufar_minio_secret_key
mc mb minio-storage/velero-bucket
mc policy set public minio-storage/velero-bucket
{% endhighlight %}

### Setup Kubernetes

For simplicity, we using minikube to run Kubernetes cluster.
{% highlight shell %}
minikube start --driver=virtualbox --force=true --kubernetes-version='1.15.11' --memory 16128 --cpus 8 --profile cluster-velero
{% endhighlight %}

### Setup Velero
Velero have two system, the client-side and server-side. First install the CLI (client-side) using brew or asdf or other. It is depended on your environment.

Velero installation is a little complex, for now lets just use `velero install`. You must run this command from environment that have access directly to Kubernetes cluster (have kubectl working).

- Add Velero credential
{% highlight shell %}
vi credentials-velero

[default]
aws_access_key_id = zufar_minio_access_key
aws_secret_access_key = zufar_minio_secret_key
{% endhighlight %}

- Install Velero in Kubernetes
{% highlight shell %}
velero install \
    --provider aws \
    --plugins velero/velero-plugin-for-aws:v1.0.0 \
    --bucket velero-bucket \
    --secret-file ./credentials-velero \
    --backup-location-config region=minio,s3ForcePathStyle="true",s3Url=http://$MINIO_IP:9000 \
    --snapshot-location-config region=minio,s3ForcePathStyle="true",s3Url=http://$MINIO_IP:9000
{% endhighlight %}

- Make sure velero working
{% highlight shell %}
kubectl -n velero get pod
kubectl -n velero get VolumeSnapshotLocation
kubectl -n velero describe VolumeSnapshotLocation
kubectl -n velero get BackupStorageLocation
kubectl -n velero describe BackupStorageLocation
{% endhighlight %}

## Simulate disaster

### Without PVC
- create namespace & deployment
{% highlight shell %}
kubectl apply -f https://gist.githubusercontent.com/zufardhiyaulhaq/c7d59b0725e6c23e5bf6daeeb82b3333/raw/778986f376c5aeef59ec528a1f3a510e0baaab7f/deployment-svc-kubernetes

kubectl -n nginx-example get pod
kubectl -n nginx-example get svc
{% endhighlight %}

- create namespace backup
{% highlight shell %}
velero backup create nginx-backup --include-namespaces nginx-example
{% endhighlight %}

- check backup progress
{% highlight shell %}
velero backup describe nginx-backup
velero backup logs nginx-backup
{% endhighlight %}
You can also check Minio bucket.

- simulate disaster

Please don't delete namespace in production cluster guys
{% highlight shell %}
kubectl delete namespace nginx-example
{% endhighlight %}

- Check namespace & deployment already deleted
{% highlight shell %}
kubectl get namespaces
kubectl -n nginx-example get pod
kubectl -n nginx-example get svc
{% endhighlight %}

- Restore namespaces
{% highlight shell %}
velero restore create --from-backup nginx-backup
{% endhighlight %}

- Check namespace & deployment already restored
{% highlight shell %}
kubectl get namespaces
kubectl -n nginx-example get pod
kubectl -n nginx-example get svc
{% endhighlight %}

### With PVC
- delete previous namespace
{% highlight shell %}
kubectl delete namespace nginx-example
{% endhighlight %}

- create namespace & deployment
{% highlight shell %}
kubectl apply -f https://gist.githubusercontent.com/zufardhiyaulhaq/2ce21ca351807991d8a370315695faee/raw/4c0575f2c74aa26fe32f4eff555be3efcf15e23c/deployment-svc-kubernetes-pvc

kubectl -n nginx-example get pod
kubectl -n nginx-example get svc
kubectl -n nginx-example get pvc
{% endhighlight %}

- create namespace backup
{% highlight shell %}
velero backup create nginx-backup-pvc --include-namespaces nginx-example
{% endhighlight %}

- check backup progress
{% highlight shell %}
velero backup describe nginx-backup-pvc
velero backup logs nginx-backup-pvc
{% endhighlight %}
You can also check Minio bucket.

- simulate disaster

Please don't delete namespace in production cluster guys
{% highlight shell %}
kubectl delete namespace nginx-example
{% endhighlight %}

- Check namespace & deployment already deleted
{% highlight shell %}
kubectl get namespaces
kubectl -n nginx-example get pod
kubectl -n nginx-example get svc
kubectl -n nginx-example get pvc
{% endhighlight %}

- Restore namespaces
{% highlight shell %}
velero restore create --from-backup nginx-backup-pvc
{% endhighlight %}

- Check namespace & deployment already restored
{% highlight shell %}
kubectl get namespaces
kubectl -n nginx-example get pod
kubectl -n nginx-example get svc
kubectl -n nginx-example get pvc
{% endhighlight %}

## Conclusion

Velero is a powerful tools to prevent disaster in Kubernetes also have many storage backend support and easy to recover. But before deploying to production as disaster recovery system, we must deep dive how Velero can backup PVC if you have stateful application. Because PVC have multiple backend.
