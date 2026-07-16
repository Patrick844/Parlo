/** Text logo: "Parlo" in the signature gradient with a playful pop dot. */

export default function Logo({ size = "text-2xl" }: { size?: string }) {
  return (
    <span className={`font-bold tracking-tight ${size}`}>
      <span className="gradient-text">Parlo</span>
      <span className="text-coral">.</span>
    </span>
  );
}
