import { useEffect, useState } from "react";
import { PRODUCT } from "@galley/core/brand";
import { useMeta } from "@/lib/stores/meta";
import { Button, Dialog, Field, Input } from "@/ui";
import { addCommand } from "./words";

/**
 * Adding a plugin is a command on purpose: the server has no install route,
 * because installing downloads a package from npm and runs it with the
 * app's access. Shown in a clean dialog (and exported for standalone use).
 */
export function AddPlugin({ initialName = "" }: { initialName?: string }) {
  const hosted = useMeta((s) => s.meta?.mode === "hosted");
  const [name, setName] = useState(initialName);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setName(initialName);
    setCopied(false);
  }, [initialName]);

  const command = addCommand(PRODUCT.slug, name.trim() || "<name>");

  return (
    <div className="plg-add__form">
      <Field label="Package name or folder" hint="From npm, a local folder, or a .tgz file. Leave empty to copy the command template.">
        <Input
          data-autofocus
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
          ? "Then restart the server: a plugin added with the command shows up here after a restart."
          : "Then restart the app: a plugin added with the command shows up here after a restart. This window stays signed in."}
      </p>
      <span className="g-sr" role="status">
        {copied ? "Command copied" : ""}
      </span>
    </div>
  );
}

export interface AddPluginDialogProps {
  open: boolean;
  initialName?: string;
  onClose: () => void;
}

export function AddPluginDialog({ open, initialName = "", onClose }: AddPluginDialogProps) {
  const hosted = useMeta((s) => s.meta?.mode === "hosted");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      title="Install a plugin"
      description={`Plugins are added with a command ${hosted ? "on the server" : "in your terminal"} so installing executable code is always an intentional step.`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="plg-add-dialog">
        <AddPlugin initialName={initialName} />
        <TrustNote />
      </div>
    </Dialog>
  );
}

/** What a plugin is allowed to be, said calmly inside a compact disclosure or modal. */
export function TrustNote({ compact = false }: { compact?: boolean }) {
  const hosted = useMeta((s) => s.meta?.mode === "hosted");
  const body = (
    <div className="plg-trust__body">
      <p>
        <strong>A plugin is code that runs inside this app</strong> with the same access the app has {hosted ? "on this server" : "on this computer"} — its files and its keys. Add only plugins you trust, as you would any program.
      </p>
      <p>
        Plugins a site names in its settings file load only for that site, and can’t change the image or video generator, which is chosen for the whole app.{" "}
        {hosted
          ? "On this shared server they stay off unless whoever runs it allows them."
          : "On a shared server that people sign in to, they stay off unless whoever runs it allows them."}
      </p>
    </div>
  );

  if (compact) {
    return (
      <details className="plg-trust-disclosure">
        <summary>About plugin permissions and security</summary>
        {body}
      </details>
    );
  }
  return (
    <aside className="plg-trust" aria-label="About plugins">
      {body}
    </aside>
  );
}
