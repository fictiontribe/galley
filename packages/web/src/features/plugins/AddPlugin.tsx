import { useState } from "react";
import { PRODUCT } from "@galley/core/brand";
import { useMeta } from "@/lib/stores/meta";
import { Button, Field, Input } from "@/ui";
import { addCommand } from "./words";

/**
 * Adding a plugin is a command on purpose: the server has no install route,
 * because installing downloads a package from npm and runs it with the
 * app's access. The command is shown exactly, ready to copy.
 */
export function AddPlugin() {
  const hosted = useMeta((s) => s.meta?.mode === "hosted");
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);
  const command = addCommand(PRODUCT.slug, name.trim() || "<name>");

  return (
    <section className="plg-add" aria-labelledby="plg-add-title">
      <div className="plg-add__text">
        <h2 className="plg-add__title" id="plg-add-title">
          Add a plugin
        </h2>
        <p className="plg-add__lede">
          Plugins are added with a command {hosted ? "on the server" : "in a terminal on this computer"}, not from here: adding one downloads a package and lets it run with the app’s access, so it’s a step taken on purpose.
        </p>
      </div>
      <div className="plg-add__form">
        <Field label="Package name or folder" hint="From npm, a folder, or a .tgz file. Leave it empty to copy the command as it is.">
          <Input
            mono
            spellCheck={false}
            value={name}
            placeholder="galley-plugin-example"
            onChange={(event) => {
              setName(event.target.value);
              setCopied(false);
            }}
          />
        </Field>
        <div className="plg-command">
          <code className="plg-command__text" aria-label="Command">
            <span className="plg-command__prompt" aria-hidden="true">
              $
            </span>{" "}
            {command}
          </code>
          <Button
            size="sm"
            variant="secondary"
            icon="copy"
            onClick={() => {
              void navigator.clipboard?.writeText(command).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="g-hint plg-add__after">
          {hosted
            ? "Then restart the server: a plugin added with the command shows up here only after a restart."
            : "Then restart the app: a plugin added with the command shows up here only after a restart. This window stays signed in."}
        </p>
        <span className="g-sr" role="status">
          {copied ? "Command copied" : ""}
        </span>
      </div>
    </section>
  );
}

/** What a plugin is allowed to be, said once and calmly; the hosted rules in plain words. */
export function TrustNote() {
  const hosted = useMeta((s) => s.meta?.mode === "hosted");
  return (
    <aside className="plg-trust" aria-label="About plugins">
      <p>
        <strong>A plugin is code that runs inside this app</strong> with the same access the app has {hosted ? "on this server" : "on this computer"} — its files and its keys. Add only plugins you trust, as you would any program.
      </p>
      <p>
        Plugins a site names in its settings file load only for that site, and can’t change the image or video generator, which is chosen for the whole app.{" "}
        {hosted
          ? "On this shared server they stay off unless whoever runs it allows them, because anyone who can open a site here would otherwise run that site’s code on the server."
          : "On a shared server that people sign in to, they stay off unless whoever runs it allows them."}
      </p>
    </aside>
  );
}
