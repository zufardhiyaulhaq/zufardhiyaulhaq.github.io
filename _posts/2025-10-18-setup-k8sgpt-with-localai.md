---
layout: post
title: Setup k8sgpt with LocalAI
---

I have been exploring AI SRE and i stumble across tools call k8sgpt. k8sgpt is open source tooling that can help us troubleshooting Kubernetes with help of LLM like OpenAI. k8sgpt can run locally with CLI but can also be installed as Kubernetes Operator and can automatically scan your cluster and provide result in CRDs format.

There are 2 CRDs that we will try in this blog:
1. k8sgpt CRDs, this is the main CRDs that will execute the scanning process, coordinating with LLM, and provide Result.
2. Result CRDs, this CRDs that provide result of the scan.

K8sgpt depends on LLM. in this case, we will use LocalAI to deploy the LLM model inside our cluster.

## Prerequisites
1. Kubernetes node with GPU

## Setup LocalAI
To setup LocalAI, I recommend to directly use the manifest since as today, setup with helm chart is not that flexible. You need to taint the node with GPU so we can run the LLM model without any noisy neighbor from service that doesn't required GPU.

{% highlight shell %}
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: models-pvc
  namespace: localai-system
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 50Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: local-ai
  namespace: localai-system
  labels:
    app: local-ai
spec:
  selector:
    matchLabels:
      app: local-ai
  replicas: 1
  template:
    metadata:
      labels:
        app: local-ai
      name: local-ai
    spec:
      nodeSelector:
        name: <node-name>
      tolerations:
      - key: nvidia.com/gpu
        operator: Exists
        effect: NoSchedule
      containers:
        - args:
          - phi-2
          env:
          - name: DEBUG
            value: "true"
          - name: PRELOAD_MODELS
            value: "4"
          name: local-ai
          image: quay.io/go-skynet/local-ai:master-cublas-cuda12
          imagePullPolicy: IfNotPresent
          resources:
            requests:
              nvidia.com/gpu: 1
              memory: "16Gi"
              cpu: "2000m"
            limits:
              nvidia.com/gpu: 1
              memory: "25Gi"
              cpu: "7000m"
          volumeMounts:
            - name: models-volume
              mountPath: /build/models
      volumes:
        - name: models-volume
          persistentVolumeClaim:
            claimName: models-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: local-ai
  namespace: localai-system
spec:
  selector:
    app: local-ai
  type: ClusterIP
  ports:
    - protocol: TCP
      targetPort: 8080
      port: 8080
{% endhighlight %}

This will create 1 pod of LocalAI where you can port-forward and open the UI. 

{% highlight shell %}
kubectl port-forward svc/local-ai 8080:8080

curl http://localhost:8080/v1/models
{"object":"list","data":[{"id":"deepseek-r1-distill-qwen-1.5b","object":"model"},{"id":"qwen3-0.6b","object":"model"},{"id":"sd-3.5-medium-ggml","object":"model"},{"id":"clip_g-Q4_0.gguf","object":"model"},{"id":"clip_l-Q4_0.gguf","object":"model"},{"id":"t5xxl-Q4_0.gguf","object":"model"}]}
{% endhighlight %}

to install a new model, you can search the gallery of LocalAI here https://github.com/mudler/LocalAI/blob/master/gallery/index.yaml and copy the name of model that you want to install, for example qwen3-4b

{% highlight shell %}
curl http://localhost:8080/models/apply -H "Content-Type: application/json" -d '{
     "id": "localai@qwen3-4b"
   }'

{"uuid":"db5e068e-ab81-11f0-be39-daa8d82811da","status":"http://localhost:8080/models/jobs/db5e068e-ab81-11f0-be39-daa8d82811da"}
{% endhighlight %}

you can also download model from huggingface

{% highlight shell %}
LOCALAI=http://localhost:8080
curl $LOCALAI/models/apply -H "Content-Type: application/json" -d '{
     "url": "https://huggingface.co/calcuis/illustrious/resolve/main/fast-illustrious-f16.gguf",
     "name": "fast-illustrious-f16"
   }'
{% endhighlight %}

to use the model, you can call the API of LocalAI

