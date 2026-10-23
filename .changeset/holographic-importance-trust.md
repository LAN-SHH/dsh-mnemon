---
"dsh-mnemon-provider-holographic": patch
---

Holographic now gives each new fact a trust from its importance (#447). Before, the 1-5 importance was clamped as if it were a 0-1 trust, so every fact started at 1.0, the space's default trust never applied and its minimum recall trust filtered nothing. Importance 3, the default, now starts at the space's `defaultTrust`, each step above or below moves it by 0.1 within 0 to 1, and `minTrust` hides facts below it. Search scores stay the plain relevance, so recall tiers do not move. A fact keeps its importance and reads back with it instead of reporting its trust as importance. Facts written before keep their trust of 1.0.
