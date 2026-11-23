import { useState, type DragEvent } from "react";
import type { Field } from "@galley/core/types";
import { errorShape, rawFileUrl } from "@/lib/api";
import { notify } from "@/lib/stores/toasts";
import { Button, Icon, Input, Spinner, cx } from "@/ui";
import { thumbnailSource } from "@/features/media/mediaPaths";
import { mediaFiles, uploadFile } from "@/features/media/useUploads";
import { useForm } from "../form/context";
import { asText, useBinding } from "./binding";
import { type FieldProps } from "./common";
import { FieldShell } from "./FieldShell";
import { StringField } from "./TextFields";

export interface ImageFieldProps extends FieldProps {
  /** The sibling "…Alt" field, edited right under the image. */
  altField?: Field;
}

/** `image`: a thumbnail, Choose / Remove, drop a file to upload it and use it. */
export function ImageField({ field, path, showKey, altField }: ImageFieldProps) {
  const { siteId, media, pickImage } = useForm();
  const { value, change: type, commit, focus } = useBinding(field, path);
  const { change } = useBinding(field, path, true);
  const [over, setOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [broken, setBroken] = useState<string | null>(null);
  const url = asText(value);
  const src = url ? thumbnailSource(url, media, (repoPath) => rawFileUrl(siteId, repoPath)) : null;

  const choose = async () => {
    const picked = await pickImage();
    if (picked) change(picked);
  };

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    const [file] = mediaFiles(event.dataTransfer.files);
    if (!file) return;
    setUploading(true);
    try {
      const item = await uploadFile(siteId, file);
      change(item.url);
      notify({ tone: "success", title: "Image added", body: `“${item.name}” is in media and set as ${field.label.toLowerCase()}.` });
    } catch (error) {
      const shape = errorShape(error);
      notify({ tone: "danger", title: "Couldn’t add that image", body: shape.message, detail: shape.detail });
    } finally {
      setUploading(false);
    }
  };

  const parentPath = path.slice(0, -1);
  return (
    <div className="app-image-group">
      <FieldShell field={field} path={path} showKey={showKey} group>
        <div
          className={cx("app-image", over && "app-image--over")}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => void onDrop(event)}
        >
          <div className="app-image__thumb" aria-hidden={src ? undefined : true}>
            {uploading ? (
              <Spinner label="Uploading" />
            ) : src && broken !== src ? (
              <img src={src} alt="" loading="lazy" onError={() => setBroken(src)} />
            ) : (
              <Icon name="image" size={20} />
            )}
          </div>
          <div className="app-image__side">
            <Input
              size="sm"
              mono
              aria-label={`${field.label} address`}
              value={url}
              placeholder="/images/…"
              onChange={(event) => type(event.target.value)}
              onBlur={commit}
              onFocus={focus}
            />
            <div className="app-image__actions">
              <Button size="sm" variant="secondary" onClick={() => void choose()}>
                {url ? "Change…" : "Choose…"}
              </Button>
              {url ? (
                <Button size="sm" variant="quiet" onClick={() => change(undefined)}>
                  Remove
                </Button>
              ) : null}
              <span className="g-hint app-image__drop">or drop a file here</span>
            </div>
          </div>
        </div>
      </FieldShell>
      {altField ? <StringField field={altField} path={[...parentPath, altField.key]} /> : null}
    </div>
  );
}