{% highlight shell %}
curl http://localhost:8080/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{ "model": "qwen3-4b", "messages": [{"role": "user", "content": "How are you doing?", "temperature": 0.1}] }'
{"created":1760723791,"object":"chat.completion","id":"46a86daf-0313-4281-8c9f-9566dd3595aa","model":"qwen3-4b","choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"\u003cthink\u003e\nOkay, the user asked, \"How are you doing?\" I need to respond appropriately. First, I should acknowledge their greeting. Since I'm an AI, I don't have feelings, but I can simulate a friendly response.\n\nI should mention that I don't have emotions but am here to help. Maybe add a bit of enthusiasm to keep the tone positive. Also, offer assistance with whatever they need. Keep it simple and conversational. Avoid any technical jargon. Make sure the response is welcoming and open-ended so they feel comfortable to ask more questions.\n\u003c/think\u003e\n\nI'm just a virtual assistant, so I don't have feelings or a physical form! But I'm here and ready to help with whatever you need. How can I assist you today? 😊"}}],"usage":{"prompt_tokens":13,"completion_tokens":158,"total_tokens":171}}%
{% endhighlight %}

## Setup k8sGPT

You can setup k8sGPT as kubernetes operator following this guide https://k8sgpt.ai/docs/getting-started/in-cluster-operator

{% highlight shell %}
helm repo add k8sgpt https://charts.k8sgpt.ai
helm repo update
helm install k8sgpt k8sgpt/k8sgpt-operator
{% endhighlight %}

after the operator is installed, we can create k8gGPT object, and operator will automatically scan if there is issue with our Kubernetes. We are using LocalAI backend and use our model that we configured before. It will analyze all namespace every 60 minutes

{% highlight shell %}
apiVersion: core.k8sgpt.ai/v1alpha1
kind: K8sGPT
metadata:
  name: k8sgpt
  namespace: localai-system
spec:
  ai:
    backend: localai
    model: qwen3-4b
    baseUrl: http://local-ai.localai-system.svc.cluster.local:8080/v1
    autoRemediation:
      enabled: false
    enabled: true
    anonymized: true
  noCache: false
  version: v0.4.25
  analysis:
    interval: 60m
  resources:
    requests:
      cpu: 1
      memory: 4Gi
    limits:
      cpu: 1
      memory: 4Gi
{% endhighlight %}

the operator will create a new pod that will help analysis the cluster
{% highlight shell %}
kubectl get pod
NAME                                                        READY   STATUS    RESTARTS   AGE
k8sgpt-56f68b99b4-lt7j7                                     1/1     Running   0          12s
k8sgpt-k8sgpt-operator-controller-manager-c8bd449fd-rsd7q   2/2     Running   0          4d5h
local-ai-5f88ff56b6-b47rs                                   1/1     Running   0          97m

kubectl logs k8sgpt-k8sgpt-operator-controller-manager-c8bd449fd-rsd7q -f --tail 10
2025-10-17T18:09:40Z	INFO	k8sgpt-controller	K8sGPT address: 172.16.2.175:8080
2025-10-17T18:09:40Z	INFO	k8sgpt-controller	K8sGPT client: &{0xc00013e408}
2025-10-17T18:09:40Z	INFO	k8sgpt-controller	Sending signal to configure step
2025-10-17T18:09:40Z	INFO	k8sgpt-controller	Signal sent to configure step
2025-10-17T18:09:40Z	INFO	k8sgpt-controller	Adding remote cache
2025-10-17T18:09:40Z	INFO	k8sgpt-controller	Remote cache added
2025-10-17T18:09:40Z	INFO	k8sgpt-controller	Adding integrations
2025-10-17T18:09:40Z	INFO	k8sgpt-controller	Integrations added
2025-10-17T18:09:40Z	INFO	k8sgpt-controller	ending PreAnalysisStep
2025-10-17T18:09:40Z	INFO	k8sgpt-controller	starting AnalysisStep
{% endhighlight %}

it will generate result CRDs, let's take a look into one of the analysis related to the node

{% highlight shell %}
kubectl describe result apsoutheast5.10.235.66.252
Name:         apsoutheast5.10.235.66.252
Namespace:    localai-system
Labels:       k8sgpts.k8sgpt.ai/backend=localai
              k8sgpts.k8sgpt.ai/name=k8sgpt
              k8sgpts.k8sgpt.ai/namespace=localai-system
