/**
 * Starting points for "New form": small, complete forms that are valid as
 * they are. Every one sends to the inbox until a destination is chosen.
 */
import type { FormDefinition } from "@galley/core/kit";
import { CONTACT_FORM } from "@galley/core/forms/shared";

export interface FormStarter {
  id: string;
  label: string;
  description: string;
  /** A file name to suggest. */
  suggestedId: string;
  form: FormDefinition;
}

const inbox = [{ provider: "galley", settings: {} }];

export const FORM_STARTERS: readonly FormStarter[] = [
  {
    id: "blank",
    label: "Blank",
    description: "An email field and a button. Build the rest.",
    suggestedId: "new-form",
    form: {
      name: "New form",
      fields: [{ id: "email", type: "email", label: "Email", required: true }],
      submitLabel: "Send",
      destinations: inbox,
      afterSubmit: [{ type: "message", title: "Thank you", text: "We’ve got your answers." }],
    },
  },
  {
    id: "contact",
    label: "Contact",
    description: "Name, email and a message.",
    suggestedId: "contact",
    // The same form "Set it up for me" gives a site.
    form: CONTACT_FORM,
  },
  {
    id: "newsletter",
    label: "Newsletter sign-up",
    description: "One email field and a consent box.",
    suggestedId: "newsletter",
    form: {
      name: "Newsletter sign-up",
      fields: [
        { id: "email", type: "email", label: "Email", required: true, placeholder: "you@example.com" },
        { id: "consent", type: "consent", label: "Consent", required: true, text: "Send me the newsletter. I can unsubscribe at any time." },
      ],
      submitLabel: "Sign up",
      destinations: inbox,
      afterSubmit: [{ type: "message", text: "You’re on the list. Look out for the first issue." }],
    },
  },
  {
    id: "demo",
    label: "Demo request",
    description: "Work email, company and size, with campaign tracking.",
    suggestedId: "demo-request",
    form: {
      name: "Demo request",
      fields: [
        { id: "first_name", type: "text", label: "First name", required: true, width: "half" },
        { id: "last_name", type: "text", label: "Last name", required: true, width: "half" },
        { id: "email", type: "email", label: "Work email", required: true, validation: { businessEmailOnly: true } },
        { id: "company", type: "text", label: "Company", required: true, width: "half" },
        {
          id: "company_size",
          type: "select",
          label: "Company size",
          width: "half",
          options: [
            { value: "1-10", label: "1–10" },
            { value: "11-50", label: "11–50" },
            { value: "51-200", label: "51–200" },
            { value: "201-1000", label: "201–1,000" },
            { value: "1000+", label: "More than 1,000" },
          ],
        },
        { id: "utm_source", type: "hidden", label: "UTM source", autofill: { from: "utm", key: "utm_source" } },
        { id: "utm_campaign", type: "hidden", label: "UTM campaign", autofill: { from: "utm", key: "utm_campaign" } },
      ],
      submitLabel: "Request a demo",
      destinations: inbox,
      afterSubmit: [
        { type: "message", title: "Thank you", text: "We’ll be in touch within one working day to find a time." },
        { type: "event", name: "demo_request", target: "dataLayer" },
      ],
    },
  },
  {
    id: "event",
    label: "Event registration",
    description: "Name, email, which session, and dietary needs.",
    suggestedId: "event-registration",
    form: {
      name: "Event registration",
      fields: [
        { id: "name", type: "text", label: "Name", required: true },
        { id: "email", type: "email", label: "Email", required: true },
        {
          id: "session",
          type: "radio",
          label: "Which session?",
          required: true,
          options: [
            { value: "morning", label: "Morning" },
            { value: "afternoon", label: "Afternoon" },
          ],
        },
        { id: "dietary", type: "textarea", label: "Dietary needs", help: "Leave empty if there are none." },
      ],
      submitLabel: "Register",
      destinations: inbox,
      afterSubmit: [{ type: "message", title: "You’re registered", text: "A confirmation is on its way to {{email}}." }],
    },
  },
  {
    id: "download",
    label: "Gated download",
    description: "A short form that unlocks a file.",
    suggestedId: "download",
    form: {
      name: "Gated download",
      fields: [
        { id: "name", type: "text", label: "Name", required: true },
        { id: "email", type: "email", label: "Work email", required: true },
        { id: "company", type: "text", label: "Company" },
      ],
      submitLabel: "Get the download",
      destinations: inbox,
      afterSubmit: [
        { type: "message", title: "Here it is", text: "Thanks, {{name}}. Your download is ready." },
        { type: "download", url: "", label: "Download the guide" },
      ],
    },
  },
];
