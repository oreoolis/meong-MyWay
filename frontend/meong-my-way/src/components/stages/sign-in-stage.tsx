import { SignIn2 } from "@/components/ui/clean-minimal-sign-in";

export function SignInStage({
  onSignIn,
  onBack,
}: {
  onSignIn: (email: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="mw-fade relative">
      <button
        type="button"
        onClick={onBack}
        className="absolute left-5 top-5 z-10 text-[13px] font-medium text-gray-500 hover:text-gray-900"
      >
        ← Back to home
      </button>
      <SignIn2 onSignIn={onSignIn} />
    </div>
  );
}
