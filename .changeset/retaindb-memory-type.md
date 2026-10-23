---
"dsh-mnemon-provider-retaindb": patch
---

RetainDB Server no longer refuses memories for their type. The Provider sent the Memory Spaces category as RetainDB's memory type, and RetainDB Server answers a type outside its list with HTTP 400: its `POST /v1/memory` takes `preference` and `decision` but not `fact`, `insight`, `context` or `general`, so every memory of those categories was refused, the default `general` and the `context` that Runtime and document archives use included, and its legacy `POST /v1/memories` refused all six categories. Those four categories are now sent as `factual`, the type RetainDB falls back to itself, and the legacy endpoint receives `factual` for every category. RetainDB Local, which infers types itself, stores the same types as before.
