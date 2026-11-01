import { useState, type ReactNode } from 'react';
import { FileCode2, SendHorizontal } from 'lucide-react';
import {
  DEFAULT_REQUEST,
  REQUEST_IMAGES,
  REQUEST_RESOURCES,
  isNameTaken,
  podNameError,
  type RequestImage,
} from '../../learning/sandbox';
import { cpuQuantity, memoryQuantity } from '../../domain/manifest';
import { useLearningStore } from '../../learning/useLearningStore';
import type { LessonSession } from '../../learning/types';

/** Lesson 3's Pod definition: two meaningful edits, then a simulated `kubectl apply`. */
export function PodRequestEditor({ session }: { session: LessonSession }) {
  const rejected = session.world.request?.stage === 'rejected' ? session.world.request : null;
  // Re-seed the form from a rejected request, so the learner fixes it rather than starting over.
  return <Editor key={rejected ? `rejected:${rejected.name}` : 'new'} session={session} rejected={rejected} />;
}

function Editor({
  session,
  rejected,
}: {
  session: LessonSession;
  rejected: { name: string; image: RequestImage } | null;
}) {
  const dispatch = useLearningStore((s) => s.dispatch);
  const [name, setName] = useState<string>(rejected?.name ?? DEFAULT_REQUEST.name);
  const [image, setImage] = useState<RequestImage>(rejected?.image ?? DEFAULT_REQUEST.image);
  const taken = isNameTaken(session.world, name);
  const unchangedRejected = rejected !== null && rejected.name === name;

  const apply = () => {
    if (taken) return;
    dispatch({ type: 'POD_REQUEST_SUBMITTED', podName: name, image });
  };

  return (
    <section
      aria-label="Pod definition"
      className="pointer-events-auto glass kv-card-in w-[min(340px,calc(100vw-1.5rem))] rounded-2xl p-3"
    >
      <header className="mb-2 flex items-center gap-2">
        <FileCode2 className="size-4 text-teal" />
        <span className="font-mono text-[12px] text-white">my-pod.yaml</span>
        <span className="ml-auto text-[10.5px] text-lavender/60">a request, not a container</span>
      </header>

      <div className="rounded-xl bg-black/30 p-2.5 font-mono text-[11px] leading-[1.7] text-white/90">
        <Row k="apiVersion" v="v1" note="API version" />
        <Row k="kind" v="Pod" note="type of object" />
        <Row k="metadata" />
        <Row indent={1} k="name">
          <input
            aria-label="Pod name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            spellCheck={false}
            className="w-[150px] rounded-md border border-teal/40 bg-teal/[0.08] px-1.5 py-0 font-mono text-[11px] text-white outline-none focus:border-teal"
          />
        </Row>
        <Row indent={1} k="namespace" v="default" />
        <Row k="spec" note="what you want" />
        <Row indent={1} k="containers" />
        <Row indent={1} dash k="name" v="web" />
        <Row indent={2} k="image">
          <span role="radiogroup" aria-label="Container image" className="inline-flex gap-1">
            {REQUEST_IMAGES.map((img) => (
              <button
                key={img}
                type="button"
                role="radio"
                aria-checked={image === img}
                onClick={() => setImage(img)}
                className={`rounded-md border px-1.5 font-mono text-[11px] transition ${
                  image === img ? 'border-teal/60 bg-teal/[0.14] text-white' : 'border-white/10 text-lavender/60 hover:text-white'
                }`}
              >
                {img}
              </button>
            ))}
          </span>
        </Row>
        <Row indent={2} k="resources" />
        <Row indent={3} k="requests" note="room it needs" />
        <Row indent={4} k="cpu" v={`"${cpuQuantity(REQUEST_RESOURCES.cpuMillis)}"`} />
        <Row indent={4} k="memory" v={memoryQuantity(REQUEST_RESOURCES.memoryMiB)} />
      </div>

      {taken && (
        <p className="mt-2 text-[11.5px] text-[#ff9b9b]">A Pod named “{name}” already exists in this cluster. Pick another name.</p>
      )}
      {rejected && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-[#ff9b9b]">
          The API server rejected “{rejected.name}”: {podNameError(rejected.name)}
          {unchangedRejected && ' — edit the name, then apply again.'}
        </p>
      )}

      <button
        type="button"
        className="primary-btn mt-2.5 w-full justify-center font-mono !text-[12px]"
        onClick={apply}
        disabled={taken}
      >
        <SendHorizontal className="size-3.5" />$ kubectl apply -f my-pod.yaml
      </button>
    </section>
  );
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
      {v !== undefined && <span className={v.startsWith('"') ? 'text-[#f6d38a]' : 'text-white/90'}> {v}</span>}
      {children && <span className="ml-1">{children}</span>}
      {note && <span className="ml-auto pl-2 text-[10px] text-lavender/45"># {note}</span>}
    </div>
  );
}
