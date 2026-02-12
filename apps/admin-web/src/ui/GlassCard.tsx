import type React from "react";

type GlassCardProps = {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

export function GlassCard(props: GlassCardProps): React.JSX.Element {
  return (
    <section className={["glass", "cardShell", props.className ?? ""].join(" ")}>
      {props.title ? (
        <header className="cardHeader">
          <div>
            <div className="cardTitle">{props.title}</div>
            {props.subtitle ? <div className="cardSubtitle">{props.subtitle}</div> : null}
          </div>
          {props.right ? <div className="cardRight">{props.right}</div> : null}
        </header>
      ) : null}
      <div className="cardBody">{props.children}</div>
    </section>
  );
}

