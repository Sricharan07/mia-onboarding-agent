export function activateElement(element: HTMLElement): void {
  if (isDisabledElement(element)) return;
  const view = element.ownerDocument.defaultView ?? window;
  const rect = element.getBoundingClientRect();
  const clientX = rect.x + rect.width / 2;
  const clientY = rect.y + rect.height / 2;
  const mouseInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    buttons: 1,
    clientX,
    clientY
  };
  const pointerInit: PointerEventInit = {
    ...mouseInit,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true
  };

  dispatchPointerEvent(element, "pointerover", { ...pointerInit, buttons: 0 });
  element.dispatchEvent(new view.MouseEvent("mouseover", { ...mouseInit, buttons: 0 }));
  dispatchPointerEvent(element, "pointermove", { ...pointerInit, buttons: 0 });
  element.dispatchEvent(new view.MouseEvent("mousemove", { ...mouseInit, buttons: 0 }));
  dispatchPointerEvent(element, "pointerdown", pointerInit);
  element.dispatchEvent(new view.MouseEvent("mousedown", mouseInit));
  element.focus({ preventScroll: true });
  dispatchPointerEvent(element, "pointerup", { ...pointerInit, buttons: 0 });
  element.dispatchEvent(new view.MouseEvent("mouseup", { ...mouseInit, buttons: 0 }));
  element.click();
}

function dispatchPointerEvent(element: HTMLElement, type: string, init: PointerEventInit): void {
  if (typeof PointerEvent !== "function") return;
  element.dispatchEvent(new PointerEvent(type, init));
}

function isDisabledElement(element: HTMLElement): boolean {
  if ("disabled" in element && Boolean(element.disabled)) return true;
  return element.getAttribute("aria-disabled") === "true";
}
