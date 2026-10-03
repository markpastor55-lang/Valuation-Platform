import { Fragment, type JSX } from 'preact';
import { signatureHash, type RenderBlock, type ValuerProfile } from '@vp/domain';
import { SignatureView } from './profile.js';
import type { Derived } from '../model.js';
import { Pill, shortHash } from '../ui.js';

function Block(props: { b: RenderBlock; profile: ValuerProfile }): JSX.Element | null {
  const { b } = props;
  switch (b.kind) {
    case 'heading':
      return b.level === 1 ? <h2>{b.text}</h2> : <h3>{b.text}</h3>;
    case 'paragraph':
      return <p class={b.style === 'normal' ? '' : b.style}>{b.text}</p>;
    case 'key_value':
      return (
        <dl class="kv">
          {b.rows.map(([k, v]) => (
            <Fragment key={k}>
              <dt>{k}</dt>
              <dd class={v.startsWith('[') ? 'placeholder' : ''}>{v}</dd>
            </Fragment>
          ))}
        </dl>
      );
    case 'table':
      return (
        <div class="stack">
          {b.title && <h3>{b.title}</h3>}
          <div class="table-scroll">
            <table class="data">
              <thead>
                <tr>
                  {b.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {b.note && <p class="note">{b.note}</p>}
        </div>
      );
    case 'image':
      if (b.ref.type === 'signature')
        return props.profile.signature && signatureHash(props.profile.signature) === b.ref.id ? (
          <div class="report-signature">
            <SignatureView profile={props.profile} />
            <span class="note">{b.caption}</span>
          </div>
        ) : (
          <p class="note">[Signature on file]</p>
        );
      return (
        <p class="note">
          [{b.ref.type}: {b.caption}]
        </p>
      );
    case 'page_break':
      return null;
  }
}

export function ReportScreen(props: { d: Derived; profile: ValuerProfile }): JSX.Element {
  const { d } = props;
  const r = d.report;
  const final = r.meta.status === 'final';
  return (
    <>
      <section class="card">
        <div class="card-head">
          <h2>Report</h2>
          <Pill tone={final ? 'ok' : 'warning'}>{final ? 'Final v1' : 'Draft'}</Pill>
        </div>
        <p class="muted">
          {final
            ? 'Issued from the QA-approved snapshot. The server renders this same report model to a PDF and stores its hash so the file can be re-rendered and checked later.'
            : 'Live draft built from the data you have entered. Only sections and fields this job requires are included. Missing required values show as [Not provided].'}
        </p>
        {r.problems.length > 0 && (
          <ul class="plain">
            {r.problems.map((p) => (
              <li key={p.code + p.message} class="notice blocking">
                <span class="mono">{p.code}</span> {p.message}
              </li>
            ))}
          </ul>
        )}
      </section>
      <article class="paper" aria-label="Report preview">
        <div class="watermark" aria-hidden="true">
          {final ? '' : r.meta.watermark}
        </div>
        <span class="doc-firm">{r.meta.firmName}</span>
        <h1>{r.meta.title}</h1>
        <p class="note">{r.meta.subtitle}</p>
        {final && <p class="note">{r.meta.watermark}</p>}
        {r.sections.map((s) => (
          <section key={s.sectionId} class="stack">
            <h2>{s.title}</h2>
            {s.blocks.map((b, i) => (
              <Block key={i} b={b} profile={props.profile} />
            ))}
          </section>
        ))}
        <div class="footer">
          <span>{r.meta.footer}</span>
          <span class="mono">
            {r.meta.templateId} v{r.meta.templateVersion} · {r.meta.ruleSet}
            {r.meta.snapshotHash ? ` · ${shortHash(r.meta.snapshotHash)}` : ''}
          </span>
        </div>
      </article>
    </>
  );
}
