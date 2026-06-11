# Remove slack-canvas

Reverses every change the apply made. After removal, test plans/results and worker reviews fall back to plain text + `.md` file uploads (core's built-in fallback paths).

## 1. Delete the copied files

```bash
rm -f src/modules/pr-factory/slack-canvas.ts
rm -f src/modules/pr-factory/file-transform.test.ts
```

## 2. Delete the barrel line

In `src/modules/index.ts`, delete the line `import './pr-factory/slack-canvas.js';`.

## 3. Revert the delivery.ts reach-in

In `src/delivery.ts`:

- Delete the appended hook infrastructure after `getDeliveryAction`: the `FileTransformFn` type, the `let fileTransform` slot, and the `registerFileTransform` function (doc comment included).
- In `deliverMessage`, delete the transform application block (the `let deliveryContent = msg.content;` line through the closing brace of its `if`), change `let files =` back to `const files =`, and pass `msg.content` again (instead of `deliveryContent`) as the 5th argument of `deliveryAdapter.deliver` — leaving `deliverInstance` as the 7th.

## 4. Slack app scopes

Optionally remove `canvases:write` and `files:read` from the worker app's OAuth scopes (and reinstall the app). Existing canvases are workspace content — they persist independently of this component.

## 5. Restart and validate

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw   # macOS
# systemctl --user restart nanoclaw                # Linux
pnpm run build && pnpm test
```

All green, with the file-transform test gone from the run.
