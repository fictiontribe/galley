import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useChatUi } from "@/features/chat/store";
import { notify } from "@/lib/stores/toasts";
import { Button, Dialog, Field, Textarea } from "@/ui";
import { AI_STARTER_IDEAS, PLUGIN_DOCS_URL, buildPluginPrompt } from "./directory";

export interface CreatePluginDialogProps {
  open: boolean;
  /** Optional pre-filled idea (e.g. from a Directory blueprint card). */
  initialIdea?: string;
  /** The site to open in Galley's assistant (current site or most recent site). */
  targetSiteId: string | null;
  onClose: () => void;
}

/**
 * Web 4.0 AI plugin creator: describe what you need in plain words, then hand
 * it directly to Galley's build-mode assistant or copy a ready-to-paste prompt
 * for Claude Code, Cursor, or any MCP agent.
 */
export function CreatePluginDialog({ open, initialIdea = "", targetSiteId, onClose }: CreatePluginDialogProps) {
  const navigate = useNavigate();
  const [idea, setIdea] = useState(initialIdea);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setIdea(initialIdea);
      setCopied(false);
    }
  }, [open, initialIdea]);

  const trimmed = idea.trim();
  const prompt = trimmed ? buildPluginPrompt(trimmed) : "";

  const openInAssistant = () => {
    if (!targetSiteId || !prompt) return;
    useChatUi.getState().offerDraft(targetSiteId, prompt, "build");
    onClose();
    navigate(`/sites/${targetSiteId}/edit`);
  };

  const copyPrompt = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard?.writeText(prompt);
      setCopied(true);
      notify({ tone: "success", title: "Plugin prompt copied", body: "Paste it into Claude Code, Cursor, or any coding agent." });
    } catch {
      notify({ tone: "danger", title: "Couldn’t copy to clipboard" });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Create a plugin with AI"
      description="Every Galley plugin is a single JavaScript file with zero build step. Describe what you want and let AI write and wire it into your site."
      footer={
        <>
          <a className="plg-ai__docs" href={PLUGIN_DOCS_URL} target="_blank" rel="noreferrer">
            Plugin API docs
          </a>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" icon="copy" disabled={!trimmed} onClick={() => void copyPrompt()}>
            {copied ? "Copied prompt" : "Copy agent prompt"}
          </Button>
          {targetSiteId ? (
            <Button variant="primary" icon="chat" disabled={!trimmed} onClick={openInAssistant}>
              Build with Assistant
            </Button>
          ) : null}
        </>
      }
    >
      <div className="plg-ai">
        <Field label="What should this plugin do?" hint="Include any third-party service, trigger (before/after publish, form submission, assistant tool), or settings it needs.">
          <Textarea
            data-autofocus
            rows={4}
            value={idea}
            placeholder="e.g. Post a summary to Slack whenever a page is published, or add a Notion destination for contact forms…"
            onChange={(event) => {
              setIdea(event.target.value);
              setCopied(false);
            }}
          />
        </Field>

        <div className="plg-ai__chips" role="group" aria-label="Starter ideas">
          <span className="g-eyebrow">Quick starters</span>
          <div className="plg-ai__chip-row">
            {AI_STARTER_IDEAS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="plg-chip"
                onClick={() => {
                  setIdea(preset.idea);
                  setCopied(false);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <p className="plg-ai__note g-hint">
          Creates a self-contained <code className="g-mono">./tools/plugin.mjs</code> using <code className="g-mono">apiVersion: 1</code>, stores keys as secret settings, and registers it in <code className="g-mono">galley.config.json</code>.
        </p>
      </div>
    </Dialog>
  );
}
