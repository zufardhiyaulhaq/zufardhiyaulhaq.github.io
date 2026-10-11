---
layout: post
title: Why I run the FastGateway demo on vcluster
tags: [kubernetes, networking, tooling, hardware]
---

I develop [FastGateway](https://fastgateway.dev), an open-source API gateway you manage without writing Kubernetes manifests. The best marketing for it is a demo anyone can try with no deployment effort, one that resets to a clean state on a schedule.

I build it solo, with no team behind it, so the demo has to run on hardware I already own: a k3s cluster on a few Raspberry Pis at home. The tool that makes that work is [vcluster](https://www.vcluster.com/).

## The demo needs a real API, not a sandbox app

FastGateway is not a self-contained web app I can run in a single deployment. It materializes real Kubernetes objects: Gateway API resources like `Gateway`, `HTTPRoute`, and `GRPCRoute`. It also needs cert-manager for certificate management, Envoy Gateway, and Envoy as the data plane. A visitor trying it out creates those objects for real and watches the gateway react.

**That means the demo environment needs its own API server, its own CRDs, and its own cluster-scoped objects.** A visitor has to be able to install a `GatewayClass`, create a `Gateway`, and route to it without colliding with the next visitor or with the host cluster. That is the thing a plain namespace cannot give you. CRDs and `GatewayClass` are cluster-scoped: there is one copy per API server, shared by everyone on it.

So the real requirement is isolation at the API-server level, cheap enough to run on a Pi and cheap enough to throw away every few hours.

## The alternatives

| Option | Isolates CRDs + cluster-scoped objects | Cost on home hardware | Verdict |
|-|-|-|-|
| Shared namespace on the host cluster | No. One set of CRDs and one `GatewayClass` for everyone, visitors collide | Lowest | Rejected |
| k3d / kind (a full cluster in containers) | Yes, a real separate API server | ~2 to 4x the RAM per environment, needs a Docker or nested runtime the Pis handle poorly | Rejected |
| A dedicated cluster or spare nodes | Yes | Needs hardware I do not have for a free demo | Rejected |
| vcluster | Yes, its own API server with its own CRDs | Roughly one control-plane pod, workloads sync onto the host nodes | Chosen |

The namespace is free but gives no API isolation. k3d and kind give real isolation but want a nested container runtime and several times the memory per environment, which is the wrong trade on a 4 to 8 GB board. A dedicated cluster defeats the point of a cheap home demo.

## Why vcluster is the right size

A vcluster is a full Kubernetes API server running as a pod inside a namespace of the host cluster. You get your own API server, your own CRDs, your own RBAC, and your own cluster-scoped objects. The workloads you create in it are synced down and scheduled as ordinary pods on the host nodes. Three properties make it fit an ephemeral demo:

**No dedicated worker node.** A vcluster is roughly one control-plane pod. The FastGateway controller and the Envoy replicas it creates sync onto the existing host nodes, so I do not carve out hardware for the demo. On a handful of Pis, that difference is the whole budget.

**Easy to deploy.** The entire stack comes up from one Helm release. vcluster can bootstrap manifests and Helm charts inside the virtual cluster at startup through `experimental.deploy`, so the Gateway API CRDs and FastGateway itself are installed as the virtual cluster components. There is no second step wiring the gateway in after the cluster exists. (`experimental.deploy` is flagged experimental by vcluster: breaking changes can land between releases, so pin the chart version.)

**Destroy and recreate trivially.** Tearing the demo down is deleting one namespace on the host. Recreating it is one apply. That is exactly the shape an ephemeral demo wants: a scheduled job deletes the whole thing, and GitOps rebuilds it from the same release, clean, a minute later.

## How the pieces fit

Conceptually the demo is three moving parts:

1. A virtual cluster that bootstraps the FastGateway stack inside itself at startup (Envoy Gateway, Gateway API CRDs, cert-manager, PostgreSQL, Redis, FastGateway frontend and backend), so the moment it is up it already has the CRDs, the controller, and a default `GatewayClass`.
2. The host cluster's existing ingress fronts the virtual cluster's API and the demo gateway, so a visitor reaches both without any per-demo networking setup.
3. A scheduled reaper deletes the namespace, and GitOps recreates the virtual cluster from the same definition. Reset without a human.

The isolation is the point. A visitor can install CRDs and create a `GatewayClass` inside the virtual cluster and it stays inside the virtual cluster. The host, and the next reset, are untouched.

## What I would tell myself before starting

If the thing you are demoing only creates namespaced objects, a shared namespace is probably enough and vcluster is overkill. The moment it needs its own CRDs, its own `GatewayClass`, or any cluster-scoped object a visitor can create, a namespace stops being an option and a full cluster per visitor is too expensive on home hardware. vcluster sits exactly in that gap.

The actual GitOps definition, the ArgoCD `Application` that deploys the vcluster chart with the whole stack bootstrapped in its `experimental.deploy`, is in my community-ops repo: [`demo-vcluster-01.yaml`](https://github.com/zufardhiyaulhaq/community-ops/blob/master/clusters/home-lab-kubernetes-01/argocd/namespaces/argocd-system/applications.argoproj.io/demo-vcluster-01.yaml). The vcluster configuration itself, the values files for a minimal cluster, custom API hostnames, resource quotas, and the `experimental.deploy` manifests and Helm charts, is written up as a companion reference in my notes: [vcluster guides](https://notes.zufardhiyaulhaq.com/guides/vcluster/).

**Further reading:** [vcluster documentation](https://www.vcluster.com/docs/vcluster/); the [Gateway API](https://gateway-api.sigs.k8s.io/) project; and [FastGateway demo](https://demo.fastgateway.dev) itself.
