// G. a <span> used as a clickable control) on Enter or Space, matching native <button> behavior.
export function onKeyActivate(handler) {
  return (event) => {
    if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
    event.preventDefault();
    handler(event);
  };
}
