/** A sum where an unknown amount is counted, not added as 0: the known part is a lower bound. */
export interface KnownSum {
  knownTotal: number;
  unknownCount: number;
}
