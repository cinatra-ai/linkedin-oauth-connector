// Test-only host-module double. No product styling or variant implementation.
// Checkbox wraps the same Radix primitive as the host Checkbox, so its checked
// state, its form value and its reaction to a form reset are the host's.
import * as React from "react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";

export function Button(props: React.ComponentProps<"button">) { return <button {...props} />; }
export function Card(props: React.ComponentProps<"div">) { return <div {...props} />; }
export function CardContent(props: React.ComponentProps<"div">) { return <div {...props} />; }
export function Checkbox(props: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root {...props}>
      <CheckboxPrimitive.Indicator />
    </CheckboxPrimitive.Root>
  );
}
export function Input(props: React.ComponentProps<"input">) { return <input {...props} />; }
export function Label(props: React.ComponentProps<"label">) { return <label {...props} />; }
