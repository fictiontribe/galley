/**
 * Step 2 — what will come across: the counts, where each kind lands on this
 * site, the page-builder pages called out, the few questions that need a
 * person (each already answered with its sensible default), and what stays
 * behind and why. Nothing is written yet.
 */
import type { ImportPlanView } from "@galley/core/types";
import { count, joinWords } from "@/lib/format";
import { Badge, Icon, cx } from "@/ui";

interface PlanStepProps {
  plan: ImportPlanView;
  answers: Record<string, string>;
  onAnswer: (id: string, value: string) => void;
  busy: boolean;
}

function Tally({ plan }: { plan: ImportPlanView }) {
  const items = [
    { value: plan.counts.posts, label: plan.counts.posts === 1 ? "post" : "posts" },
    { value: plan.counts.pages, label: plan.counts.pages === 1 ? "page" : "pages" },
    { value: plan.counts.images, label: plan.counts.images === 1 ? "image" : "images" },
    { value: plan.counts.authors, label: plan.counts.authors === 1 ? "author" : "authors" },
    { value: plan.counts.categories, label: plan.counts.categories === 1 ? "category" : "categories" },
    { value: plan.counts.tags, label: plan.counts.tags === 1 ? "tag" : "tags" },
  ];
  return (
    <ul className="imp-tally" aria-label="What will come across">
      {items.map((item) => (
        <li key={item.label} className="imp-tally__item">
          <span className="imp-tally__value">{item.value.toLocaleString()}</span>
          <span className="imp-tally__label">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function PlanStep({ plan, answers, onAnswer, busy }: PlanStepProps) {
  const skippedByReason = new Map<string, string[]>();
  for (const item of plan.skipped) skippedByReason.set(item.reason, [...(skippedByReason.get(item.reason) ?? []), item.title]);
  return (
    <div className={cx("imp-plan", busy && "imp-plan--busy")} aria-busy={busy}>
      <Tally plan={plan} />

      <section className="imp-block" aria-labelledby="imp-where">
        <h2 className="imp-block__title" id="imp-where">
          Where it goes
        </h2>
        <ul className="imp-routes">
          {plan.destinations.map((destination) => (
            <li key={destination.kind} className="imp-route">
              <span className="imp-route__from">{`${destination.count.toLocaleString()} WordPress ${destination.kind}`}</span>
              <Icon name="chevron-right" className="imp-route__arrow" />
              <span className="imp-route__to">
                <strong>{destination.label}</strong>
                <span className="g-mono imp-route__key">{destination.collection}</span>
              </span>
              <details className="app-details imp-route__fields">
                <summary>How the details match</summary>
                <dl className="imp-pairs">
                  {destination.fields.map((field) => (
                    <div key={field.label} className="imp-pairs__row">
                      <dt>{field.label}</dt>
                      <dd>{`from ${field.from}`}</dd>
                    </div>
                  ))}
                </dl>
                {destination.unmapped.length ? <p className="g-hint">{`This site has nowhere to keep ${joinWords(destination.unmapped)}.`}</p> : null}
              </details>
            </li>
          ))}
        </ul>
      </section>

      {plan.builders.map((builder) => (
        <section key={builder.name} className="imp-callout" aria-label={`Pages made with ${builder.name}`}>
          <p className="imp-callout__title">{`${count(builder.count, "page was", "pages were")} built with ${builder.name}`}</p>
          <p className="imp-callout__body">Their words and images come across; their layouts are rebuilt from this site’s own sections, one page at a time with the assistant, after the import.</p>
          <ul className="imp-chips">
            {builder.titles.map((title) => (
              <li key={title} className="g-tag">
                {title}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {plan.questions.length ? (
        <section className="imp-block" aria-labelledby="imp-questions">
          <h2 className="imp-block__title" id="imp-questions">
            {plan.questions.length === 1 ? "One thing to decide" : `${plan.questions.length} things to decide`}
          </h2>
          {plan.questions.map((question) => {
            const value = answers[question.id] ?? question.answer;
            return (
              <fieldset key={question.id} className="imp-question">
                <legend className="imp-question__text">{question.question}</legend>
                <div className="imp-question__options">
                  {question.options.map((option) => (
                    <label key={option.value} className={cx("imp-option", value === option.value && "imp-option--on")}>
                      <input type="radio" name={question.id} value={option.value} checked={value === option.value} onChange={() => onAnswer(question.id, option.value)} />
                      <span>{option.label.replace(/ \(src\/.*\)$/, "")}</span>
                      {option.value === question.default ? <Badge tone="accent" mark={null}>Suggested</Badge> : null}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </section>
      ) : null}

      <section className="imp-block" aria-labelledby="imp-search">
        <h2 className="imp-block__title" id="imp-search">
          Search rankings
        </h2>
        <ul className="imp-ticks">
          {plan.seo.descriptions ? <li>{`${count(plan.seo.descriptions, "search description")} from the SEO plugin come across.`}</li> : null}
          {plan.seo.titles ? <li>{`${count(plan.seo.titles, "SEO title")} kept.`}</li> : null}
          {plan.seo.canonicals ? <li>{`${count(plan.seo.canonicals, "canonical address", "canonical addresses")} kept.`}</li> : null}
          <li>{plan.redirects ? `${count(plan.redirects, "old address", "old addresses")} will redirect to the new ones — you review them after the import.` : "Every address stays the same, so nothing needs redirecting."}</li>
        </ul>
      </section>

      <section className="imp-block" aria-labelledby="imp-behind">
        <h2 className="imp-block__title" id="imp-behind">
          What stays behind
        </h2>
        <dl className="imp-pairs imp-pairs--wide">
          {plan.notComing.map((entry) => (
            <div key={entry.what} className="imp-pairs__row">
              <dt>{entry.what}</dt>
              <dd>{entry.why}</dd>
            </div>
          ))}
          {plan.features.map((feature) => (
            <div key={feature.title} className="imp-pairs__row">
              <dt>{feature.title}</dt>
              <dd>{feature.advice}</dd>
            </div>
          ))}
        </dl>
        {plan.skipped.length ? (
          <details className="app-details">
            <summary>{`${count(plan.skipped.length, "item")} won’t be brought over, and why`}</summary>
            <ul className="imp-reasons">
              {[...skippedByReason.entries()].map(([reason, titles]) => (
                <li key={reason}>
                  <strong>{joinWords(titles.slice(0, 4))}{titles.length > 4 ? ` and ${titles.length - 4} more` : ""}</strong> — {reason}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {plan.notes.length ? (
        <ul className="imp-notes">
          {plan.notes.map((note) => (
            <li key={note}>
              <Icon name="warning" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
