/**
 * Keeps a tray menu in step with state that changes underneath it.
 *
 * macOS and Windows emit `right-click` before showing the menu, so the menu can
 * be rebuilt just in time and nothing else is needed. Linux app indicators emit
 * neither `click` nor `right-click`: the menu is exported over DBus once and
 * only changes when it is set again. Rebuilding on that event alone left "Undo
 * last capture" permanently disabled there, frozen in the state it had at
 * startup — so the refresh has to be pushed from wherever the state changes.
 *
 * Pushing it from several call sites means most calls are no-ops, hence the
 * change check: rebuilding an exported DBus menu on every capture regardless is
 * chatter the desktop has to process for nothing.
 */
export function createRefresher(read: () => boolean, rebuild: () => void): () => void {
  let last: boolean | undefined;

  return () => {
    const value = read();
    if (value === last) return;
    last = value;
    rebuild();
  };
}
