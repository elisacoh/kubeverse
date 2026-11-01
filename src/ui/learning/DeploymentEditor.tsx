import { useState, type ReactNode } from 'react';
import { FileCode2, SendHorizontal } from 'lucide-react';
import { DEPLOYMENT_DEFAULTS, deploymentNameError } from '../../learning/sandbox';
import { WEB_POD_REQUESTS } from '../../simulation/controllers';
import { cpuQuantity, memoryQuantity } from '../../domain/manifest';
import { useLearningStore } from '../../learning/useLearningStore';

/**
 * Lesson 4's Deployment definition. The name is the one edit; the selector
 * and the template's labels follow it, since they must match.
 */
export function DeploymentEditor() {
  const dispatch = useLearningStore((s) => s.dispatch);
  const [name, setName] = useState<string>(DEPLOYMENT_DEFAULTS.name);
  const error = deploymentNameError(name);
  const label = name || '…';

  const apply = () => {
    if (error) return;
    dispatch({ type: 'DEPLOYMENT_CREATED', name, replicas: DEPLOYMENT_DEFAULTS.replicas, image: DEPLOYMENT_DEFAULTS.image });
  };

  return (
    <section
      aria-label="Deployment definition"
      className="pointer-events-auto glass kv-card-in w-[min(360px,calc(100vw-1.5rem))] rounded-2xl p-3"
    >
      <header className="mb-2 flex items-center gap-2">
        <FileCode2 className="size-4 text-teal" />
        <span className="font-mono text-[12px] text-white">{label}-deployment.yaml</span>
        <span className="ml-auto text-[10.5px] text-lavender/60">what you want, not how</span>
      </header>

      <div className="rounded-xl bg-black/30 p-2.5 font-mono text-[11px] leading-[1.55] text-white/90">
        <Row k="apiVersion" v="apps/v1" />
        <Row k="kind" v="Deployment" />
        <Row k="metadata" />
        <Row indent={1} k="name">
          <input
            aria-label="Deployment name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            spellCheck={false}
            className="w-[130px] rounded-md border border-teal/40 bg-teal/[0.08] px-1.5 py-0 font-mono text-[11px] text-white outline-none focus:border-teal"
          />
        </Row>
        <Row k="spec" note="desired state" />
        <Row indent={1} k="replicas" v={String(DEPLOYMENT_DEFAULTS.replicas)} note="how many, always" />
        <Row indent={1} k="selector" note="which Pods are mine" />
        <Row indent={2} k="matchLabels">
          <Synced text={`{app: ${label}}`} />
        </Row>
        <Row indent={1} k="template" note="each Pod’s blueprint" />
        <Row indent={2} k="metadata" />
        <Row indent={3} k="labels">
          <Synced text={`{app: ${label}}`} />
        </Row>
        <Row indent={2} k="spec" />
        <Row indent={3} k="containers" />
        <Row indent={3} dash k="name" v="web" />
        <Row indent={4} k="image" v={DEPLOYMENT_DEFAULTS.image} />
        <Row
          indent={4}
          k="resources"
          v={`{requests: {cpu: "${cpuQuantity(WEB_POD_REQUESTS.cpuMillis)}", memory: ${memoryQuantity(WEB_POD_REQUESTS.memoryMiB)}}}`}
        />
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-lavender/65">
        The selector and the template’s labels must match: that is how the Deployment recognises its Pods.
      </p>
      {error && <p className="mt-1.5 text-[11.5px] text-[#ff9b9b]">{error}</p>}

      <button
        type="button"
        className="primary-btn mt-2.5 w-full justify-center font-mono !text-[12px]"
        onClick={apply}
        disabled={error !== null}
      >
        <SendHorizontal className="size-3.5" />$ kubectl apply -f {label}-deployment.yaml
      </button>
    </section>
  );
}

/** A value that follows the name field. */
function Synced({ text }: { text: string }) {
  return <span className="rounded bg-teal/[0.12] px-0.5 text-white">{text}</span>;
}

function Row({
  k,
  v,
  note,
  indent = 0,
  dash,
  children,
}: {
  k: string;
  v?: string;
  note?: string;
  indent?: number;
  dash?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center whitespace-pre">
      <span>{'  '.repeat(indent)}</span>
      {dash && <span className="text-lavender/50">- </span>}
      <span className="text-teal">{k}</span>
      <span className="text-lavender/50">:</span>
      {v !== undefined && <span className="text-white/90"> {v}</span>}
      {children && <span className="ml-1">{children}</span>}
      {note && <span className="ml-auto pl-2 text-[10px] text-lavender/45"># {note}</span>}
    </div>
  );
}
