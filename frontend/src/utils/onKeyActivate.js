// Keyboard-activates a non-<button> element (e.g. a <span> used as a
// clickable control) on Enter or Space, matching native <button> behavior.
// Pair with role="button" and tabIndex={0} on the element:
//   <span role="button" tabIndex={0} onClick={fn} onKeyDown={onKeyActivate(fn)}>
export function onKeyActivate(handler) {
  return (event) => {
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
    event.preventDefault();
    handler(event);
  };
}
