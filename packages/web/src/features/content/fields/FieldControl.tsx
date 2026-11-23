import { memo } from "react";
import type { Field } from "@galley/core/types";
import { pathKey } from "../form/paths";
import { BlocksField } from "./BlocksField";
import { BooleanField, ColorField, DateField, SelectField } from "./ChoiceFields";
import type { FieldProps } from "./common";
import { DataSourceField } from "./DataSourceField";
import { ImageField } from "./ImageField";
import { JsonField } from "./JsonField";
import { ListField } from "./ListField";
import { MarkdownField } from "./MarkdownField";
import { ObjectField } from "./ObjectField";
import { ReferenceField } from "./ReferenceField";
import { TagsField } from "./TagsField";
import { NumberField, StringField, TextField } from "./TextFields";
import { UrlField } from "./UrlField";

export interface FieldControlProps extends FieldProps {
  /** For image fields: the sibling alt-text field shown under the image. */
  altField?: Field;
}

function Control({ field, path, showKey, altField }: FieldControlProps) {
  const props = { field, path, showKey };
  // A value picked from a plugin's source (a product, a collection) is a plain string in the file; lists pick per item (ListField).
  if (field.dataSource && (field.type === "string" || field.type === "text" || field.type === "select")) return <DataSourceField {...props} />;
  switch (field.type) {
    case "string":
      return <StringField {...props} />;
    case "text":
      return <TextField {...props} />;
    case "markdown":
      return <MarkdownField {...props} />;
    case "number":
      return <NumberField {...props} />;
    case "boolean":
      return <BooleanField {...props} />;
    case "date":
    case "datetime":
      return <DateField {...props} />;
    case "image":
      return <ImageField {...props} altField={altField} />;
    case "url":
      return <UrlField {...props} />;
    case "color":
      return <ColorField {...props} />;
    case "select":
      return field.options && field.options.length > 0 ? <SelectField {...props} /> : <StringField {...props} />;
    case "tags":
      return <TagsField {...props} />;
    case "list":
      return <ListField {...props} />;
    case "object":
      return <ObjectField {...props} />;
    case "blocks":
      return <BlocksField {...props} />;
    case "reference":
      return field.collection ? <ReferenceField {...props} /> : <StringField {...props} />;
    case "json":
      return <JsonField {...props} />;
  }
}

/** The right control for a field's type. Re-renders only when its own path or definition changes. */
export const FieldControl = memo(
  Control,
  (a, b) => a.field === b.field && a.altField === b.altField && a.showKey === b.showKey && pathKey(a.path) === pathKey(b.path),
);
