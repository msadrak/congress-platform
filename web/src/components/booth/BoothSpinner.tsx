/** Inline busy indicator for booth workspace buttons; decorative (the button text says what is happening). */
export function BoothSpinner() {
  return <span aria-hidden="true" className="size-4 rounded-full border-2 border-current border-e-transparent animate-spin" />;
}
