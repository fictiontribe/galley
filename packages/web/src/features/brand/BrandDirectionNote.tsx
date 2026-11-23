import { ProofMark } from "@/ui";

/** One quiet line under a generate form: what of the brand rides along with the description. */
export function BrandDirectionNote({ direction }: { direction: string | null }) {
  if (!direction) return null;
  const short = direction.length > 140 ? `${direction.slice(0, 139).trimEnd()}…` : direction;
  return (
    <p className="g-margin-note" title={direction}>
      <ProofMark kind="reg" />
      <span>{`Made to the site’s brand: “${short}”`}</span>
    </p>
  );
}
