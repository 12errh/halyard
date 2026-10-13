/**
 * The single place HTTP requests are issued from the webview.
 *
 * Tauri replaces `window.fetch` with an implementation that throws
 * "Can only call Window.fetch on instances of Window" unless it is invoked with
 * `this === window`. Capturing the bare global and then calling it as a method
 * — `this.fetchImpl(url)`, or `const f = fetch; f(url)` — breaks that contract,
 * which is exactly how the app crashed. Routing every call through this
 * wrapper keeps the receiver correct without each caller having to know.
 */

/** Invoke with an explicit receiver so Tauri's patched fetch is happy. */
export const httpFetch: typeof fetch = (input, init) => window.fetch(input, init);

export default httpFetch;
