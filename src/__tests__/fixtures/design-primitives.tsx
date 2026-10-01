// Test-only host-module double. No product styling or variant implementation.
import * as React from "react";

export function Button(props: React.ComponentProps<"button">) { return <button {...props} />; }
export function Card(props: React.ComponentProps<"div">) { return <div {...props} />; }
export function CardContent(props: React.ComponentProps<"div">) { return <div {...props} />; }
export function Input(props: React.ComponentProps<"input">) { return <input {...props} />; }
export function Label(props: React.ComponentProps<"label">) { return <label {...props} />; }
