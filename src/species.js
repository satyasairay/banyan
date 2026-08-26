// Species registry (TreeSpec/v1, audit Task 2): each species is a SPEC, not a
// fork -- the same generator grows all of them. `spec` objects are the shipped
// defaults; clone before mutating (the demo does).
// Dead Winter Oak ships FREE per the roadmap (re-engagement hook).
import banyan from './spec/banyan.treespec.json' with { type: 'json' };
import deadWinterOak from './spec/dead-winter-oak.treespec.json' with { type: 'json' };
import englishOak from './spec/english-oak.treespec.json' with { type: 'json' };
import cherryBlossom from './spec/cherry-blossom.treespec.json' with { type: 'json' };
import baobab from './spec/baobab.treespec.json' with { type: 'json' };
import blackPine from './spec/black-pine.treespec.json' with { type: 'json' };
import weepingWillow from './spec/weeping-willow.treespec.json' with { type: 'json' };

export const SPECIES = {
  'banyan':           { name: 'Banyan',                 spec: banyan,        tier: 'core' },
  'dead-winter-oak':  { name: 'Dead Winter Oak',        spec: deadWinterOak, tier: 'free' },
  'english-oak':      { name: 'English Oak',            spec: englishOak,    tier: 'dlc'  },
  'cherry-blossom':   { name: 'Cherry Blossom',         spec: cherryBlossom, tier: 'dlc'  },
  'baobab':           { name: 'Baobab',                 spec: baobab,        tier: 'dlc'  },
  'black-pine':       { name: 'Japanese Black Pine',    spec: blackPine,     tier: 'dlc'  },
  'weeping-willow':   { name: 'Weeping Willow',         spec: weepingWillow, tier: 'dlc'  },
};
