# RetainDB 重要度改用其 0-1 量纲

[English](./README.md) | [验证记录](./verification.json)

Memory Spaces Source 给每条记忆一个 1 到 5 的整数重要度，写入方没有给出时为 3。RetainDB Provider 把这个数原样发给 RetainDB，而 RetainDB 的重要度取 0 到 1，默认 0.7。

基线为 main `a7e3bc54`。验证于 2026-10-23（Asia/Shanghai）进行，环境为 macOS arm64、Node 24.19.0 与 pnpm 10.13.1。记忆均为合成数据。

**没有运行 RetainDB 服务器。** 没有托管服务的账号，RetainDB Local 只读了源码，没有启动。因此证据是下文两处来源给出的 RetainDB 接口约定，加上请求层面的检查：Provider 所发请求体的单元测试，以及一个经真实 Memory Spaces Source 向本机回环记录器写入的探针。

## 原因

- Source 发给每个 Provider 的重要度都是 1 到 5 的整数，写入方没有给出时为 3：`plugins/dsh-mnemon-source-memory-spaces/src/service.ts` 中的 `prepareRemember` 对 `remember` 与 `rememberMany` 都调用 `src/sdk/input.ts` 的 `integer(request.importance, 3, 1, 5)`。
- Provider 发送的是 `importance: request.importance ?? 0.7`。经过 Source 时重要度总会给出，所以 0.7 这个回退值从未生效，RetainDB 收到的是 1 到 5。
- RetainDB 的重要度取 0 到 1，默认 0.7：
  - Hermes Agent 的 RetainDB provider 面向 `https://api.retaindb.com` 的托管 API，把写入工具的重要度描述为“Importance 0-1 (default: 0.7)”，并把这个浮点数放进 `POST /v1/memory` 的请求体，回退时放进旧接口 `POST /v1/memories` 的请求体（[`plugins/memory/retaindb/__init__.py`](https://github.com/NousResearch/hermes-agent/blob/419e6627aaeda9c87e0b17bcc013484a2bfdb194/plugins/memory/retaindb/__init__.py#L78)，`419e6627`，第 78、148-152 与 481 行）。
  - RetainDB 自己的开源服务端 RetainDB Local 0.2.2 把新记忆的重要度存为 `clamp((importance ?? 0.62) + quality * 0.28 + typeWeight * 0.12, 0.1, 0.99)`，并把它计入每次召回的得分（[`packages/local/src/cli.ts`](https://github.com/RetainDB/RetainDB/blob/2ad2cc4d6d58145eca1a6cbbce66dfc5b5380f38/packages/local/src/cli.ts#L728)，`2ad2cc4d`，第 728 与 904 行）。重要度只要不小于 1，存下的就是 0.99。因此在 main 上，RetainDB Local 把每条记忆都按最高重要度保存，召回时重要度不再能区分记忆。
- 托管服务对大于 1 的值是截断还是拒绝，没有实际观察到。

## 修复

- `remember` 按 RetainDB 的量纲发送重要度。Source 的默认重要度 3 对应 RetainDB 的默认值 0.7，每高或低一档加减 0.1，限定在 0 到 1 之间，并保留两位小数，所以 1 发送为 0.5，而不是 0.49999999999999994。
- 没有重要度的请求仍按 0.7 发送。只有不经 Source 直接调用 Provider 时才会出现这种请求。
- 旧接口 `POST /v1/memories` 的回退发送同样的值，因为它就是去掉 `write_mode` 的同一个请求体。
- 读回不做映射。Provider 读取检索与列表结果时不读重要度，只读 id、正文、分数、类型与创建时间，因此修复前后，召回与浏览都不显示 RetainDB 的重要度。
- RetainDB 中已有的记忆不会被改写。在 RetainDB Local 上，它们保留存入时的 0.99，召回得分仍会计入它。写入时的重要度已在截断中丢失，改写它们只能靠猜测。

| Provider 收到的重要度 | main 发送 | 修复后发送 |
|---|---|---|
| 1 | 1 | 0.5 |
| 2 | 2 | 0.6 |
| 3，也是写入方没有给出时 Source 发送的值 | 3 | 0.7 |
| 4 | 4 | 0.8 |
| 5 | 5 | 0.9 |
| 无（不经 Source 直接调用 Provider） | 0.7 | 0.7 |

## 经过 Memory Spaces Source

[`importance.probe.mjs`](./importance.probe.mjs) 挂载真实的 Memory Spaces Source 与 RetainDB Provider，让 RetainDB 连接一个本机回环记录器，由它应答 RetainDB 的项目与记忆接口。随后经 `remember` 写入三条记忆，记录每个 `POST /v1/memory` 请求体中的重要度。

| 记忆 | 写入的重要度 | main 发送 | 修复后发送 |
|---|---|---|---|
| Release notes are drafted on Monday | 1 | 1 | 0.5 |
| Release approvals need a completed canary | 5 | 5 | 0.9 |
| Release branches are cut from main | 无（Source 发送 3） | 3 | 0.7 |

## 自动化检查

```text
pnpm --filter dsh-mnemon-provider-retaindb exec vitest run     # 15 通过；在 main 上，8 项新测试中有 7 项失败
pnpm --filter dsh-mnemon-provider-retaindb run typecheck
pnpm --filter dsh-mnemon-provider-retaindb run build
pnpm --filter dsh-mnemon-source-memory-spaces exec vitest run  # 296 通过，2 跳过
node docs/pr-assets/retaindb-importance-scale/importance.probe.mjs <out.json>
node scripts/verify-docs.mjs
```

main 的结果使用 main 的 `driver.ts`：新测试针对它运行，探针使用由它构建的包。新的单元测试检查：

- 重要度 1 到 5 时发送的完整请求体；
- 没有重要度的请求发送 0.7；
- 1 到 5 以外的值被限定在 0 到 1 之间；
- 旧接口收到同样的重要度。

在 main 上，没有重要度的那项测试也通过，因为 main 在这种情况下同样发送 0.7；其余七项失败。

## 限制

- 没有运行 RetainDB 服务器，因此托管服务对 0.5 到 0.9 存下什么、此前对 1 到 5 做了什么，都没有实际观察到。上文 RetainDB Local 的行为来自其源码。
- 没有录制 WebUI。界面没有变化，修复前后 RetainDB 的记忆都不显示重要度。
