import type React from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export function Button(props: ButtonProps): React.JSX.Element {
  const { variant = "primary", size = "md", className, ...rest } = props;
  return (
    <button
      {...rest}
      className={[
        "btn",
        `btn-${variant}`,
        `btn-${size}`,
        className ?? "",
      ].join(" ")}
    />
  );
}
