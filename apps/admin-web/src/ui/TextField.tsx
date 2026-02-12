import type React from "react";

type TextFieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  right?: React.ReactNode;
};

export function TextField(props: TextFieldProps): React.JSX.Element {
  const { label, hint, right, className, ...rest } = props;
  return (
    <label className={["field", className ?? ""].join(" ")}>
      <div className="fieldLabel">{label}</div>
      <div className="fieldRow">
        <input className="fieldInput" {...rest} />
        {right ? <div className="fieldRight">{right}</div> : null}
      </div>
      {hint ? <div className="fieldHint">{hint}</div> : null}
    </label>
  );
}