Annotations:  <none>
API Version:  core.k8sgpt.ai/v1alpha1
Kind:         Result
Metadata:
  Creation Timestamp:  2025-10-17T18:27:26Z
  Generation:          1
  Resource Version:    501324129
  UID:                 29a01706-e13f-4854-aa1e-de501bc5c544
Spec:
  Auto Remediation Status:
  Backend:  localai
  Details:  <think>
Okay, let's see. The user provided a Kubernetes error message with several conditions. The main issue seems to be related to the node's conditions. Let me break down the error message first.

Looking at the conditions, there's "SufficientIP", "DockerOffline", "NodeGPULostCard", "NodeGPURunModeExclusive", "RuntimeOffline", "InodesPressure", "NodeGPUXIDError", "InstanceExpired", "KernelDeadlock", "NodeNvidiaSmiError", "NodeGPUECCFail", "NTPProblem", "NodePIDPressure", "ReadonlyFilesystem", and "SystemdOffline". But most of these reasons are positive, like "docker daemon is ok", "node has no inodes pressure", etc. Wait, maybe the user is confused because they're seeing multiple conditions, but most are not errors. However, the problem might be that some of these conditions are actually warnings or normal states, but the user is getting an error.

Wait, the user is probably facing a problem where the node is in a state that's causing issues. But looking at the reasons, most are positive. Maybe the actual error is that the node is in a state where some conditions are not met, but the error message is not clear. Alternatively, perhaps the user is seeing a message that's not an error but a list of conditions, and they're not sure how to resolve it.

But the user's instruction says to simplify the error message. The error message seems to be a list of conditions that are all normal or positive. However, maybe the user is seeing a message that's not an error but a list of conditions, and they're confused. Alternatively, maybe the error is that the node is not in a healthy state, but the conditions are all okay. Wait, but the error message is from Kubernetes, so maybe the user is seeing a message that's not an actual error but a list of statuses. However, the user is asking for a solution, so perhaps they are encountering a problem where the node is not healthy, but the conditions are all okay. Alternatively, maybe the user is seeing an error that's a result of multiple conditions, but the actual problem is that the node is in a state where some of these conditions are not met, but the reasons are positive.

Hmm, maybe the user is facing a situation where the node is in a state that's not healthy, but the conditions are all okay. Wait, but the error message provided is a list of conditions with reasons that are positive. So perhaps the user is not seeing an actual error but a list of statuses. However, the user's instruction says to simplify the error message and provide a solution. Maybe the error is that the node has multiple conditions, but they are all okay, so the solution is to check the node's status and ensure all conditions are as expected. But that's not helpful. Alternatively, maybe the user is seeing a message that's a result of a specific condition, but the error is not clear. Alternatively, the user might be encountering an error related to the node's GPU, but the conditions are showing that the GPU is okay.

Wait, looking at the conditions: "NodeGPULostCard" has reason "Node has no lost GPU card error", which is a positive. "NodeGPUHighTemperature" has reason "Node GPU have no high temperature exception". So all these are positive. The error might be that the node is in a state that's not healthy, but the conditions are all okay. However, the user is probably encountering a specific error that is not clear. Maybe the main error is that the node is not healthy, but the conditions are all okay. Alternatively, the user is seeing a message that's a result of a specific condition, but the error is not clear.

Alternatively, the user might be seeing an error that's a result of multiple conditions, but the actual problem is that the node is not in a healthy state. However, the conditions listed are all positive, so maybe the error is that the node is in a normal state, and the solution is to check if there's another issue. But this is unclear. Maybe the user is seeing an error that's not related to the conditions listed. Alternatively, the user is encountering an error that's not in the conditions provided, but the message is a list of conditions.

Given the lack of a clear error message, the solution might be to check the node's status, ensure that all the conditions are as expected, and look for any other issues. However, the user is asking for a solution based on the provided error message. Since all the conditions are positive, the error might be a false positive or a misinterpretation. The solution would be to verify the node's health and check for any other issues that might be causing the error.
</think>

Error: Multiple node conditions are reported as normal, but the error message suggests a potential issue with node health.
Solution: Check node status, verify GPU and system health, ensure no filesystem issues, and confirm runtime daemons are running. Reboot if necessary.
{% endhighlight %}
