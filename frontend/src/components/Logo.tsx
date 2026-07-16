/** Text logo: "Parlo" with the signature mint dot. */

export default function Logo({ size = "text-2xl" }: { size?: string }) {
  return (
    <span className={`font-semibold tracking-tight ${size}`}>
      Parlo<span className="text-mint">.</span>
    </span>
  );
}
