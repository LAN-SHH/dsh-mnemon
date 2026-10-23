---
"dsh-mnemon-source-memory-spaces": patch
"dsh-mnemon-strategy-default-three-tier": patch
"dsh-mnemon-provider-openviking": patch
"dsh-mnemon-provider-hindsight": patch
"dsh-mnemon-provider-mem0": patch
"dsh-mnemon-provider-supermemory": patch
"dsh-mnemon-provider-retaindb": patch
"dsh-mnemon-provider-byterover": patch
---

Recall no longer drops or demotes a Provider's best answer because its scores use another scale (#454). Only Mnemon Native and Holographic report scores Mnemon calibrates, so only their results are banded high, medium or low. Results from OpenViking, Hindsight, Mem0, Supermemory, RetainDB, ByteRover and Honcho are now `ranked`: they keep their Provider's own order and take their turn by rank among the other spaces' results within the recall limit, and the three-tier strategy admits them like high-relevance rows within its limits. Before, a Hindsight answer scored above 1 counted as unknown and could be left out while unrelated OpenViking rows at 0.66 filled the limit as high relevance. Quality stats now count out-of-range scores separately (`outOfRange`), and `unscaled` counts uncalibrated rows. A third-party Provider that declares `normalized-relevance` is banded as before; declare it only for calibrated 0–1 scores.
