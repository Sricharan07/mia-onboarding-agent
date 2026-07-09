import type { ComponentProps, ReactNode } from "react";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function Card({ className, size = "default", ...props }: ComponentProps<"section"> & { size?: "default" | "sm" }) {
  return <section data-slot="card" data-size={size} className={cx("card", className)} {...props} />;
}

function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-header" className={cx("card-header", className)} {...props} />;
}

function CardTitle({ className, ...props }: ComponentProps<"h3">) {
  return <h3 data-slot="card-title" className={cx("card-title", className)} {...props} />;
}

function CardDescription({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-description" className={cx("card-description", className)} {...props} />;
}

function CardAction({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-action" className={cx("card-action", className)} {...props} />;
}

function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-content" className={cx("card-content", className)} {...props} />;
}

function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cx("card-footer", className)} {...props} />;
}

function Badge({
  className,
  tone = "default",
  children,
  ...props
}: ComponentProps<"span"> & { tone?: "default" | "green" | "yellow" | "red" | "gray"; children: ReactNode }) {
  return (
    <span data-slot="badge" data-tone={tone} className={cx("badge", className)} {...props}>
      {children}
    </span>
  );
}

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ComponentProps<"button"> & { variant?: "default" | "outline" | "ghost"; size?: "default" | "sm" | "icon" }) {
  return <button data-slot="button" data-variant={variant} data-size={size} className={cx("button", className)} {...props} />;
}

export { Badge, Button, Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
