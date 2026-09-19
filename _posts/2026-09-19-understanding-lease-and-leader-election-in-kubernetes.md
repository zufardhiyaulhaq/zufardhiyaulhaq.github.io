---
layout: post
title: Understanding Lease and leader election in Kubernetes
tags: [kubernetes]
---

I write Kubernetes operator like [frp-operator](https://github.com/zufardhiyaulhaq/frp-operator) and istio-ratelimit-operator, maintain multiple Kubernetes operator like ArgoCD, Istio, CloudNativePG, etc. but never actually understand how this controller handle leader election.

Leader election is needed since controller cannot run in High Availability mode, they will try to reconcile the same objects. causing race condition. Leader election is how Kubernetes lets you run several replicas but keep exactly one of them doing the work. 

In this blog, I will deepdive into how leader election works in Kubernetes. The mechanism is smaller than it looks: one `Lease` object and the API server's optimistic concurrency. No consensus algorithm, no quorum, no gossip.

I will use my own operator, [frp-operator](https://github.com/zufardhiyaulhaq/frp-operator), as the running example so the numbers are real. It runs on controller-runtime v0.18.4 and client-go v0.30.1 with the library defaults.

## The Lease object

Leader election is backed by a single `Lease` in the `coordination.k8s.io/v1` API, one per operator. Its fields are the whole state machine: 
1. `holderIdentity` (who holds it)
2. `leaseDurationSeconds` (how long it is valid without a renew)
3. `renewTime`
4. `acquireTime`
5. `leaseTransitions` (a counter of handovers of leader).

```yaml
apiVersion: coordination.k8s.io/v1
kind: Lease
metadata:
  name: 742639e4.zufardhiyaulhaq.com
  namespace: infrastructure
spec:
  acquireTime: "2026-09-19T05:23:47.524381Z"
  holderIdentity: frp-operator-controller-manager-846c7b98bc-gnmc2_0e7f0f68-c485-4a86-93f6-ed79fc59edcf
  leaseDurationSeconds: 15
  leaseTransitions: 298
  renewTime: "2026-09-19T05:24:47.095340Z"
```

The values frp-operator runs with, all library defaults unless noted:

| Setting | Value | Source |
|---|---|---|
| Lock object | `Lease` | controller-runtime default |
| Lease name | `742639e4.zufardhiyaulhaq.com` | `LeaderElectionID` in `main.go` |
| Identity of each pod | `<pod name>_<random UUID>`, new UUID every process start | controller-runtime |
| LeaseDuration | 15 seconds | default |
| RenewDeadline | 10 seconds | default |
| RetryPeriod | 2 seconds | default |
| Follower poll interval | 2 to 4.4 seconds (RetryPeriod plus random 0 to 2.4) | client-go jitter |
| LeaderElectionReleaseOnCancel | false | default |

## Electing the first leader

Controllers do not run until a pod wins. Every pod first starts its health and metrics servers and waits for its informer caches to sync, and only then enters the election loop.

The API server does not pick the winner by itself. It passes every write to etcd as a conditional transaction: a create succeeds only if the key does not exist, an update succeeds only if the object is still at the `resourceVersion` the client sent. So exactly one request wins and the rest get `409 Conflict`.

```mermaid
sequenceDiagram
    autonumber
    participant A as pod-a (frp-operator)
    participant B as pod-b (frp-operator)
    participant C as pod-c (frp-operator)
    participant API as kube-apiserver
    participant ETCD as etcd

    Note over A,C: Each pod starts health and metrics servers,<br/>starts informers and waits for cache sync,<br/>then starts the leader election loop.<br/>Controllers are NOT running yet.

    alt Lease does not exist yet (fresh install)
        par
            A->>API: GET Lease 742639e4.zufardhiyaulhaq.com
            API-->>A: 404 Not Found
        and
            B->>API: GET Lease
            API-->>B: 404 Not Found
        and
            C->>API: GET Lease
            API-->>C: 404 Not Found
        end
        par
            A->>API: POST Lease, holderIdentity=pod-a_uuid, leaseDurationSeconds=15
        and
            B->>API: POST Lease, holderIdentity=pod-b_uuid
        and
            C->>API: POST Lease, holderIdentity=pod-c_uuid
        end
        API->>ETCD: pod-a: create key only if it does not exist
        ETCD-->>API: success
        API-->>A: 201 Created
        API->>ETCD: pod-b: create key only if it does not exist
        ETCD-->>API: failed, key already exists
        API-->>B: 409 Conflict (AlreadyExists)
        API->>ETCD: pod-c: create key only if it does not exist
        ETCD-->>API: failed, key already exists
        API-->>C: 409 Conflict (AlreadyExists)
    else Lease exists from a previous install, holder is gone
        A->>API: GET Lease
        API-->>A: 200 OK, holderIdentity=old-pod_uuid, resourceVersion=1000
        Note over A,C: Each pod records the object and waits until its own<br/>clock shows 15 seconds since its first GET.<br/>Nobody renews, so the record never changes again.
        par
            A->>API: PUT Lease, holderIdentity=pod-a_uuid, leaseTransitions+1, resourceVersion=1000
        and
            B->>API: PUT Lease, resourceVersion=1000
        and
            C->>API: PUT Lease, resourceVersion=1000
        end
        API->>ETCD: pod-a: update only if still at resourceVersion 1000
        ETCD-->>API: success, new resourceVersion 1001
        API-->>A: 200 OK
        API->>ETCD: pod-b: update only if still at resourceVersion 1000
        ETCD-->>API: failed, object is at 1001
        API-->>B: 409 Conflict
        API->>ETCD: pod-c: update only if still at resourceVersion 1000
        ETCD-->>API: failed, object is at 1001
        API-->>C: 409 Conflict
    end

    Note over A: pod-a is the leader. OnStartedLeading starts the controllers.<br/>Informers replay every object, so everything is reconciled once.
    Note over B,C: The losers log the failed write and retry 2 to 4.4 seconds later.
    B->>API: GET Lease
    API-->>B: 200 OK, holderIdentity=pod-a_uuid
    Note over B: Holder is someone else and the lease is valid, so stay follower.
```

On a fresh install the winner gets `201 Created` and the losers get `409` with reason `AlreadyExists`. When a stale Lease already exists, the winner of the conditional `PUT` gets `200 OK` and the losers get `409 Conflict`. Either way, one writer wins on a single etcd transaction. No election protocol runs between the pods at all.

## Holding the lease

The leader keeps the lease by writing `renewTime` every `RetryPeriod` (2 seconds), counted from the end of the previous write. It reuses the Lease object it got back from its last write, so it does not even need a `GET` first.

```mermaid
sequenceDiagram
    autonumber
    participant A as pod-a (leader)
    participant API as kube-apiserver
    participant ETCD as etcd

    loop Every 2 seconds, from the end of the previous write
        A->>API: PUT Lease, renewTime=now, resourceVersion=1001
        API->>ETCD: update only if still at resourceVersion 1001
        ETCD-->>API: success, new resourceVersion 1002
        API-->>A: 200 OK, resourceVersion=1002
        Note over A: Keep the returned object for the next PUT.
    end

    Note over A,ETCD: Failure: API server slow or unreachable, or the PUT is rejected
    A->>API: PUT Lease
    API--xA: timeout or error
    loop Retry every 2 seconds, up to 10 seconds (RenewDeadline)
        A->>API: GET Lease, then PUT Lease
        API--xA: timeout or error
    end
    alt A renew succeeds inside the 10 seconds
        Note over A: Still leader, back to the normal loop
    else No successful renew for 10 seconds
        Note over A: OnStoppedLeading fires. controller-runtime reports<br/>"leader election lost", mgr.Start returns the error,<br/>main.go calls os.Exit(1).
        Note over A: kubelet restarts the container. The new process<br/>gets a new UUID, so a new identity, and joins as a follower.
    end
```

The important number is `RenewDeadline` (10 seconds). If the leader cannot renew for that long, it does not keep acting as leader; it deliberately exits. That leaves room before any follower is allowed to take over:

| Time | Event |
|---|---|
| 10:00:00.0 | Last successful renew |
| 10:00:02.0 | Next renew fails, the 10 second RenewDeadline starts |
| 10:00:12.0 | Leader gives up and exits |
| 10:00:15.0 | Earliest a follower can consider the lease expired |

The leader always stops at least 3 seconds before any follower can take over. That gap (RenewDeadline shorter than LeaseDuration) is what prevents two active leaders.

## How a follower spots a dead leader

This is the part that surprises people. **A follower never reads `renewTime` as a timestamp. It only checks whether the Lease record changed.**

Each follower keeps two things in memory: the bytes of the record from its last `GET`, and `observedTime`, which is the time on the follower's own clock when it last saw the record change. If the record has not changed for `LeaseDuration` (15 seconds) by the follower's own clock, the lease is expired and the follower tries to take it.

```mermaid
sequenceDiagram
    autonumber
    participant B as pod-b (follower)
    participant API as kube-apiserver

    Note over B: In memory: record bytes from the previous GET,<br/>and observedTime = clock time when the record last changed.
    loop Every 2 to 4.4 seconds
        B->>API: GET Lease
        API-->>B: 200 OK, holderIdentity, renewTime, leaseTransitions, ...
        alt Record differs from the previous GET
            Note over B: Save new bytes. observedTime = now.
        else Record is identical
            Note over B: observedTime stays as it was.
        end
        alt holderIdentity is empty (leader released it)
            B->>API: PUT Lease, holderIdentity=pod-b_uuid (take over now)
        else now minus observedTime is less than 15 seconds
            Note over B: Leader is alive, do nothing.
        else now minus observedTime is 15 seconds or more
            B->>API: PUT Lease, holderIdentity=pod-b_uuid, leaseTransitions+1
            API-->>B: 200 OK = pod-b is leader, 409 = another pod won
        end
    end
```

Why compare bytes instead of trusting `renewTime`? Because `renewTime` is written by the leader's clock and read by the follower's clock, and those two clocks are on different nodes. Comparing them directly would make expiry depend on clock skew. Comparing the record against its own previous copy, and timing with its own clock, keeps the whole decision local.

A worked example, leader renewing at `:00`, `:02`, `:04` and then dying:

| Follower poll | Record changed? | observedTime | now minus observedTime | Expired? |
|---|---|---|---|---|
| 10:00:06.5 | yes | 10:00:06.5 | 0.0 s | no |
| 10:00:09.8 | no | 10:00:06.5 | 3.3 s | no |
| 10:00:13.2 | no | 10:00:06.5 | 6.7 s | no |
| 10:00:16.9 | no | 10:00:06.5 | 10.4 s | no |
| 10:00:19.5 | no | 10:00:06.5 | 13.0 s | no |
| 10:00:21.6 | no | 10:00:06.5 | 15.1 s | yes, take over |

## Losing the leader: graceful shutdown

A `SIGTERM` is the common case: `kubectl delete pod`, a rollout restart, a Helm upgrade, a node drain. By default (frp-operator does not set `LeaderElectionReleaseOnCancel`) the leaving leader does **not** clear the Lease. It just stops renewing, and the record sits with the old holder until it expires.

```mermaid
sequenceDiagram
    autonumber
    participant K as kubelet
    participant A as pod-a (leader)
    participant B as pod-b (follower)
    participant API as kube-apiserver

    K->>A: SIGTERM at 10:05:30.0, 10 second grace period starts
    Note over A: Manager context cancelled. Controllers stop taking new work<br/>and wait for running Reconcile calls to finish.
    par Renew keeps running during the drain
        A->>API: PUT Lease, renewTime=10:05:31.0, then 10:05:33.0
        API-->>A: 200 OK
    and Follower keeps polling
        B->>API: GET Lease
        API-->>B: 200 OK, record changed, holder is pod-a
        Note over B: observedTime = now, keep waiting
    end
    Note over A: Stop informers, webhooks, metrics, health servers.<br/>Cancel leader election. ReleaseOnCancel is false, so NO release write.<br/>Lease still says holderIdentity=pod-a_uuid.
    Note over A: Process exits at 10:05:33.5.
    B->>API: GET Lease at 10:05:34.2
    API-->>B: 200 OK, renewTime=10:05:33.0, record changed
    Note over B: observedTime = 10:05:34.2
    loop Every 2 to 4.4 seconds
        B->>API: GET Lease
        API-->>B: 200 OK, record identical
    end
    Note over B: 10:05:49.5 minus 10:05:34.2 = 15.3 seconds, expired
    B->>API: PUT Lease, holderIdentity=pod-b_uuid, leaseTransitions+1
    API-->>B: 200 OK
    Note over B: pod-b is leader at 10:05:49.5, reconciles every object.
```

In this example no controller runs from 10:05:30.0 to 10:05:49.5, about **19.5 seconds**, even though the shutdown itself was clean. The gap is almost a full `LeaseDuration`, spent waiting for a lease everyone knows is dead.

## Faster handoff: release on cancel

Setting `LeaderElectionReleaseOnCancel: true` in `ctrl.Options` changes one thing: on shutdown the leader writes the Lease one last time with an empty `holderIdentity`. A follower that sees an empty holder skips the 15 second wait entirely and takes over on its next poll.

```mermaid
sequenceDiagram
    autonumber
    participant K as kubelet
    participant A as pod-a (leader)
    participant B as pod-b (follower)
    participant API as kube-apiserver

    K->>A: SIGTERM at 10:05:30.0
    Note over A: Same drain as before. pod-a keeps renewing while it drains,<br/>so pod-b cannot take over mid-drain.
    Note over A: Stop servers, cancel leader election.
    A->>API: PUT Lease at 10:05:33.5, holderIdentity empty, leaseDurationSeconds=1
    API-->>A: 200 OK
    Note over A: Emits "stopped leading", process exits.
    B->>API: GET Lease at 10:05:35.1
    API-->>B: 200 OK, holderIdentity empty
    Note over B: Record changed, holder empty, so skip the 15 second check.
    B->>API: PUT Lease, holderIdentity=pod-b_uuid, leaseTransitions+1
    API-->>B: 200 OK
    Note over B: pod-b is leader at 10:05:35.1
```

The pause drops from about 19.5 seconds to about **5.1 seconds**, most of which is the drain itself. The release is best-effort: it falls back to the default behavior if the final `PUT` hits a `409`, if the leader had already lost the lease, or if the drain runs past the 10 second grace period and kubelet sends `SIGKILL`.

## Losing the leader: hard kill

`SIGKILL`, an OOM kill, a crash, or a node failure gives no chance to drain and no chance to release. The Lease simply stops changing, and the follower waits it out exactly like the graceful-without-release case.

```mermaid
sequenceDiagram
    autonumber
    participant A as pod-a (leader)
    participant B as pod-b (follower)
    participant API as kube-apiserver

    A->>API: PUT Lease, renewTime=10:00:04.0 (last successful renew)
    API-->>A: 200 OK
    Note over A: 10:00:05.0 killed: OOM, kill -9, crash, or node failure.<br/>No drain, no release. A running Reconcile stops halfway.
    B->>API: GET Lease at 10:00:06.5
    API-->>B: 200 OK, renewTime=10:00:04.0, record changed
    Note over B: observedTime = 10:00:06.5
    loop Every 2 to 4.4 seconds
        B->>API: GET Lease
        API-->>B: 200 OK, record identical
    end
    Note over B: 10:00:21.6 minus 10:00:06.5 = 15.1 seconds, expired
    B->>API: PUT Lease, holderIdentity=pod-b_uuid, leaseTransitions+1
    API-->>B: 200 OK
    Note over B: pod-b is leader at 10:00:21.6. Informers replay all objects,<br/>which also finishes whatever pod-a left halfway.
```

No controller runs from 10:00:05.0 to 10:00:21.6, about **16.6 seconds**, and the takeover can land up to 4.4 seconds later depending on when the follower happens to poll.

## The single-replica trap

The chart default is 1 replica, so most of the time there is no follower waiting. When the one pod dies, the same container name comes back, but with a **new UUID**, so a new identity, and with empty memory. Because its memory starts empty, it has to wait the full 15 seconds from its own first `GET`, no matter how long the old process has been dead.

```mermaid
sequenceDiagram
    autonumber
    participant K as kubelet
    participant OLD as pod-a old process
    participant NEW as pod-a new process
    participant API as kube-apiserver

    OLD->>API: PUT Lease, renewTime=10:00:04.0 (last renew)
    API-->>OLD: 200 OK
    Note over OLD: 10:00:05.0 OOMKilled
    K->>NEW: Restart container (after any back-off)
    Note over NEW: Same pod name, new UUID. Starts servers, syncs caches.
    NEW->>API: GET Lease at 10:00:08.0
    API-->>NEW: 200 OK, holderIdentity=pod-a_olduuid
    Note over NEW: Memory empty, so record counts as changed. observedTime = 10:00:08.0
    loop Every 2 to 4.4 seconds
        NEW->>API: GET Lease
        API-->>NEW: 200 OK, record identical
    end
    Note over NEW: 15 seconds after 10:00:08.0, take over
    NEW->>API: PUT Lease, holderIdentity=pod-a_newuuid, leaseTransitions+1
    API-->>NEW: 200 OK
    Note over NEW: Leader, starts controllers.
```

## Tuning and takeaways

- Shorter `LeaseDuration` and `RenewDeadline` mean faster failover but more writes and problem for a slow API server. The defaults (15 / 10 / 2) are a sane starting point.
- Set `LeaderElectionReleaseOnCancel: true` if you care about fast, clean handovers on rollouts. It turns a ~15 second wait into an immediate takeover, for the cost of one extra write to API server.
- Run at least 2 replicas for real availability, and add pod anti-affinity so they do not share a node or a failure domain.
- `leaseTransitions` is a health signal. If it climbs, your leader is flapping and never stable.

## Sources

- Kubernetes docs: [Leases](https://kubernetes.io/docs/concepts/architecture/leases/) and the [Lease API reference](https://kubernetes.io/docs/reference/kubernetes-api/coordination/lease-v1/).
- client-go v0.30.1: [`tools/leaderelection/leaderelection.go`](https://github.com/kubernetes/client-go/blob/v0.30.1/tools/leaderelection/leaderelection.go) (`acquire`, `renew`, `release`, `tryAcquireOrRenew`, `isLeaseValid`) and [`resourcelock/leaselock.go`](https://github.com/kubernetes/client-go/blob/v0.30.1/tools/leaderelection/resourcelock/leaselock.go).
- controller-runtime v0.18.4: [`pkg/leaderelection/leader_election.go`](https://github.com/kubernetes-sigs/controller-runtime/blob/v0.18.4/pkg/leaderelection/leader_election.go) and [`pkg/manager/internal.go`](https://github.com/kubernetes-sigs/controller-runtime/blob/v0.18.4/pkg/manager/internal.go).
- frp-operator: [`main.go`](https://github.com/zufardhiyaulhaq/frp-operator/blob/main/main.go) and the [Helm chart](https://github.com/zufardhiyaulhaq/frp-operator/blob/main/charts/frp-operator/templates/deployment.yaml).
