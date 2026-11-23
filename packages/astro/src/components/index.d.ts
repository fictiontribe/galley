import type { FormDefinition } from "../kit";

type AstroComponent<P> = (props: P) => any;

export interface FormProps {
  /** The form's id: its file name in the forms collection. */
  id?: string;
  /** A definition to render instead of looking one up. */
  definition?: FormDefinition;
  collection?: string;
  endpoint?: string;
  class?: string;
  submitClass?: string;
  backClass?: string;
  headingLevel?: number;
  unstyled?: boolean;
}

export declare const Form: AstroComponent<FormProps>;
export declare const Scripts: AstroComponent<{ placement?: "head" | "body-start" | "body-end" }>;
export declare const ConsentBanner: AstroComponent<Record<string, never>>;
