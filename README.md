# KubeVerse

KubeVerse is a 3D playground for learning how Kubernetes works. Instead of reading about clusters, Nodes and Pods, you fly around a small floating world where each of them is something you can see and click. The control plane is a hexagonal island, worker Nodes are round platforms, and Pods are little creatures that live on them.

I started it because most Kubernetes explanations are walls of YAML and boxes with arrows. That works once you already get it. Before that, it's hard to picture what actually happens when you run a Pod, who decides where it goes, or why it comes back after you delete it. KubeVerse tries to make that visible.

Everything runs in the browser. There is no real cluster behind it: the cluster is simulated, so you can break things without consequences.

## What you can do

The app has two modes, switched from the bottom right corner.

**Explore** drops you into a demo cluster that is already running: one control plane, three worker Nodes and a handful of workloads across a few namespaces. You can click any island to focus on it, select a Pod to inspect it, press Enter to step inside it and see its containers, and open the field guide for short explanations of what you are looking at. One of the Pods is crash looping on purpose, so you can see what an unhealthy workload looks like.

**Learn** is a guided path. Each lesson starts from a specific world, gives you one small objective at a time, and only lets you do what makes sense at that point. When you get something right, a card explains the concept you just touched. When you click the wrong thing, you get a nudge instead of a failure. Hints are there if you get stuck, and progress is saved in your browser.

A third mode, Playground, is planned but not built yet.

## The lessons

**1. The Birth of a Cluster.** The universe starts empty and dark, with a single crystal waiting in the middle. You initialize the cluster, discover the control plane, add worker Nodes, and learn to tell the part that coordinates from the parts that provide capacity.

**2. Meet Your First Pod.** An application arrives as a container. You open it to see its image layers, wrap it in a Pod, step inside, meet a second container sharing the same Pod, and watch what happens when a program finishes or fails. It ends on the difference between a Pod's phase and a container's state.

**3. Behind the Scenes.** You submit a Pod through the API and follow it component by component: the API server, etcd, the scheduler weighing the Nodes, the kubelet, and finally the container runtime. You even get to predict which Node the scheduler will pick before it does.

**4. A World That Maintains Itself.** You delete your Pod and notice nobody brings it back. Then you describe what you want with a Deployment and watch controllers keep the cluster in that state: replacing Pods you remove, scaling up and down, running out of room, and rolling out a new version.

**5. When Things Go Wrong** is next on the list.

## Running it locally

You need Node.js 20.19 or newer (22.12+ also works).

```bash
git clone https://github.com/elisacoh/kubeverse.git
cd kubeverse
npm install
npm run dev
```

Then open the URL Vite prints, usually http://localhost:5173.

Other scripts:

```bash
npm test           # unit tests (Vitest)
npm run typecheck  # TypeScript, no emit
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
```

A reasonably recent GPU helps, but the scene adapts its resolution when frames start dropping, so it runs fine on most laptops.

## Controls

Drag to orbit, scroll to zoom, and double click anywhere to pivot the camera around that spot. Click an island or a Pod to focus on it, click empty space to clear the selection.

| Key | Action |
| --- | --- |
| Esc | Go back one level |
| Home | Return to the cluster overview |
| Enter | Step inside the selected Pod |

## How it's built

The stack is React 19, TypeScript, Vite, three.js through React Three Fiber and drei, Zustand for state, and Tailwind for the interface.

The code is split so that the Kubernetes logic never depends on how things are drawn:

```
src/
  domain/      Kubernetes objects, selectors, manifests, crash loop rules
  simulation/  the fake cluster: demo data and the controllers that reconcile it
  learning/    lessons, the engine that runs them, objectives, hints, concepts
  state/       app stores (view, selection, presentation, request flows)
  scene/       everything 3D: islands, Pods, camera, atmosphere, labels
  ui/          panels, inspectors, lesson cards, HUD
```

A lesson is plain data. It declares the world it starts from, which build actions are allowed, the list of objectives with the action that completes each one, what to highlight in the scene, and the feedback to show for common mistakes. The engine in `src/learning/engine.ts` takes learner actions, checks them against the current objective and decides what the scene is allowed to show. The 3D components only read that state, which keeps the lessons testable without rendering anything.

The controllers in `src/simulation/controllers.ts` are a small imitation of the real ones: a Deployment controller managing ReplicaSets, a ReplicaSet controller managing Pods, and a scheduler that keeps the Nodes with enough free room for the Pod's requests, then picks the one with the most free CPU. They are simplified on purpose. The goal is to show the idea of a reconcile loop clearly, not to reproduce every edge case of the real thing.

## Tests

The tests cover the parts where being wrong would actually teach someone the wrong thing: the lesson engine, each lesson's progression, the controllers, the crash loop backoff and manifest generation. Run them with `npm test`.

## Status

This is a personal project and still moving. Lessons 1 to 4 are playable from start to finish, lesson 5 and the Playground mode are still to come, and the visuals keep getting polished as I go. Feedback and ideas are welcome through GitHub issues.
