// Species registry (TreeSpec/v1): a species is a SPEC, not a fork -- the same
// generator grows any TreeSpec. `spec` is the shipped default; clone before
// mutating (the demo does). This public cut ships the banyan, the reference
// tree. Further species specs exist and will ship when they grow to standard.
import banyan from './spec/banyan.treespec.json' with { type: 'json' };

export const SPECIES = {
  'banyan': { name: 'Banyan', spec: banyan },
};
