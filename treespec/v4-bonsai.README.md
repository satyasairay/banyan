# treespec/v4-bonsai — archived bonsai-proportion spec family

**Archived:** 2026-07-11, start of Phase 0 "Stature & art direction" (master plan §2.2 / §10 / §14).
**Source:** `banyan-bonsai_v4.html` at git `d655c1e` ("production visual-audit remediation pass"),
working tree verified identical to HEAD before archiving.
sha256 `561ea74824bd6f0a3312b83eba72f9bd4061edaaeaad784e3c13e29a576ebc35` (159,936 bytes, CRLF).
**Files:** `v4-bonsai.species.js` = the SPECIES const, lines 124–322, copied byte-verbatim.

**Why archived:** §2.2 Stature (2026-07-11) approves a deliberate re-baseline to forest-scale
proportions. The re-baseline law requires the superseded spec family to be archived verbatim
before any edit. Mental model: *bonsai is a ratio, not a size — scaling ×2 makes a big bonsai;
the fix is height÷girth, branch-height÷eye, leaf÷tree ratios.*

## Before-metrics (verify:v4 run 2026-07-11, mobile preset, sprig mul 0.5, hero seeds)

| species | seed | branches | anchors | woodTri | sprigs | blossom | fruit | height | reach |
|---|---|---|---|---|---|---|---|---|---|
| banyan | 1892 | 361 | 4999 | 40996 | 425 | 0 | 120 | 2.8u | 2.2u |
| strangler-fig | 4242 | 408 | 4868 | 50122 | 350 | 0 | 85 | 3.2u | 2.0u |
| rubber-fig | 1892 | 172 | 1981 | 20268 | 260 | 0 | 0 | 2.5u | 2.1u |
| english-oak | 1892 | 285 | 5960 | 26562 | 525 | 0 | 0 | 2.7u | 2.0u |
| dead-winter-oak | 4242 | 539 | 7377 | 41270 | 0 | 0 | 0 | 3.0u | 2.0u |
| cherry-blossom | 1892 | 252 | 4481 | 23414 | 210 | 950 | 0 | 2.6u | 2.2u |
| magnolia | 1892 | 186 | 2390 | 18458 | 330 | 60 | 0 | 2.5u | 1.8u |
| baobab | 777 | 171 | 1990 | 16296 | 450 | 0 | 0 | 2.5u | 1.1u |
| black-pine | 1892 | 185 | 2273 | 16198 | 525 | 0 | 0 | 2.2u | 2.0u |
| weeping-willow | 4242 | 552 | 16981 | 69540 | 750 | 0 | 0 | 2.6u | 2.5u |

Headline bonsai ratios (banyan): trunk 1.05u × r0 0.40u = h:r0 **2.6** (target 8–12);
first scaffolds attach ≈ 0.63u (knee height; target ≥ 2.4u); leaf blade 0.088u ≈ **3.8%**
of the 2.3u tree (target ≤ 2.5%); whole tree ≈ 2.3u beside a 1.6u visitor.

## Bonsai-era absolute-unit literals (engine, as of d655c1e — line refs to that revision)

These silently assume a ~1u trunk and are part of what the rework must make spec-relative
or rescale coherently:

- grower `growBranch`: spine steps `clamp(round(len/.11),4,16)` (L374); terminal twig
  `r1=.0045` (L412, L425); end-fork spawn floor `cr0<.005` (L423); tip extension
  `max(.015, r1*1.5)` + tip radius `.0008` (L389–390).
- scaffold terminal radii hardcoded: low `.028`, upper `.03`, apex `.025` (L518/526/533).
- `addAnchors`: skips branches shorter than `.04` (L358).
- willow strands: steps `clamp(round(len/.07),5,18)`, ground stop `y<.06` (L442, L451).
- prop roots: steps `max(10, drop/.09)`; start radius clamp `.055`; underground tail `−.11`;
  grip fingers len `rr(.14,.34)`, tip r `.012`; wander fbm `.09` (L580–617).
- aerial curtains: 10 segments; sway `rr(.03,.1)`; curl wander `.16`; touchdown pad
  `+.03/−.02`; mid-air club ×1.5 (L643–658).
- surface roots: 15 steps; meander `.55`; start offset `.12`; diving tail `+.08`,
  `−r0*1.35`, tip `.012`; rootlets len `rr(.12,.3)`, tip `.008` (L680–722).
- trunk spine starts `−.10` underground: `y = −.10+(S.trunk.height+.10)*t` (L475).
- `rootLines` soil-contact bake gate `p.y<.35`, min radius `.02` (L2626–27).
- `makeGroundHeightFn`: mound amp `.13` (spread `trunkR*4.5` — spec-coupled), ripple
  `.07/.05`, terrain fbm rings `smoothstep(r,.3,2.4)`, `(3.2,6.5)`, `(3,6)` (L2041–57).
- stage: `GROUND_R=14` (L2603); camera near/far `.09/80` (L2580); fitShadows near/far
  `.5/20`, sun offset `8`, radius `*.62+.5` (L2696–2710).
- orbit: init `dist 5.4`, `tgt(0,.95,0)`; fitCamera dist clamp `2.2–14`,
  `tgt.y=max(.62,cy*.78)`; wheel/pinch clamp `1.2–20` (L2713–2764).
- `canopyU.uCanC` default `(0,1.6,0)` (L2584).
- SCENES fog: golden `[7.5,21]`, noon `[9,26]`, forest-floor `[5.5,17]`,
  autumn `[7,21]`, zen `[8,23]`, dusk `[7,19]` (L2496–2548).
- eco base counts: grass 170, pebbles 46 (L2664–66); STD_PROPS at |x|,|z| ≲ 2.4 (L2493);
  further literals inside buildGrass/buildPebbles/PROP_BUILDERS audited during the rework
  (see review/PHASE0-REVIEW.md changelog for the exact deltas).

**Restore path:** the full bonsai artifact is recoverable from git `d655c1e`
(`git show d655c1e:banyan-bonsai_v4.html`); this folder exists so the spec family
survives even outside git history, per §2.2.
