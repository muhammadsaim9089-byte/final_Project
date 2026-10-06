import { EdgeProps } from "@xyflow/react";
import { RelationEdge } from "./RelationEdge";

/** Curved, dashed relationship with a travelling pulse — same cardinality markers as the crow's-foot style. */
export function PulseEdge(props: EdgeProps) {
  return <RelationEdge {...props} variant="bezier" />;
}
