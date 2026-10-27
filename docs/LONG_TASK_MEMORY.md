# Long-task memory retention

Sophon keeps a bounded working transcript and reads older evidence from encrypted storage. These limits apply to Sophon; the inference server's model weights, KV cache and GPU allocations have a separate lifetime and budget.

- Coding compaction persists the task checkpoint before releasing superseded tool batches and provider reasoning. The original request and checkpoint remain available to continuation/history. Superseded tool screenshots are removed from the retained transcript as well as outgoing requests.
- Fallback tool-result text retains eight excerpts of at most 2,000 characters each, plus an explicit excerpt marker.
- Completed action previews/results larger than 2,000 characters are encrypted under `action-details/`. In-memory summaries retain useful metadata such as paths and exit codes. **Full action details** loads exact content on demand and releases it when closed. Running and waiting approval previews remain complete.
- Conversation bodies retain at most 120 recent messages during ordinary operation. Older messages are encrypted in 60-message pages. Startup reads the conversation index; inactive bodies are released after persistence. Active and running conversations stay resident.
- The renderer receives 60 recent messages. **Earlier messages** browses one additional page at a time. Stream updates carry only the current response text, coalesced at roughly 30 updates per second, instead of copying the conversation on each text update.
- Legacy `chats.json` is migrated to encrypted `conversations/index.json`, versioned conversation bodies and pages. The index is the atomic commit point. The legacy file is retired only after successful migration. Chat deletion, clearing, expiry and reruns remove unreferenced pages, details and attachments through existing cleanup paths.

The initial legacy migration and editing an older prompt can temporarily materialize old messages. Message/page counts bound normal live retention, not an exact process-RAM ceiling; model history, individual payload sizes, JavaScript allocation/garbage collection, and lightweight archive indexes also consume memory. This implementation does not unload or reconfigure LM Studio.

Validation: `npm run smoke:long-task-memory` exercises 1,400 persisted messages, lazy startup and eviction, exact action retrieval, waiting approvals, encrypted migration, interrupted index commit, history paging/rerun, deletion, and lost-key protection. It also stresses 1,000 transcript compactions and 10,000 fallback results. `smoke:conversation` verifies coalesced text updates without conversation snapshots. These checks assert retention bounds and recovery behavior; they do not claim a measured reduction in LM Studio RAM.
