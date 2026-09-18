import type { ReactNode } from "react";
export function MetricExplanation({title="איך חושב המספר?",children}:{title?:string;children:ReactNode}) {
 return <details className="metric-explanation"><summary>{title}</summary><div>{children}</div></details>;
}
