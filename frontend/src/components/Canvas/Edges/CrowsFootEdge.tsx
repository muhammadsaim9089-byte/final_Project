import { EdgeProps } from "@xyflow/react";
import { RelationEdge } from "./RelationEdge";

/** Orthogonal ("smooth step") relationship with crow's-foot cardinality markers. */
export function CrowsFootEdge(props: EdgeProps) {
  return <RelationEdge {...props} variant="step" />;
}
