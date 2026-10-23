---
"dsh-mnemon-provider-retaindb": patch
---

RetainDB now receives importance on its own 0 to 1 scale. Memory Spaces gives every memory an importance from 1 to 5, and 3 when the writer gives none, and RetainDB was sent that number as is, outside its scale: RetainDB Local, for one, stored every one of them at its highest importance, so importance no longer told memories apart. Importance 3 is now sent as 0.7, RetainDB's own default, and each step above or below moves it by 0.1, so 1 to 5 are sent as 0.5 to 0.9. Memories written before are not changed.
